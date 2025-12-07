"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SfdxService = void 0;
const cp = require("child_process");
const util = require("util");
const vscode = require("vscode");
const exec = util.promisify(cp.exec);
class SfdxService {
    static async runCommand(cmd) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        try {
            const { stdout } = await exec(cmd, {
                cwd: workspaceRoot,
                maxBuffer: 1024 * 1024 * 10
            });
            return stdout ? JSON.parse(stdout) : {};
        }
        catch (err) {
            // ... (Logging Logic kept same) ...
            this.outputChannel.show(true);
            this.outputChannel.appendLine("---------------------------------------------------");
            this.outputChannel.appendLine("[ERROR] Execution Failed");
            this.outputChannel.appendLine(`[COMMAND] ${cmd}`);
            if (err.stderr)
                this.outputChannel.appendLine(`[STDERR] ${err.stderr}`);
            if (err.stdout)
                this.outputChannel.appendLine(`[STDOUT] ${err.stdout}`);
            this.outputChannel.appendLine(`[MESSAGE] ${err.message}`);
            this.outputChannel.appendLine("---------------------------------------------------");
            if (err.message.includes("sf: not found")) {
                throw new Error("VS Code cannot find the 'sf' command.");
            }
            let errMsg = err.message;
            if (err.stdout) {
                try {
                    const jsonErr = JSON.parse(err.stdout);
                    if (jsonErr.message)
                        errMsg = jsonErr.message;
                    if (Array.isArray(jsonErr) && jsonErr[0] && jsonErr[0].message)
                        errMsg = jsonErr[0].message;
                }
                catch (e) { }
            }
            throw new Error(errMsg);
        }
    }
    static async getOrgInfo() {
        const result = await this.runCommand('sf config get target-org --json');
        if (result.status === 0 && result.result && result.result.length > 0) {
            return result.result[0].value;
        }
        return null;
    }
    static async isProduction() {
        try {
            const result = await this.runCommand('sf org display --json');
            if (result.result) {
                if (result.result.isSandbox === false)
                    return true;
                if (result.result.instanceUrl && result.result.instanceUrl.includes("login.salesforce.com"))
                    return true;
            }
            return false;
        }
        catch (e) {
            return false;
        }
    }
    static async fetchAllPrefixes() {
        const query = "SELECT KeyPrefix, QualifiedApiName FROM EntityDefinition WHERE KeyPrefix != NULL LIMIT 2000";
        return await this.runCommand(`sf data query -q "${query}" --json`);
    }
    static async fetchSinglePrefix(prefix) {
        const query = `SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '${prefix}' LIMIT 1`;
        return await this.runCommand(`sf data query -q "${query}" --json`);
    }
    static async getRecordData(sobject, id) {
        return await this.runCommand(`sf data get record -s ${sobject} -i ${id} --json`);
    }
    static async getMetadata(sobject) {
        return await this.runCommand(`sf sobject describe -s ${sobject} --json`);
    }
    // --- CRITICAL FIX: QUOTING ---
    static async updateRecord(sobject, id, fields) {
        let valuesStr = "";
        if (!fields || Object.keys(fields).length === 0) {
            throw new Error("No updateable fields found or no changes detected.");
        }
        for (const [key, val] of Object.entries(fields)) {
            // Fix: Use SINGLE QUOTES wrapping the value: Key='Value'
            // Escape any single quotes INSIDE the value: O'Reilly -> O'\''Reilly
            let safeVal = String(val).replace(/'/g, "'\\''");
            valuesStr += `${key}='${safeVal}' `;
        }
        valuesStr = valuesStr.trim();
        if (!valuesStr)
            throw new Error("Failed to construct update values.");
        // Wrap the whole thing in double quotes
        return await this.runCommand(`sf data update record -s ${sobject} -i ${id} --values "${valuesStr}" --json`);
    }
    static async openOrg(id) {
        return await this.runCommand(`sf org open --path /${id} --json`);
    }
}
exports.SfdxService = SfdxService;
SfdxService.outputChannel = vscode.window.createOutputChannel("SF Inspector Debug");
//# sourceMappingURL=sfdxService.js.map