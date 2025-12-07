export interface VariableVersion {
    version: number;
    timestamp: string;
    lineNumber: string;
    rawLine: string;
    data: any;
}

export class LogHistoryService {

    public static parseLog(logContent: string, variableName: string): VariableVersion[] {
        const versions: VariableVersion[] = [];
        const lines = logContent.split('\n');
        
        // Regex to capture: Timestamp ... |VARIABLE_ASSIGNMENT|[Line]|VarName|Value|...
        // We match literal pipe characters \|
        // Group 1: Timestamp
        // Group 2: Line Number
        // Group 3: Value string (greedy match until next pipe or end)
        const regex = new RegExp(`^([0-9:.]+) .*\\|VARIABLE_ASSIGNMENT\\|\\[(\\d+)\\]\\|${variableName}\\|(.*)(\\||$)`);

        let versionCounter = 1;

        for (const line of lines) {
            // Quick check to avoid regex on every line
            if (!line.includes(variableName) || !line.includes("VARIABLE_ASSIGNMENT")) continue;

            const match = line.match(regex);
            if (match) {
                const timestamp = match[1];
                const lineNumber = match[2];
                let valueStr = match[3];

                // Cleanup trailing metadata if exists (e.g. |0x2cedb539)
                if (valueStr.includes('|')) {
                    valueStr = valueStr.substring(0, valueStr.lastIndexOf('|'));
                }

                let parsedData: any = {};

                // Attempt to parse JSON
                try {
                    // 1. Is it a complex object/list?
                    if (valueStr.startsWith('{') || valueStr.startsWith('[')) {
                        const obj = JSON.parse(valueStr);
                        
                        // If it's a list, grab the first item for the inspector view
                        if (Array.isArray(obj)) {
                            parsedData = obj.length > 0 ? obj[0] : { "info": "Empty List" };
                        } else {
                            parsedData = obj;
                        }
                    } else {
                        // 2. Primitive (String, Number, Boolean)
                        parsedData = { "Value": valueStr };
                    }
                } catch (e) {
                    // 3. Parsing Failed (Truncated log or weird format)
                    parsedData = { 
                        "Raw Value": valueStr,
                        "_warning": "Could not parse JSON (likely truncated in log)"
                    };
                }

                versions.push({
                    version: versionCounter++,
                    timestamp,
                    lineNumber,
                    rawLine: line,
                    data: parsedData
                });
            }
        }

        return versions;
    }
}