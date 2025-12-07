import * as vscode from 'vscode';
import { SfdxService } from './sfdxService';

interface PrefixMap {
    [key: string]: string; // '001' -> 'Account'
}

export class PrefixService {
    private context: vscode.ExtensionContext;
    private cacheKey = 'sfInspectorPrefixCache';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Called on startup. Updates the cache in background.
     */
    public async warmCache() {
        try {
            const orgUser = await SfdxService.getOrgInfo();
            if (!orgUser) return; // No org connected

            const response = await SfdxService.fetchAllPrefixes();
            
            if (response.result && response.result.records) {
                const newMap: PrefixMap = {};
                response.result.records.forEach((rec: any) => {
                    if (rec.KeyPrefix && rec.QualifiedApiName) {
                        newMap[rec.KeyPrefix] = rec.QualifiedApiName;
                    }
                });

                // Store in global state keyed by Org User to support multi-org
                const globalStore = this.context.globalState.get<any>(this.cacheKey) || {};
                globalStore[orgUser] = newMap;
                await this.context.globalState.update(this.cacheKey, globalStore);
            }
        } catch (e) {
            console.warn("Warm cache failed", e);
        }
    }

    /**
     * Resolves ID to Object Name using Cache First, then API.
     */
    public async resolveObjectName(id: string): Promise<string | null> {
        const prefix = id.substring(0, 3);
        const orgUser = await SfdxService.getOrgInfo();
        
        if (!orgUser) throw new Error("No default Salesforce Org found. Please run 'sf config set target-org'.");

        // 1. Check Cache
        const globalStore = this.context.globalState.get<any>(this.cacheKey) || {};
        const orgCache = globalStore[orgUser];

        if (orgCache && orgCache[prefix]) {
            console.log(`Cache Hit: ${prefix} -> ${orgCache[prefix]}`);
            return orgCache[prefix];
        }

        // 2. Cache Miss? Try Fallback Query (Just-In-Time)
        console.log(`Cache Miss for ${prefix}. Querying API...`);
        const response = await SfdxService.fetchSinglePrefix(prefix);
        
        if (response.result && response.result.records && response.result.records.length > 0) {
            const objName = response.result.records[0].QualifiedApiName;
            
            // Update Cache for next time
            if (!globalStore[orgUser]) globalStore[orgUser] = {};
            globalStore[orgUser][prefix] = objName;
            await this.context.globalState.update(this.cacheKey, globalStore);
            
            return objName;
        }

        return null; // Truly unknown prefix
    }
}
