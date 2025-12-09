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
    // 1. MAIN ENTRY COMMAND
    let startDisposable = vscode.commands.registerCommand('sfInspector.start', async (uri) => {
        let editor = vscode.window.activeTextEditor;
        let isLogFile = false;
        let prefillId = "";
        if (uri && uri.scheme === 'file') {
            isLogFile = uri.fsPath.endsWith('.log');
        }
        else if (editor) {
            isLogFile = editor.document.fileName.endsWith('.log');
        }
        if (editor && !editor.selection.isEmpty) {
            const sel = editor.document.getText(editor.selection).trim();
            if (isValidIdOrUrl(sel)) {
                prefillId = extractId(sel) || "";
            }
        }
        // --- NEW LOGIC: OPEN LOADING STATE IMMEDIATELY IF ID EXISTS ---
        if (prefillId) {
            // Open immediately in loading state
            recordPanel_1.RecordPanel.createOrShow(context.extensionUri, prefixService, context.globalState, prefillId, isLogFile);
            // Then Fetch
            launchInspector(prefillId, false); // Pass false to skip opening panel again
        }
        else {
            // No ID? Open Home
            recordPanel_1.RecordPanel.createOrShow(context.extensionUri, prefixService, context.globalState, "", isLogFile);
        }
    });
    // Helper to fetch data and update EXISTING panel
    async function launchInspector(text, createPanel = true) {
        if (createPanel) {
            // ... logic if called from other places ...
        }
        try {
            // We don't need withProgress anymore because the UI shows the spinner!
            // But we keep it simple.
            const objectName = await prefixService.resolveObjectName(text);
            if (!objectName)
                throw new Error("Unknown Object Type (Prefix not found)");
            const [recordData, metadata] = await Promise.all([
                sfdxService_1.SfdxService.getRecordData(objectName, text),
                sfdxService_1.SfdxService.getMetadata(objectName)
            ]);
            if (!recordData || !recordData.result) {
                throw new Error(`Record found, but no data returned.`);
            }
            // Update the panel that is currently showing the spinner
            if (recordPanel_1.RecordPanel.currentPanel) {
                recordPanel_1.RecordPanel.currentPanel.updateLive(objectName, text, recordData, metadata?.result);
            }
        }
        catch (err) {
            let msg = err.message;
            if (msg.includes("NOT_FOUND"))
                msg = `Record ID ${text} does not exist in this Org.`;
            // Show Error Page in Panel
            if (recordPanel_1.RecordPanel.currentPanel) {
                recordPanel_1.RecordPanel.currentPanel.setError(text, msg);
            }
            else {
                vscode.window.showErrorMessage(`Inspector Failed: ${msg}`);
            }
        }
    }
    // 2. SAVE COMMAND (Internal)
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
                }).join('\n');
                vscode.window.showInformationMessage(`✅ Updated ${sobject}\n\n${changeList}`, { modal: true });
            });
        }
        catch (err) {
            if (recordPanel_1.RecordPanel.currentPanel)
                recordPanel_1.RecordPanel.currentPanel.resetSaveButton();
            vscode.window.showErrorMessage(`Update Failed: ${err.message}`);
        }
    });
    // 3. LOG SCAN COMMAND
    let scanLogDisposable = vscode.commands.registerCommand('sfInspector.internalScanLog', async (varName) => {
        let editor = vscode.window.activeTextEditor;
        if (!editor || !editor.document.fileName.endsWith('.log')) {
            editor = vscode.window.visibleTextEditors.find(e => e.document.fileName.endsWith('.log'));
        }
        if (!editor) {
            vscode.window.showErrorMessage("No open Salesforce Log file found.");
            return;
        }
        try {
            const logContent = editor.document.getText();
            const versions = logHistoryService_1.LogHistoryService.parseLog(logContent, varName);
            if (versions.length === 0) {
                vscode.window.showInformationMessage(`No assignments found for '${varName}'.`);
                return;
            }
            if (recordPanel_1.RecordPanel.currentPanel) {
                recordPanel_1.RecordPanel.currentPanel.updateLog(varName, versions, 0);
            }
        }
        catch (e) {
            vscode.window.showErrorMessage(`Scan Failed: ${e.message}`);
        }
    });
    context.subscriptions.push(startDisposable, saveDisposable, scanLogDisposable);
}
function isValidIdOrUrl(text) {
    return /\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/.test(text);
}
function extractId(text) {
    const match = text.match(/\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/);
    return match ? match[0] : null;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map