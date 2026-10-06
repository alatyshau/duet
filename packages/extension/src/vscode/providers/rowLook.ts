import * as vscode from 'vscode';
import { intentColorId } from '../../core/intents/colors';
import { RowText } from '../../core/intents/naming';
import { rowIconDataUri } from '../../core/intents/rowIcon';

/**
 * The parts of a row's look the two intent views share: the icon picture at
 * the left edge, the backdrop under the name and the colour of the text.
 */

const iconCache = new Map<string, vscode.Uri>();

/** Icon of a row: its emoji as a picture, or an empty picture so that all names start in one column. */
export function rowIcon(emoji: string): vscode.Uri {
    let uri = iconCache.get(emoji);
    if (!uri) {
        uri = vscode.Uri.parse(rowIconDataUri(emoji));
        iconCache.set(emoji, uri);
    }
    return uri;
}

/**
 * Label of a row. In the row of the window you are in the name stands on a
 * backdrop: it is highlighted the way a search match is — the only background
 * the tree lets a row have. The same in both views, so the window is told by
 * one sign wherever its row is shown.
 */
export function rowLabel(text: RowText, own: boolean): vscode.TreeItemLabel {
    return { label: text.label, highlights: own ? [text.name] : [] };
}

/**
 * Address that makes the text of a row take the colour of a window. The tree
 * has no call for "this colour for this row": a row names a resource, and
 * `TreeDecorationProvider` answers with the colour written into the address.
 * Undefined when the window colour is not one of the palette — the row keeps
 * the colour of the theme.
 */
export function rowColorResource(color: string | null, key: string): vscode.Uri | undefined {
    const id = intentColorId(color);
    return id
        ? vscode.Uri.from({ scheme: 'duet-tree', path: `/intent-color/${id}/${encodeURIComponent(key)}` })
        : undefined;
}
