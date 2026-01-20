import * as vscode from 'vscode';
import { Scanner } from '../../core/scanner';
import { DatabaseManager } from '../../core/db';
import { ConfigManager } from '../../core/config';
import { Paths } from '../../core/paths';

// Singleton OutputChannel for scan errors
let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
    if (!outputChannel) {
        outputChannel = vscode.window.createOutputChannel('Duet Scanner');
    }
    return outputChannel;
}

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

    // Collect errors during scan - write to OutputChannel instead of toasts
    const errors: string[] = [];
    const channel = getOutputChannel();
    channel.clear();

    const scanner = new Scanner(db, configManager, (msg) => {
        errors.push(msg);
        channel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
    });

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Scanning Duet...",
        cancellable: false
    }, async () => {
        try {
            await scanner.scan();
        } catch (error) {
            errors.push(`Scan failed: ${error}`);
            channel.appendLine(`[${new Date().toLocaleTimeString()}] Scan failed: ${error}`);
        }
    });

    // Show one summary notification if there were errors
    if (errors.length > 0) {
        const action = await vscode.window.showWarningMessage(
            `Scan completed with ${errors.length} error(s). See Output for details.`,
            'Show Output'
        );
        if (action === 'Show Output') {
            channel.show();
        }
    }
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
