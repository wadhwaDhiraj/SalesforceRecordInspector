# Salesforce Record Inspector — User Guide

The Salesforce Record Inspector is a VS Code extension that lets you quickly inspect, edit, and analyze Salesforce records and Apex debug logs without leaving your editor. This guide explains every feature step-by-step.

## Prerequisites

- VS Code 1.80.0 or newer.
- Salesforce CLI (`sf`) installed and accessible in your PATH.

If `sf` isn’t found or no default org is set, the extension will show helpful error messages.

## Core Concepts

- Inspect Mode (LIVE): View and edit a Salesforce record by ID.
- Log Mode (LOG): Analyze variable assignments across an Apex debug log.
- Presets: Save commonly used field values and apply them later.
- History: Navigate back to previous views.

## Commands and Context Menu

- Inspect Salesforce Record: Command Palette or editor context menu.
- Inspect Salesforce Record (from Clipboard): Uses the latest copied text.
- Save Salesforce Record: Appears in the panel while editing.
- Scan Log Variable History: Command Palette or context menu on .log files.

Tip: Right-click in the editor to use context menu options. For .log files, you’ll see “Scan Log Variable History.”

## Inspecting a Record (LIVE Mode)

1. Select a Salesforce ID (15 or 18 characters) in the editor and run “Inspect Salesforce Record.”
   - Or copy an ID to your clipboard and run “Inspect Salesforce Record (from Clipboard).”
   - The extension auto-detects the object using the ID prefix (e.g., 001 → Account).
2. The panel opens beside your editor showing:
   - Title: Object API name and the record ID.
   - Optional record name (if the “Name” field exists).
   - All fields and their values, sorted alphabetically.
   - Quick copy buttons for field names and values.
   - A filter box to quickly search by field name or value.

### Actions in LIVE Mode

- Edit: Switches the panel to editable mode.
- Open in Org: Opens the record in your connected Salesforce org.
- Log History: Jump to log analysis (LOG Mode).

### Editing Fields

Click “Edit” to enable editing. You’ll see:
- Inputs based on field types:
  - Checkbox for boolean
  - Dropdown for picklist
  - Number inputs for numeric fields
  - Date picker for date fields
  - Textarea for long text
  - Text input for other types
- Only updateable fields are editable. Locked fields show a lock icon when editing is on.
- You can:
  - Save: Applies only modified fields and reloads fresh record data.
  - Cancel: Exits editing without changes.
  - Save Preset: Save current input values as a reusable preset.
  - Load Preset: Apply a previously saved preset to inputs.

Safety:
- If the org is Production, you’ll get a confirmation dialog before saving.

### Save Presets

- Save Preset:
  - Choose “Save All” (all visible inputs) or “Save Modified” (only changed inputs).
  - Name your preset (e.g., “Standard Setup”).
- Load Preset:
  - Choose from saved presets for the current object.
  - Values are applied to inputs and highlighted.

Presets are stored per object type in VS Code’s global state, scoped by your org user.

### Navigation

- Back: Return to the previous view (e.g., prior record or log analysis).
- Inspect linked IDs: Any field value that looks like a Salesforce ID is clickable. Click to drill into that record.

## Scanning Apex Debug Logs (LOG Mode)

Use this when you have a .log file open or selected.

1. Open your .log file in VS Code.
2. Run “Scan Log Variable History.”
   - If you selected text in the editor, it will pre-fill the variable name.
   - Otherwise, enter the variable name (e.g., `newAccountList`).
3. The panel displays versions of the variable over time:
   - History selector: Choose a specific version by timestamp and line number.
   - Ignore Nulls: Hide entries where the variable value is null.
   - New Scan: Start another scan on the current/open log.
4. This only works for single variables, and not list or any other type of variables.

Data display:
- If the assignment looks like JSON, it’s parsed and shown as a structured object.
- If it’s a list, the first item is shown for quick inspection.
- Non-JSON values are shown as “Value: <text>”.
- Changes between versions are highlighted. Hover to see the previous value.

Tip: You can filter field names or values with the search box, even in LOG Mode.

## Status and Output

- Progress notifications: Shown while identifying object, fetching data, saving, and scanning logs.
- Output Channel “SF Inspector Debug”: Shows command errors or details if something fails.
- Clear system messages guide you if:
  - No default org is set.
  - The ID is invalid.
  - The record is not found.
  - The `sf` CLI isn’t available.

## Troubleshooting

- “VS Code cannot find the 'sf' command.”:
  - Ensure Salesforce CLI is installed and added to PATH.
  - On macOS (zsh), restart your terminal after installation.
- “No default Salesforce Org found.”:
  - Run: `sf config set target-org <aliasOrUsername>`.
- Record shows no data:
  - Verify the ID is correct and accessible in the target org.
- Log scan finds no versions:
  - Confirm the log contains `VARIABLE_ASSIGNMENT` lines for your variable.
  - Make sure the variable name matches exactly.

## Where things run

- All Salesforce interactions happen via the `sf` CLI in your workspace folder.
- The panel is a Webview beside your editor, with copy, search, edit, and navigation controls.

## Quick Usage Flow

- Inspect from selection or clipboard → View fields → Edit if needed → Save or open in org.
- Open a .log → Scan for variable → Browse versions → Filter or rescan as needed.

That’s it. You can now inspect, edit, and analyze Salesforce data directly in VS Code with confidence.
