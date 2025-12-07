import * as cp from 'child_process';
import * as util from 'util';
import * as vscode from 'vscode';

const exec = util.promisify(cp.exec);

export class SfdxService {

    private static outputChannel = vscode.window.createOutputChannel("SF Inspector Debug");

    private static async runCommand(cmd: string): Promise<any> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

        try {
            const { stdout } = await exec(cmd, { 
                cwd: workspaceRoot, 
                maxBuffer: 1024 * 1024 * 10 
            });
            return stdout ? JSON.parse(stdout) : {};

        } catch (err: any) {
            // ... (Logging Logic kept same) ...
            this.outputChannel.show(true); 
            this.outputChannel.appendLine("---------------------------------------------------");
            this.outputChannel.appendLine("[ERROR] Execution Failed");
            this.outputChannel.appendLine(`[COMMAND] ${cmd}`);
            if (err.stderr) this.outputChannel.appendLine(`[STDERR] ${err.stderr}`);
            if (err.stdout) this.outputChannel.appendLine(`[STDOUT] ${err.stdout}`);
            this.outputChannel.appendLine(`[MESSAGE] ${err.message}`);
            this.outputChannel.appendLine("---------------------------------------------------");
            
            if (err.message.includes("sf: not found")) {
                throw new Error("VS Code cannot find the 'sf' command.");
            }
            
            let errMsg = err.message;
            if (err.stdout) {
                try {
                    const jsonErr = JSON.parse(err.stdout);
                    if (jsonErr.message) errMsg = jsonErr.message;
                    if (Array.isArray(jsonErr) && jsonErr[0] && jsonErr[0].message) errMsg = jsonErr[0].message;
                } catch (e) {}
            }
            throw new Error(errMsg);
        }
    }

    public static async getOrgInfo() {
        const result = await this.runCommand('sf config get target-org --json');
        if (result.status === 0 && result.result && result.result.length > 0) {
            return result.result[0].value;
        }
        return null;
    }

    public static async isProduction(): Promise<boolean> {
        try {
            const result = await this.runCommand('sf org display --json');
            if (result.result) {
                if (result.result.isSandbox === false) return true;
                if (result.result.instanceUrl && result.result.instanceUrl.includes("login.salesforce.com")) return true;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    public static async fetchAllPrefixes() {
        const query = "SELECT KeyPrefix, QualifiedApiName FROM EntityDefinition WHERE KeyPrefix != NULL LIMIT 2000";
        return await this.runCommand(`sf data query -q "${query}" --json`);
    }

    public static async fetchSinglePrefix(prefix: string) {
        const query = `SELECT QualifiedApiName FROM EntityDefinition WHERE KeyPrefix = '${prefix}' LIMIT 1`;
        return await this.runCommand(`sf data query -q "${query}" --json`);
    }

    public static async getRecordData(sobject: string, id: string) {
        return await this.runCommand(`sf data get record -s ${sobject} -i ${id} --json`);
    }

    public static async getMetadata(sobject: string) {
        return await this.runCommand(`sf sobject describe -s ${sobject} --json`);
    }

    // --- CRITICAL FIX: QUOTING ---
    public static async updateRecord(sobject: string, id: string, fields: any) {
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

        if (!valuesStr) throw new Error("Failed to construct update values.");

        // Wrap the whole thing in double quotes
        return await this.runCommand(`sf data update record -s ${sobject} -i ${id} --values "${valuesStr}" --json`);
    }

    public static async openOrg(id: string) {
        return await this.runCommand(`sf org open --path /${id} --json`);
    }
}