"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const prefixService_1 = require("./prefixService");
const recordPanel_1 = require("./recordPanel");
const sfdxService_1 = require("./sfdxService");
const logHistoryService_1 = require("./logHistoryService");
function activate(context) {
    const prefixService = new prefixService_1.PrefixService(context);
    prefixService.warmCache().catch(err => console.error('Cache Warm Failed', err));
    // --- SHARED INSPECT LOGIC ---
    const handleInspect = async () => {
        let text = "";
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            text = editor.document.getText(editor.selection).trim();
        }
        if (!text) {
            const clipText = await vscode.env.clipboard.readText();
            const extracted = extractIdFromText(clipText);
            if (extracted) {
                text = extracted;
                vscode.window.setStatusBarMessage(`📋 Inspecting ID from Clipboard: ${text}`, 4000);
            }
            else {
                vscode.window.showWarningMessage("No valid Salesforce ID found in selection or clipboard.");
                return;
            }
        }
        if (!/^[a-zA-Z0-9]{15,18}$/.test(text)) {
            vscode.window.showWarningMessage(`"${text}" does not look like a valid Salesforce ID.`);
            return;
        }
        launchInspector(text);
    };
    async function launchInspector(text) {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Inspecting Record...",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Identifying Object Type..." });
                const objectName = await prefixService.resolveObjectName(text);
                if (!objectName)
                    throw new Error(`Unknown Key Prefix: ${text.substring(0, 3)}`);
                progress.report({ message: `Fetching ${objectName} details...` });
                const [recordData, metadata] = await Promise.all([
                    sfdxService_1.SfdxService.getRecordData(objectName, text),
                    sfdxService_1.SfdxService.getMetadata(objectName)
                ]);
                if (!recordData || !recordData.result) {
                    throw new Error(`Record found, but no data returned.`);
                }
                recordPanel_1.RecordPanel.createOrShow(context.extensionUri, objectName, text, recordData, metadata?.result, prefixService, context.globalState);
            });
        }
        catch (err) {
            let msg = err.message;
            if (msg.includes("NOT_FOUND"))
                msg = `Record ID ${text} does not exist.`;
            vscode.window.showErrorMessage(`Inspector Failed: ${msg}`);
        }
    }
    let inspectDisposable = vscode.commands.registerCommand('sfInspector.inspectId', handleInspect);
    let clipboardDisposable = vscode.commands.registerCommand('sfInspector.inspectClipboard', handleInspect);
    let saveDisposable = vscode.commands.registerCommand('sfInspector.saveRecord', async (sobject, id, updates) => {
        try {
            const isProd = await sfdxService_1.SfdxService.isProduction();
            if (isProd) {
                const answer = await vscode.window.showWarningMessage(`⚠️ WARNING: Updating PRODUCTION record. Are you sure?`, { modal: true }, "Yes, Update Production");
                if (answer !== "Yes, Update Production") {
                    if (recordPanel_1.RecordPanel.currentPanel)
                        recordPanel_1.RecordPanel.currentPanel.resetSaveButton();
                    return;
                }
            }
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Saving Record...",
                cancellable: false
            }, async () => {
                await sfdxService_1.SfdxService.updateRecord(sobject, id, updates);
                const freshData = await sfdxService_1.SfdxService.getRecordData(sobject, id);
                if (recordPanel_1.RecordPanel.currentPanel)
                    recordPanel_1.RecordPanel.currentPanel.refreshAfterSave(freshData);
                const changeList = Object.entries(updates)
                    .map(([key, val]) => {
                    let displayVal = String(val);
                    if (displayVal.length > 50)
                        displayVal = displayVal.substring(0, 50) + "...";
                    return `• ${key}: ${displayVal}`;
                })
                    .join('\n');
                vscode.window.showInformationMessage(`✅ Successfully Updated ${sobject}\n\n${changeList}`, { modal: true });
            });
        }
        catch (err) {
            if (recordPanel_1.RecordPanel.currentPanel)
                recordPanel_1.RecordPanel.currentPanel.resetSaveButton();
            vscode.window.showErrorMessage(`Update Failed: ${err.message}`);
        }
    });
    // 3. LOG HISTORY COMMAND (Updated)
    let logHistoryDisposable = vscode.commands.registerCommand('sfInspector.scanLogVariable', async (uri) => {
        let editor = vscode.window.activeTextEditor;
        // 1. Determine which file to scan
        // If triggered via context menu (uri present), open/focus that document
        if (uri && uri.scheme === 'file') {
            const doc = await vscode.workspace.openTextDocument(uri);
            editor = await vscode.window.showTextDocument(doc);
        }
        // Fallback: If no editor, look for visible log files
        else if (!editor || !editor.document.fileName.endsWith('.log')) {
            editor = vscode.window.visibleTextEditors.find(e => e.document.fileName.endsWith('.log'));
        }
        if (!editor) {
            vscode.window.showWarningMessage("Please open a Salesforce Log (.log) file first.");
            return;
        }
        // 2. Pre-fill variable name from selection
        let defaultVar = "";
        if (!editor.selection.isEmpty) {
            defaultVar = editor.document.getText(editor.selection).trim();
        }
        const varName = await vscode.window.showInputBox({
            placeHolder: "Enter variable name (e.g. newOrderList)",
            prompt: "Scan log for variable assignments",
            value: defaultVar
        });
        if (!varName)
            return;
        try {
            const logContent = editor.document.getText();
            const versions = logHistoryService_1.LogHistoryService.parseLog(logContent, varName);
            if (versions.length === 0) {
                vscode.window.showInformationMessage(`No assignments found for variable '${varName}'.`);
                return;
            }
            recordPanel_1.RecordPanel.createOrShowLogMode(context.extensionUri, varName, versions, prefixService, context.globalState);
        }
        catch (e) {
            vscode.window.showErrorMessage(`Log Scan Failed: ${e.message}`);
        }
    });
    context.subscriptions.push(inspectDisposable, clipboardDisposable, saveDisposable, logHistoryDisposable);
}
function extractIdFromText(text) {
    if (!text)
        return null;
    const idPattern = /\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/;
    const match = text.match(idPattern);
    if (match)
        return match[0];
    return null;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map