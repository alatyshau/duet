import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { normalizePath } from '../../core/pathUtils';
import { intentIdentity, notepadHeading } from '../../core/intents/naming';
import { newNotepadText, planNotepadFix } from '../../core/intents/notepad';
import { IntentsRuntime } from './IntentsRuntime';

/** `workspaceState` key: the window session in which the notepad was last pinned. */
const PINNED_SESSION_KEY = 'duet.intent.notepadPinnedSession';

/**
 * In an intent window, at start: make sure the ticket has a notepad with the
 * right heading, and that it is open in a pinned tab.
 *
 * Runs in the intent window only. Never creates the ticket folder.
 *
 * @param known - told the path of the notepad as soon as the file is there
 */
export async function ensureNotepad(
    context: vscode.ExtensionContext,
    runtime: IntentsRuntime,
    known?: (file: string) => void
): Promise<void> {
    const place = await runtime.ownTicketPlace();
    const identity = place ? intentIdentity(place.folder) : null;
    if (!place || !identity) {
        return;
    }
    // Only `notepad.md` right in the ticket folder is the intent's notepad
    const file = path.join(place.path, 'notepad.md');
    const heading = notepadHeading(identity);

    let created = false;
    try {
        await fs.access(file);
    } catch {
        try {
            // `wx`: never over a file that appeared meanwhile; no mkdir — the ticket folder is not Duet's to create
            await fs.writeFile(file, newNotepadText(heading), { encoding: 'utf8', flag: 'wx' });
            created = true;
        } catch {
            return;
        }
    }

    known?.(file);

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    if (!created) {
        await fixHeading(document, heading);
    }
    await pinOncePerSession(context, document);
}

/**
 * Bring the first line to the heading through the editor's document, then
 * save. A notepad with unsaved changes is left alone this time.
 */
async function fixHeading(document: vscode.TextDocument, heading: string): Promise<void> {
    if (document.isDirty) {
        return;
    }
    const fix = planNotepadFix(document.getText(), heading);
    if (fix.kind === 'none') {
        return;
    }
    const edit = new vscode.WorkspaceEdit();
    if (fix.kind === 'replace') {
        edit.replace(document.uri, document.lineAt(fix.line).range, fix.text);
    } else {
        const at = fix.line < document.lineCount
            ? new vscode.Position(fix.line, 0)
            : document.lineAt(document.lineCount - 1).range.end;
        edit.insert(document.uri, at, fix.text);
    }
    if (await vscode.workspace.applyEdit(edit)) {
        await document.save();
    }
}

/**
 * Open the notepad in a pinned tab unless one is there already — at most once
 * per window session. The extension may restart inside a living window; a
 * second pinning then would undo the user's choice to unpin or close the tab,
 * which holds until the window starts again.
 */
async function pinOncePerSession(context: vscode.ExtensionContext, document: vscode.TextDocument): Promise<void> {
    if (context.workspaceState.get<string>(PINNED_SESSION_KEY) === vscode.env.sessionId) {
        return;
    }
    await context.workspaceState.update(PINNED_SESSION_KEY, vscode.env.sessionId);

    const file = normalizePath(document.uri.fsPath);
    const isNotepad = (tab: vscode.Tab | undefined): boolean =>
        tab?.input instanceof vscode.TabInputText && normalizePath(tab.input.uri.fsPath) === file;
    if (vscode.window.tabGroups.all.some(group => group.tabs.some(tab => tab.isPinned && isNotepad(tab)))) {
        return;
    }

    const group = vscode.window.tabGroups.activeTabGroup;
    const previous = group.activeTab;
    // Opened in the active group without taking the focus, so the pin command below acts on it
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: true });
    if (!isNotepad(vscode.window.tabGroups.activeTabGroup.activeTab)) {
        return;
    }
    await vscode.commands.executeCommand('workbench.action.pinEditor');

    // Back to the tab the user was on, so the notepad does not take them out of the chat
    if (!previous || isNotepad(previous)) {
        return;
    }
    if (previous.input instanceof vscode.TabInputText) {
        await vscode.window.showTextDocument(previous.input.uri, {
            viewColumn: group.viewColumn,
            preview: previous.isPreview,
            preserveFocus: true
        });
    } else {
        // A tab that is not a text file (a chat, a preview) can only be returned to as the previous one in the group
        await vscode.commands.executeCommand('workbench.action.openPreviousRecentlyUsedEditorInGroup');
    }
}
