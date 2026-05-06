import * as vscode from 'vscode';
import * as path from 'path';
import { formatAtReference } from '../../core/pathUtils';

/**
 * Best-effort fallback for keyboard invocation: VS Code does not pass the
 * Explorer selection through keybindings (only through context-menu clicks).
 * When the user hits the shortcut while editing, the active editor / tab
 * input gives the most natural "current file" interpretation.
 *
 * Limitation: folders are not reachable this way — they don't open in an
 * editor, so the keybinding cannot copy a folder's @-reference. Folders
 * must be copied via the Explorer right-click menu, which does pass the
 * resource through `(resource, resources)`.
 */
function activeResource(): vscode.Uri | undefined {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
        return editor.document.uri;
    }
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    if (input instanceof vscode.TabInputText
        || input instanceof vscode.TabInputCustom
        || input instanceof vscode.TabInputNotebook) {
        return input.uri;
    }
    return undefined;
}

/**
 * Copy each selected resource as a Duet @-reference: `` `@<rootFolder>/<relative>` ``.
 *
 * Invocation paths:
 *   - Explorer context menu → VS Code passes `(resource, resources)`; the
 *     second arg covers multi-select.
 *   - Keybinding from the editor → no args; we fall back to the active editor
 *     / tab input so the shortcut works without first re-focusing Explorer.
 *
 * Resources outside any workspace folder are skipped with a single aggregated
 * warning; if nothing remains, the clipboard is left untouched. Multiple
 * references are joined with newlines (matches native Copy Relative Path).
 */
export async function copyAtPath(resource?: vscode.Uri, resources?: vscode.Uri[]): Promise<void> {
    let targets: readonly vscode.Uri[];
    if (resources && resources.length > 0) {
        targets = resources;
    } else if (resource) {
        targets = [resource];
    } else {
        const fallback = activeResource();
        targets = fallback ? [fallback] : [];
    }

    if (targets.length === 0) {
        return;
    }

    const lines: string[] = [];
    const skipped: vscode.Uri[] = [];

    for (const uri of targets) {
        const folder = vscode.workspace.getWorkspaceFolder(uri);
        if (!folder) {
            skipped.push(uri);
            continue;
        }
        // basename of an FS root ('/' on POSIX, 'C:\\' on Windows) is empty;
        // fall back to the workspace folder's display name in that case.
        const rootName = path.basename(folder.uri.fsPath) || folder.name;
        const relative = path.relative(folder.uri.fsPath, uri.fsPath);
        lines.push(formatAtReference(rootName, relative));
    }

    if (lines.length > 0) {
        await vscode.env.clipboard.writeText(lines.join('\n'));
    }

    if (skipped.length > 0) {
        const sample = skipped[0].fsPath;
        const more = skipped.length > 1 ? ` (+${skipped.length - 1})` : '';
        vscode.window.showWarningMessage(`Файл вне воркспейса: ${sample}${more}`);
    }
}
