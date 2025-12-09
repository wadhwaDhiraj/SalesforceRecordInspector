import * as vscode from 'vscode';
import { SfdxService } from './sfdxService';
import { PrefixService } from './prefixService';

interface HistoryState {
    view: 'HOME' | 'RECORD' | 'LOG' | 'LOADING' | 'ERROR';
    objectName: string; 
    id: string; 
    data: any;
    metadata: any;
    logVersions?: any[];
    currentVersionIndex?: number;
    errorMessage?: string;
}

export class RecordPanel {
    public static currentPanel: RecordPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _prefixService: PrefixService;
    private _globalState: vscode.Memento;
    
    private _history: HistoryState[] = [];
    private _currentState: HistoryState | undefined;
    
    private _isLogFileContext: boolean = false;
    private _homePrefill: string = "";

    private _currentMetadata: any = {};
    private _isEditing: boolean = false;
    private _ignoreNulls: boolean = false;

    private constructor(panel: vscode.WebviewPanel, prefixService: PrefixService, globalState: vscode.Memento) {
        this._panel = panel;
        this._prefixService = prefixService;
        this._globalState = globalState;

        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

        this._panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'submitId':
                        await this.inspectNewId(message.id);
                        break;
                    
                    // --- UNIFIED LOG SCAN HANDLER ---
                    case 'requestLogScan':
                        const varName = await vscode.window.showInputBox({
                            placeHolder: "Enter variable name (e.g. newOrderList)",
                            prompt: "Scan open log file"
                        });
                        if (varName) {
                            vscode.commands.executeCommand('sfInspector.internalScanLog', varName);
                        }
                        break;

                    case 'copy':
                        vscode.env.clipboard.writeText(message.text);
                        vscode.window.setStatusBarMessage('Copied to clipboard', 2000);
                        break;
                    case 'openOrg':
                        try { await SfdxService.openOrg(message.id); } 
                        catch(e:any) { vscode.window.showErrorMessage(e.message); }
                        break;
                    case 'inspect':
                        await this.inspectNewId(message.id);
                        break;
                    case 'back':
                        this.goBack();
                        break;
                    case 'home':
                        this.updateHome();
                        break;
                    case 'toggleEdit':
                        this._isEditing = !this._isEditing;
                        this.refreshHtml(); 
                        break;
                    case 'save':
                        vscode.commands.executeCommand('sfInspector.saveRecord', this._currentState?.objectName, this._currentState?.id, message.updates);
                        break;
                    case 'resetButton': 
                        this._panel.webview.postMessage({ command: 'resetButton' });
                        break;
                    case 'requestSaveTemplate':
                        await this.handleSaveTemplateRequest(message.all, message.modified);
                        break;
                    case 'requestLoadTemplate':
                        await this.showLoadTemplatePicker();
                        break;
                    case 'changeVersion':
                        this.changeLogVersion(parseInt(message.index));
                        break;
                    case 'toggleIgnoreNulls':
                        this._ignoreNulls = message.value;
                        this.refreshHtml();
                        break;
                    case 'close':
                        this.dispose();
                        break;
                }
            },
            null,
            this._disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri, 
        prefixService: PrefixService, 
        globalState: vscode.Memento,
        prefillId: string,
        isLogFile: boolean,
        objectName?: string,
        data?: any,
        metadata?: any
    ) {
        const column = vscode.ViewColumn.Beside;

        if (RecordPanel.currentPanel) {
            RecordPanel.currentPanel._panel.reveal(column);
            RecordPanel.currentPanel._isLogFileContext = isLogFile;
            RecordPanel.currentPanel._homePrefill = prefillId;
            
            if (data) {
                RecordPanel.currentPanel.clearHistory();
                RecordPanel.currentPanel.updateLive(objectName!, prefillId, data, metadata);
            } else if (prefillId) {
                RecordPanel.currentPanel.setLoading(prefillId);
            } else {
                RecordPanel.currentPanel.updateHome();
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel('sfInspector', 'Salesforce Inspector', column, { enableScripts: true });
        RecordPanel.currentPanel = new RecordPanel(panel, prefixService, globalState);
        RecordPanel.currentPanel._isLogFileContext = isLogFile;
        RecordPanel.currentPanel._homePrefill = prefillId;

        if (data) {
            RecordPanel.currentPanel.updateLive(objectName!, prefillId, data, metadata);
        } else if (prefillId) {
            RecordPanel.currentPanel.setLoading(prefillId);
        } else {
            RecordPanel.currentPanel.updateHome();
        }
    }

    public setLoading(id: string) {
        this._panel.title = `Loading ${id}...`;
        const newState: HistoryState = { view: 'LOADING', objectName: 'Loading', id: id, data: {}, metadata: {} };
        if (this._currentState && this._currentState.view !== 'HOME' && this._currentState.view !== 'ERROR') {
            this._history.push(this._currentState);
        }
        this._currentState = newState;
        this._panel.webview.html = this._getHtmlForLoading(id);
    }

    public setError(id: string, message: string) {
        this._panel.title = `Error`;
        const newState: HistoryState = { 
            view: 'ERROR', objectName: 'Error', id: id, data: {}, metadata: {}, errorMessage: message
        };
        this._currentState = newState;
        this._panel.webview.html = this._getHtmlForError(id, message);
    }

    public updateHome() {
        this._panel.title = "Inspector Home";
        const newState: HistoryState = { view: 'HOME', objectName: 'Home', id: '', data: {}, metadata: {} };
        this._currentState = newState;
        this._panel.webview.html = this._getHtmlForHome();
    }

    public updateLive(objectName: string, id: string, data: any, metadata: any, isNewState: boolean = true) {
        this._panel.title = `Inspect: ${objectName}`;
        this._currentMetadata = metadata;
        const fieldMap: any = {};
        if (metadata && metadata.fields) {
            metadata.fields.forEach((f: any) => fieldMap[f.name] = { updateable: f.updateable, type: f.type, label: f.label, picklistValues: f.picklistValues });
        }
        this._currentMetadata.processedMap = fieldMap;
        
        const newState: HistoryState = { view: 'RECORD', objectName, id, data, metadata: this._currentMetadata };
        if (isNewState && this._currentState && this._currentState.view !== 'HOME' && this._currentState.view !== 'LOADING') {
            this._history.push(this._currentState);
        }
        this._currentState = newState;
        this.refreshHtml();
    }

    public updateLog(variableName: string, versions: any[], index: number) {
        this._panel.title = `Log: ${variableName}`;
        const newState: HistoryState = { 
            view: 'LOG', objectName: variableName, id: `Version ${index + 1}`, data: versions[index].data, metadata: {},
            logVersions: versions, currentVersionIndex: index
        };
        if (this._currentState && this._currentState.view !== 'HOME' && this._currentState.view !== 'LOADING') {
            this._history.push(this._currentState);
        }
        this._currentState = newState;
        this.refreshHtml();
    }

    private async handleSaveTemplateRequest(allFields: any, modifiedFields: any) {
        const objectName = this._currentState?.objectName || "Record";
        const modifiedCount = Object.keys(modifiedFields).length;
        const items = [];

        items.push({ 
            label: "Save All Fields (Snapshot)", 
            detail: "Saves current values of all visible inputs.",
            data: allFields 
        });

        if (modifiedCount > 0) {
            items.push({ 
                label: `Save Only Modified Fields (${modifiedCount})`, 
                detail: "Saves only the fields you have changed in this session.",
                data: modifiedFields 
            });
        }

        const choice = await vscode.window.showQuickPick(items, { placeHolder: "Select what to include in this preset:" });
        if(!choice) return;

        const name = await vscode.window.showInputBox({ prompt: `Name this ${objectName} preset`, placeHolder: "e.g. Standard Setup" });
        if(!name) return;

        const key = `sfInspector_templates_${objectName}`;
        const existing:any = this._globalState.get(key) || {};
        existing[name] = { ...choice.data, _sourceId: this._currentState?.id };
        await this._globalState.update(key, existing);
        
        vscode.window.showInformationMessage(`Preset "${name}" saved!`);
    }

    private async showLoadTemplatePicker() {
        const objectName = this._currentState?.objectName || "Record";
        const key = `sfInspector_templates_${objectName}`;
        const existing:any = this._globalState.get(key) || {};
        const templates = Object.keys(existing);
        
        if (templates.length === 0) {
            vscode.window.showInformationMessage(`No saved presets found for ${objectName}. Save one first!`);
            return;
        }

        const selected = await vscode.window.showQuickPick(templates, { placeHolder: "Select a preset to load..." });
        if (selected) {
            const fieldsToApply = existing[selected];
            delete fieldsToApply['_sourceId'];
            this._panel.webview.postMessage({ command: 'applyTemplate', fields: fieldsToApply });
        }
    }

    private goBack() {
        if (this._history.length > 0) {
            const previous = this._history.pop();
            if (previous && previous.view === 'LOADING' && this._history.length > 0) {
                const realPrev = this._history.pop();
                this.restoreState(realPrev!);
            } else if (previous) {
                this.restoreState(previous);
            }
        } else {
            this.updateHome();
        }
    }

    private restoreState(state: HistoryState) {
        this._isEditing = false;
        if (state.view === 'LOG') {
            this.updateLog(state.objectName, state.logVersions!, state.currentVersionIndex!);
        } else if (state.view === 'RECORD') {
            this.updateLive(state.objectName, state.id, state.data, state.metadata, false);
        } else {
            this.updateHome();
        }
    }

    private async inspectNewId(idRaw: string) {
        const idPattern = /\b([a-zA-Z0-9]{18}|[a-zA-Z0-9]{15})\b/;
        const match = idRaw.match(idPattern);
        const id = match ? match[0] : idRaw.trim();

        if (!/^[a-zA-Z0-9]{15,18}$/.test(id)) {
            vscode.window.showErrorMessage(`Invalid Salesforce ID: ${id}`);
            return;
        }

        if (this._currentState && this._currentState.id === id) {
            vscode.window.setStatusBarMessage("Already viewing this record.", 3000);
            return;
        }

        this.setLoading(id);

        try {
            const objectName = await this._prefixService.resolveObjectName(id);
            if (!objectName) throw new Error("Unknown Object Type");

            const [recordData, metadata] = await Promise.all([
                SfdxService.getRecordData(objectName, id),
                SfdxService.getMetadata(objectName)
            ]);

            if (!recordData || !recordData.result) throw new Error("Record not found in Salesforce.");

            this.updateLive(objectName, id, recordData, metadata?.result);
        } catch (e: any) {
            this.setError(id, e.message);
        }
    }

    public clearHistory() {
        this._history = [];
        this._currentState = undefined;
        this._isEditing = false;
        this._ignoreNulls = false;
    }

    public refreshAfterSave(newData: any) {
        this._isEditing = false;
        if (this._currentState && this._currentState.view === 'RECORD') {
            this.updateLive(this._currentState.objectName, this._currentState.id, newData, this._currentMetadata, false);
        }
    }

    public resetSaveButton() {
        this._panel.webview.postMessage({ command: 'resetButton' });
    }

    private changeLogVersion(index: number) {
        if (this._currentState && this._currentState.view === 'LOG' && this._currentState.logVersions) {
            this._currentState.currentVersionIndex = index;
            this._currentState.data = this._currentState.logVersions[index].data;
            this.refreshHtml();
        }
    }

    private refreshHtml() {
        if (!this._currentState) return;
        if (this._currentState.view === 'HOME') {
            this._panel.webview.html = this._getHtmlForHome();
        } else if (this._currentState.view === 'LOADING') {
            this._panel.webview.html = this._getHtmlForLoading(this._currentState.id);
        } else if (this._currentState.view === 'ERROR') {
            this._panel.webview.html = this._getHtmlForError(this._currentState.id, this._currentState.errorMessage || "Error");
        } else {
            this._panel.webview.html = this._getHtmlForWebview(this._currentState);
        }
    }

    // --- HTML GENERATORS ---

    private _getHtmlForLoading(id: string) {
        return `<!DOCTYPE html><html lang="en"><head><style>
            body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; }
            .spinner { border: 4px solid var(--vscode-widget-shadow); border-top: 4px solid var(--vscode-progressBar-background); border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin-bottom: 20px; }
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        </style></head><body>
            <div class="spinner"></div><h3>Fetching Record...</h3><small>${id}</small>
        </body></html>`;
    }

    private _getHtmlForError(id: string, error: string) {
        return `<!DOCTYPE html><html lang="en"><head><style>
            body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; padding: 20px; text-align: center; }
            h2 { color: var(--vscode-errorForeground); margin-bottom: 10px; }
            p { margin-bottom: 20px; opacity: 0.8; }
            button { padding: 10px 20px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer; }
            button:hover { background: var(--vscode-button-hoverBackground); }
        </style></head><body>
            <h2>⚠ Inspection Failed</h2><p>${error}</p>
            <button onclick="goHome()">Back to Home</button>
            <script>const vscode = acquireVsCodeApi(); function goHome() { vscode.postMessage({ command: 'home' }); }</script>
        </body></html>`;
    }

    private _getHtmlForHome() {
        const logButton = this._isLogFileContext 
            ? `<button class="action-btn log-btn" onclick="requestLogScan()">🕒 Scan Log Variable</button>`
            : `<div style="color:#888; margin-top:10px; font-size:12px;">Open a .log file to access Log History</div>`;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: var(--vscode-font-family); padding: 40px 20px; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; box-sizing: border-box; }
                h1 { margin-bottom: 20px; font-weight: normal; }
                .input-group { width: 100%; max-width: 400px; display: flex; gap: 5px; margin-bottom: 10px; }
                input { flex: 1; padding: 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); outline: none; }
                input:focus { border-color: var(--vscode-focusBorder); }
                button { cursor: pointer; padding: 10px 20px; border: none; font-size: 13px; border-radius: 2px; }
                .go-btn { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                .go-btn:hover { background-color: var(--vscode-button-hoverBackground); }
                .log-btn { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); width: 100%; max-width: 400px; margin-bottom: 10px; }
                .close-btn { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); width: 100%; max-width: 400px; opacity: 0.8; }
                .close-btn:hover { opacity: 1; background-color: var(--vscode-button-secondaryHoverBackground); }
            </style>
        </head>
        <body>
            <h1>Salesforce Inspector</h1>
            <div class="input-group">
                <input type="text" id="recordId" placeholder="Enter Record ID or URL..." value="${this._homePrefill}" autofocus>
                <button class="go-btn" onclick="submit()">Go</button>
            </div>
            ${logButton}
            <button class="action-btn close-btn" onclick="closePanel()">✖ Close</button>
            <script>
                const vscode = acquireVsCodeApi();
                const input = document.getElementById('recordId');
                input.addEventListener("keypress", function(event) {
                    if (event.key === "Enter") submit();
                });
                function submit() {
                    const val = input.value.trim();
                    if(val) vscode.postMessage({ command: 'submitId', id: val });
                }
                function requestLogScan() {
                    vscode.postMessage({ command: 'requestLogScan' });
                }
                function closePanel() {
                    vscode.postMessage({ command: 'close' });
                }
            </script>
        </body>
        </html>`;
    }

    private _getHtmlForWebview(state: HistoryState) {
        const isLive = state.view === 'RECORD';
        let fields = {};
        if (isLive) {
            fields = state.data.result || {};
            delete (fields as any).attributes;
        } else {
            fields = state.data || {};
        }

        const originalDataJson = JSON.stringify(fields).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
        const headerTitle = isLive ? `${state.objectName} <small>(${state.id})</small>` : `Variable: ${state.objectName}`;
        const nameHtml = (state.data['Name'] && isLive) ? `<h3 class="record-name">${state.data['Name']}</h3>` : '';
        const backBtnHtml = `<button class="back-btn" onclick="goBack()">⬅</button>`;

        let actionButtons = '';
        if (isLive) {
            if (this._isEditing) {
                actionButtons = `
                    <div class="edit-toolbar">
                        <button class="save-btn action-btn" onclick="saveChanges()">✔ Save</button>
                        <button class="cancel-btn action-btn" onclick="toggleEdit()">✖ Cancel</button>
                        <div class="divider"></div>
                        <button class="template-btn action-btn" onclick="askSaveTemplate()">💾 Save Preset</button>
                        <button class="template-btn action-btn" onclick="askLoadTemplate()">📋 Load Preset</button>
                    </div>
                `;
            } else {
                actionButtons = `
                    <button class="edit-btn action-btn" onclick="toggleEdit()">✎ Edit</button>
                    <button class="open-btn action-btn" onclick="openInOrg()">☁️ Open in Org</button>
                `;
            }
        } else {
            // LOG MODE BUTTONS
            let visibleIndices: number[] = [];
            const allVersions = state.logVersions || [];
            allVersions.forEach((v, i) => {
                let isNull = (!v.data || v.data === null || v.data.Value === "null");
                if (!this._ignoreNulls || !isNull) visibleIndices.push(i);
            });

            if (this._ignoreNulls && state.currentVersionIndex !== undefined && !visibleIndices.includes(state.currentVersionIndex)) {
                let next = visibleIndices.find(i => i > state.currentVersionIndex!);
                if (next === undefined) next = [...visibleIndices].reverse().find(i => i < state.currentVersionIndex!);
                if (next !== undefined) { state.currentVersionIndex = next; state.data = allVersions[next].data; fields = state.data; }
            }

            let options = '';
            visibleIndices.forEach(idx => {
                const v = allVersions[idx];
                const selected = idx === state.currentVersionIndex ? 'selected' : '';
                options += `<option value="${idx}" ${selected}>Version ${v.version} (Line ${v.lineNumber}) - ${v.timestamp}</option>`;
            });

            const checked = this._ignoreNulls ? 'checked' : '';

            // FIXED: POINTED onclick="requestLogScan()"
            actionButtons = `
                <div class="version-selector">
                    <label>History:</label>
                    <select onchange="changeVersion(this.value)">${options}</select>
                    <div class="checkbox-container">
                        <input type="checkbox" id="ignoreNulls" ${checked} onchange="toggleIgnoreNulls(this.checked)">
                        <label for="ignoreNulls">Ignore Nulls</label>
                    </div>
                    <button class="log-btn action-btn" onclick="requestLogScan()" style="margin-left:10px">🔍 New Scan</button>
                </div>
            `;
        }

        // ... Diff Logic ...
        let previousData: any = null;
        if (!isLive && state.logVersions && state.currentVersionIndex !== undefined) {
            const allVersions = state.logVersions;
            let visibleIndices: number[] = [];
            allVersions.forEach((v, i) => {
                let isNull = (!v.data || v.data === null || v.data.Value === "null");
                if (!this._ignoreNulls || !isNull) visibleIndices.push(i);
            });
            const currentPos = visibleIndices.indexOf(state.currentVersionIndex);
            if (currentPos > 0) {
                previousData = allVersions[visibleIndices[currentPos - 1]].data;
            }
        }

        let rows = '';
        const sortedKeys = Object.keys(fields).sort();

        for (const key of sortedKeys) {
            let value = (fields as any)[key];
            let rowClass = "";
            let diffTooltip = "";
            if (previousData) {
                const prevVal = previousData[key];
                if (JSON.stringify(value) !== JSON.stringify(prevVal)) {
                    rowClass = "diff-changed";
                    const safePrev = prevVal !== undefined ? String(prevVal).replace(/"/g, '&quot;') : '(undefined)';
                    diffTooltip = `title="Previous: ${safePrev}"`;
                }
            }

            let displayValue = '';
            if (value === null) displayValue = '<span class="null-val">null</span>';
            else if (typeof value === 'object') displayValue = JSON.stringify(value);
            else {
                const strVal = String(value);
                if (/^[a-zA-Z0-9]{15,18}$/.test(strVal)) displayValue = `<a href="#" onclick="inspect('${strVal}')">${strVal}</a>`;
                else displayValue = strVal.replace(/&/g, "&amp;").replace(/</g, "&lt;");
            }

            let cellContent = '';
            if (this._isEditing && isLive && key !== 'Id' && state.metadata.processedMap?.[key]?.updateable) {
                const inputVal = value === null ? '' : String(value).replace(/"/g, '&quot;');
                const meta = state.metadata.processedMap[key];
                
                if (meta.type === 'boolean') {
                    const checked = value === true ? 'checked' : '';
                    cellContent = `<input type="checkbox" class="edit-input" data-field="${key}" ${checked}>`;
                } else if (meta.type === 'picklist') {
                     let options = `<option value="">-- None --</option>`;
                     meta.picklistValues?.forEach((p:any) => {
                         const sel = p.value === value ? 'selected' : '';
                         options += `<option value="${p.value}" ${sel}>${p.label}</option>`;
                     });
                     cellContent = `<select class="edit-input" data-field="${key}">${options}</select>`;
                } else if (['double', 'percent', 'currency', 'int'].includes(meta.type)) {
                    cellContent = `<input type="number" class="edit-input" data-field="${key}" value="${inputVal}" placeholder="(${meta.type})">`;
                } else if (meta.type === 'date') {
                    cellContent = `<input type="date" class="edit-input" data-field="${key}" value="${inputVal}">`;
                } else if (meta.type === 'textarea') {
                    cellContent = `<textarea class="edit-input" data-field="${key}" rows="2" placeholder="(${meta.type})">${inputVal}</textarea>`;
                } else {
                    cellContent = `<input type="text" class="edit-input" data-field="${key}" value="${inputVal}" placeholder="(${meta.type})">`;
                }
            } else {
                cellContent = displayValue;
                if (this._isEditing && key !== 'Id') cellContent += ` 🔒`;
            }

            const safeValue = value === null ? 'null' : String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');

            rows += `<tr class="${rowClass}" ${diffTooltip}>
                <td class="field-name">
                    <div class="cell-container">
                        <button class="copy-btn" onclick="copy('${key}')" title="Copy">❐</button>
                        <span>${key}</span>
                    </div>
                </td>
                <td class="field-value">
                    <div class="cell-container">
                        ${(!this._isEditing) ? `<button class="copy-btn" onclick="copy('${safeValue}')" title="Copy">❐</button>` : ''}
                        <span class="val-text">${cellContent}</span>
                    </div>
                </td>
            </tr>`;
        }

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body { font-family: var(--vscode-font-family); margin: 0; color: var(--vscode-editor-foreground); background-color: var(--vscode-editor-background); }
                .diff-changed { background-color: rgba(255, 255, 0, 0.15); }
                .sticky-header { position: sticky; top: 0; z-index: 100; background-color: var(--vscode-editor-background); padding: 15px; border-bottom: 1px solid var(--vscode-panel-border); box-shadow: 0 4px 6px -6px rgba(0,0,0,0.5); }
                .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px; }
                .title-group { display: flex; flex-direction: column; gap: 4px; }
                .top-row { display: flex; align-items: center; gap: 10px; }
                .record-name { margin: 0; font-size: 1.4em; font-weight: normal; }
                button { cursor: pointer; padding: 6px 12px; border: none; border-radius: 2px; font-size: 12px; }
                .action-btn { min-width: 90px; }
                .open-btn { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); }
                .edit-btn { background-color: #007fd4; color: white; margin-right: 5px; }
                .log-btn { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 5px; }
                .template-btn { background-color: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); margin-left: 5px; }
                .save-btn { background-color: #2da042; color: white; margin-right: 5px; }
                .cancel-btn { background-color: #d1242f; color: white; }
                .back-btn { background: none; border: 1px solid var(--vscode-button-background); color: var(--vscode-textLink-foreground); }
                .version-selector { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
                select { padding: 5px; background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
                .checkbox-container { display: flex; align-items: center; margin-left: 10px; font-size: 12px; }
                .checkbox-container input { margin-right: 5px; }
                .search-container { margin-top: 10px; position: relative; }
                input#search { width: 100%; padding: 8px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); }
                .clear-icon { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); cursor: pointer; display: none; }
                .content { padding: 10px 15px; }
                table { width: 100%; border-collapse: collapse; font-size: 13px; }
                td { padding: 6px 8px; border-bottom: 1px solid var(--vscode-panel-border); text-align: left; vertical-align: top; }
                .field-name { width: 35%; font-weight: bold; color: var(--vscode-textLink-foreground); }
                .cell-container { display: flex; align-items: flex-start; }
                .copy-btn { background: none; border: none; color: var(--vscode-editor-foreground); opacity: 0.3; margin-right: 8px; }
                .cell-container:hover .copy-btn { opacity: 0.8; }
                .val-text { word-break: break-all; font-family: 'Courier New', monospace; flex: 1; }
                a { color: var(--vscode-textLink-foreground); text-decoration: none; }
                .edit-toolbar { display: flex; align-items: center; }
                .divider { width: 1px; height: 20px; background-color: var(--vscode-panel-border); margin: 0 10px; }
                input[type="text"], input[type="number"], input[type="date"], textarea { width: 95%; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: inherit; }
                button:disabled { opacity: 0.6; cursor: wait; }
            </style>
        </head>
        <body>
            <div class="sticky-header">
                <div class="header">
                    <div class="title-group">
                        <div class="top-row">
                            ${backBtnHtml}
                            <h2>${headerTitle}</h2>
                        </div>
                        ${nameHtml}
                    </div>
                    <div class="actions">
                        ${actionButtons}
                    </div>
                </div>
                <div class="search-container">
                    <input type="text" id="search" placeholder="Filter fields..." onkeyup="filter()">
                    <span id="clearBtn" class="clear-icon" onclick="clearSearch()">✕</span>
                </div>
            </div>
            <div class="content">
                <table id="dataTable">
                    ${rows}
                </table>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const originalData = ${originalDataJson};

                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'resetButton') {
                        const saveBtn = document.querySelector('.save-btn');
                        if (saveBtn) { saveBtn.innerText = "✔ Save"; saveBtn.disabled = false; }
                    }
                    if (message.command === 'applyTemplate') applyTemplate(message.fields);
                });

                function openInOrg() { vscode.postMessage({ command: 'openOrg', id: '${state.id}' }); }
                function copy(text) { vscode.postMessage({ command: 'copy', text: text }); }
                function inspect(newId) { vscode.postMessage({ command: 'inspect', id: newId }); }
                function goBack() { vscode.postMessage({ command: 'back' }); }
                function toggleEdit() { vscode.postMessage({ command: 'toggleEdit' }); }
                function requestLogScan() { vscode.postMessage({ command: 'requestLogScan' }); }
                function changeVersion(index) { vscode.postMessage({ command: 'changeVersion', index: index }); }
                function toggleIgnoreNulls(checked) { vscode.postMessage({ command: 'toggleIgnoreNulls', value: checked }); }
                function askSaveTemplate() { 
                    const updates = gatherUpdates(false);
                    const modified = gatherUpdates(true);
                    vscode.postMessage({ command: 'requestSaveTemplate', all: updates, modified: modified });
                }
                function askLoadTemplate() { vscode.postMessage({ command: 'requestLoadTemplate' }); }
                
                function saveChanges() { 
                    const saveBtn = document.querySelector('.save-btn');
                    if (saveBtn) { saveBtn.innerText = "⏳ Saving..."; saveBtn.disabled = true; }
                    const updates = gatherUpdates(true);
                    if (Object.keys(updates).length === 0) { vscode.postMessage({ command: 'toggleEdit' }); return; }
                    vscode.postMessage({ command: 'save', updates: updates });
                }
                function gatherUpdates(onlyChanged) {
                    const inputs = document.querySelectorAll('.edit-input');
                    const updates = {};
                    inputs.forEach(input => {
                        const field = input.getAttribute('data-field');
                        let newValue = (input.type === 'checkbox') ? input.checked : input.value;
                        if (onlyChanged) {
                            let original = originalData[field];
                            if (original === null) original = "";
                            const normalize = (val) => String(val).replace(/\\r\\n/g, "\\\\n").replace(/\\r/g, "\\\\n");
                            if (normalize(newValue) !== normalize(original)) {
                                if (input.type === 'checkbox') { if (newValue !== (original === true)) updates[field] = newValue; }
                                else updates[field] = newValue;
                            }
                        } else {
                            if (newValue !== "" && newValue !== false) updates[field] = newValue;
                        }
                    });
                    return updates;
                }

                function applyTemplate(fields) {
                    for (const [key, val] of Object.entries(fields)) {
                        const input = document.querySelector('.edit-input[data-field="' + key + '"]');
                        if (input) {
                            if (input.type === 'checkbox') input.checked = (val === true || val === 'true');
                            else input.value = val;
                            input.style.border = "1px solid #007fd4";
                        }
                    }
                }

                function clearSearch() { document.getElementById("search").value = ""; filter(); }
                function filter() {
                    var input = document.getElementById("search");
                    var clearBtn = document.getElementById("clearBtn");
                    var filter = input.value.toUpperCase();
                    clearBtn.style.display = filter.length > 0 ? "block" : "none";
                    var table = document.getElementById("dataTable");
                    var tr = table.getElementsByTagName("tr");
                    for (var i = 0; i < tr.length; i++) {
                        var tdName = tr[i].getElementsByTagName("td")[0];
                        var tdValue = tr[i].getElementsByTagName("td")[1];
                        if (tdName || tdValue) {
                            var txtName = tdName.textContent || tdName.innerText;
                            var inputEl = tdValue.querySelector('input, select, textarea');
                            var txtValue = inputEl ? inputEl.value : (tdValue.textContent || tdValue.innerText);
                            if (txtName.toUpperCase().indexOf(filter) > -1 || txtValue.toUpperCase().indexOf(filter) > -1) {
                                tr[i].style.display = "";
                            } else {
                                tr[i].style.display = "none";
                            }
                        }       
                    }
                }
            </script>
        </body>
        </html>`;
    }

    public dispose() {
        RecordPanel.currentPanel = undefined;
        this._panel.dispose();
        while (this._disposables.length) {
            const x = this._disposables.pop();
            if (x) x.dispose();
        }
    }
}