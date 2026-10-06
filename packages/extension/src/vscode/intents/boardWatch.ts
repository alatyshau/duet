import * as vscode from 'vscode';
import { DiskChange, TicketBoard } from '../../core/intents/board';

/**
 * Where a change of the business folder matters to the board. A pattern ends
 * at the depth it names: `*` does not cross a folder, so the files inside a
 * ticket other than its `INDEX.md` are no one's event.
 */
const WATCHED: ReadonlyArray<{ pattern: string; change: DiskChange }> = [
    // A ticket folder came, went or was renamed
    { pattern: '{work,backlog}/*', change: 'shelves' },
    // The order of the bin was written by another window or program
    { pattern: '.vscode/duet-intents.json', change: 'shelves' },
    // `parent`, `work-type` and `icon` of a ticket decide where and how its row stands
    { pattern: '{work,backlog}/*/INDEX.md', change: 'ticket' }
];

/**
 * Tell the board that the business folder changed. The folder is the first
 * folder of the window, which the program watches already: these watchers read
 * nothing and only pick their events out of that stream. The kind of an event
 * is not passed on — a file written again may come as a create.
 *
 * The file events are the only signal. The board is not asked to look again
 * when the window gets the focus: such a check would hide an event that never
 * came, and the refresh button of the view is there for that case.
 */
export function watchBoard(board: TicketBoard): vscode.Disposable {
    let watched: string | null = null;
    let watchers: vscode.Disposable[] = [];

    const rewatch = () => {
        const businessPath = board.getBusinessPath();
        if (businessPath === watched) {
            return;
        }
        watched = businessPath;
        watchers.forEach(w => w.dispose());
        watchers = [];
        if (!businessPath) {
            return;
        }
        for (const { pattern, change } of WATCHED) {
            const watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(vscode.Uri.file(businessPath), pattern)
            );
            const changed = () => board.diskChanged(change);
            watchers.push(
                watcher,
                watcher.onDidCreate(changed),
                watcher.onDidChange(changed),
                watcher.onDidDelete(changed)
            );
        }
    };
    rewatch();

    // The board changes its business through this very event
    const subscription = board.onDidChange(rewatch);
    return {
        dispose: () => {
            subscription.dispose();
            watchers.forEach(w => w.dispose());
        }
    };
}
