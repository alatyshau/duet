import * as vscode from 'vscode';

/**
 * Provides visual decorations for Duet tree items, by the address a row names
 * as its `resourceUri` (scheme `duet-tree`):
 *
 * - `/separator/<index>` — separator rows of «Все Бизнесы», greyed so they read as gaps;
 * - `/intent-color/<colour id>/<key>` — rows of active intents in «Активная Работа» and
 *   Корзина: the text takes the colour of the intent's window. The colour id
 *   is one of the theme colours the extension declares (`duet.intent.color1`…),
 *   built by `providers/rowLook.ts:rowColorResource`. The colour is a function
 *   of the address alone, so a window that changes its colour gives its rows a
 *   new address and no change event is needed.
 */
export class TreeDecorationProvider implements vscode.FileDecorationProvider {
    private static readonly scheme = 'duet-tree';

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (uri.scheme !== TreeDecorationProvider.scheme) {
            return undefined;
        }

        // /separator/123 -> ['', 'separator', '123']
        const [, type, value] = uri.path.split('/');

        if (type === 'separator') {
            return {
                color: new vscode.ThemeColor('disabledForeground')
            };
        }
        if (type === 'intent-color' && /^duet\.intent\.color\d+$/.test(value ?? '')) {
            return {
                color: new vscode.ThemeColor(value)
            };
        }

        return undefined;
    }
}
