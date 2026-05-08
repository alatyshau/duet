import * as vscode from 'vscode';

/**
 * Provides visual decorations for Duet tree items.
 *
 * Currently the only callers are `SeparatorItem` instances in
 * `ContextTreeProvider`, which set `resourceUri = duet-tree:/separator/<index>`.
 * The provider greys those rows so they read as visual gaps. Real context
 * nodes (and any `?active` styling) are not wired through this provider —
 * if/when colour decoration is needed for context nodes, both the call site
 * (set `resourceUri` on the `TreeItem`) and a new branch here have to be
 * added together.
 */
export class TreeDecorationProvider implements vscode.FileDecorationProvider {
    private static readonly scheme = 'duet-tree';

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== TreeDecorationProvider.scheme) {
            return undefined;
        }

        // Extract type from path: /separator/123 -> separator
        const type = uri.path.split('/')[1];

        if (type === 'separator') {
            return {
                color: new vscode.ThemeColor('disabledForeground')
            };
        }

        return undefined;
    }
}
