import * as vscode from 'vscode';

/**
 * Provides visual decorations for Duet tree items.
 * Uses custom URI scheme 'duet-tree:/<type>/<entityId>'
 */
export class TreeDecorationProvider implements vscode.FileDecorationProvider {
    private static readonly scheme = 'duet-tree';

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== TreeDecorationProvider.scheme) {
            return undefined;
        }

        // Extract type from path: /business/123 -> business
        const type = uri.path.split('/')[1];
        const isActive = uri.query === 'active';

        // Active (loaded) nodes — red/orange
        if (isActive) {
            return {
                color: new vscode.ThemeColor('charts.red')
            };
        }

        // Business nodes — blue
        if (type === 'business') {
            return {
                color: new vscode.ThemeColor('charts.blue')
            };
        }

        return undefined;
    }
}
