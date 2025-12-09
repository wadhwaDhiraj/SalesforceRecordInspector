import * as vscode from 'vscode';
import { PrefixService } from './prefixService';
import { RecordPanel } from './recordPanel';
import { SfdxService } from './sfdxService';
import { LogHistoryService } from './logHistoryService';

export function activate(context: vscode.ExtensionContext) {
    
    const prefixService = new PrefixService(context);
    prefixService.warmCache().catch(err => console.error('Cache Warm Failed', err));

    // 1. MAIN ENTRY COMMAND
    let startDisposable = vscode.commands.registerCommand('sfInspector.start', async (uri?: vscode.Uri) => {
        
        let editor = vscode.window.activeTextEditor;
        let isLogFile = false;
        let prefillId = "";

        if (uri && uri.scheme === 'file') {
            isLogFile = uri.fsPath.endsWith('.log');
        } else if (editor) {
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
            RecordPanel.createOrShow(
                context.extensionUri, 
                prefixService, 
                context.globalState,
                prefillId,
                isLogFile
            );
            
            // Then Fetch
            launchInspector(prefillId, false); // Pass false to skip opening panel again
        } else {
            // No ID? Open Home
            RecordPanel.createOrShow(
                context.extensionUri, 
                prefixService, 
                context.globalState,
                "",
                isLogFile
            );
        }
    });

    // Helper to fetch data and update EXISTING panel
    async function launchInspector(text: string, createPanel = true) {
        if (createPanel) {
             // ... logic if called from other places ...
        }

        try {
            // We don't need withProgress anymore because the UI shows the spinner!
            // But we keep it simple.
            
            const objectName = await prefixService.resolveObjectName(text);
            if (!objectName) throw new Error("Unknown Object Type (Prefix not found)");

            const [recordData, metadata] = await Promise.all([
                SfdxService.getRecordData(objectName, text),
                SfdxService.getMetadata(objectName)
            ]);

            if (!recordData || !recordData.result) {
                throw new Error(`Record found, but no data returned.`);
            }

            // Update the panel that is currently showing the spinner
            if (RecordPanel.currentPanel) {
                RecordPanel.currentPanel.updateLive(objectName, text, recordData, metadata?.result);
            }

        } catch (err: any) {
            let msg = err.message;
            if (msg.includes("NOT_FOUND")) msg = `Record ID ${text} does not exist in this Org.`;
            
            // Show Error Page in Panel
            if (RecordPanel.currentPanel) {
                RecordPanel.currentPanel.setError(text, msg);
            } else {
                vscode.window.showErrorMessage(`Inspector Failed: ${msg}`);
            }
        }
    }

    // 2. SAVE COMMAND (Internal)
    let saveDisposable = vscode.commands.registerCommand('sfInspector.saveRecord', async (sobject: string, id: string, updates: any) => {
        try {
            const isProd = await SfdxService.isProduction();
            if (isProd) {
                const answer = await vscode.window.showWarningMessage(
                    `⚠️ WARNING: Updating PRODUCTION record. Are you sure?`, 
                    { modal: true }, "Yes, Update Production"
                );
                if (answer !== "Yes, Update Production") {
                    if (RecordPanel.currentPanel) RecordPanel.currentPanel.resetSaveButton();
                    return;
                }
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Saving Record...",
                cancellable: false
            }, async () => {
                await SfdxService.updateRecord(sobject, id, updates);
                const freshData = await SfdxService.getRecordData(sobject, id);
                if (RecordPanel.currentPanel) RecordPanel.currentPanel.refreshAfterSave(freshData);
                
                const changeList = Object.entries(updates)
                    .map(([key, val]) => {
                        let displayVal = String(val);
                        if (displayVal.length > 50) displayVal = displayVal.substring(0, 50) + "...";
                        return `• ${key}: ${displayVal}`;
                    }).join('\n');
                    
                vscode.window.showInformationMessage(`✅ Updated ${sobject}\n\n${changeList}`, { modal: true });
            });
        } catch (err: any) {
            if (RecordPanel.currentPanel) RecordPanel.currentPanel.resetSaveButton();
            vscode.window.showErrorMessage(`Update Failed: ${err.message}`);
        }
    });

    // 3. LOG SCAN COMMAND
    let scanLogDisposable = vscode.commands.registerCommand('sfInspector.internalScanLog', async (varName: string) => {
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
            const versions = LogHistoryService.parseLog(logContent, varName);

            if (versions.length === 0) {
                vscode.window.showInformationMessage(`No assignments found for '${varName}'.`);
                return;
            }

            if (RecordPanel.currentPanel) {
                RecordPanel.currentPanel.updateLog(varName, versions, 0);
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Scan Failed: ${e.message}`);
        }
    });

    context.subscriptions.push(startDisposable, saveDisposable, scanLogDisposable);
}

function isValidIdOrUrl(text: string): boolean {
    return /\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/.test(text);
}

function extractId(text: string): string | null {
    const match = text.match(/\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/);
    return match ? match[0] : null;
}

export function deactivate() {}