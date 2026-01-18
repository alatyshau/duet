import * as vscode from 'vscode';
import { Scanner } from '../../core/scanner';
import { DatabaseManager } from '../../core/db';
import { ConfigManager } from '../../core/config';
import { Paths } from '../../core/paths';

export async function refresh(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('duet');
    const dataFolder = config.get<string>('data_folder');

    if (!dataFolder) {
        vscode.window.showWarningMessage('Duet Data Folder is not configured.');
        return;
    }

    const paths = new Paths(dataFolder);
    const db = new DatabaseManager(paths);

    // In VSIX environment, we need to locate the WASM file manually
    const wasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'sql-wasm.wasm').fsPath;
    
    // Scanner will init db, but we need to pass options somehow?
    // Scanner calls db.init(), but doesn't pass options.
    // Solution: Init DB here with options before passing to Scanner.
    // Scanner checks if (this.db) { return; } inside init(), so it's safe.
    await db.init({ wasmPath });

    const configManager = new ConfigManager(paths.configPath);
    const scanner = new Scanner(db, configManager, (msg) => vscode.window.showErrorMessage(msg));

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Scanning Duet...",
        cancellable: false
    }, async () => {
        try {
            await scanner.scan();
        } catch (error) {
            vscode.window.showErrorMessage(`Scan failed: ${error}`);
        }
    });
}

export async function dumpIndex(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('duet');
    const dataFolder = config.get<string>('data_folder');

    if (!dataFolder) {
        return;
    }

    const paths = new Paths(dataFolder);
    const db = new DatabaseManager(paths);
    
    // In VSIX environment, we need to locate the WASM file manually
    const wasmPath = vscode.Uri.joinPath(context.extensionUri, 'dist', 'sql-wasm.wasm').fsPath;
    await db.init({ wasmPath });
    
    const dump = db.dump();
    const output = vscode.window.createOutputChannel('Duet Index');
    output.appendLine(JSON.stringify(dump, null, 2));
    output.show();
}
