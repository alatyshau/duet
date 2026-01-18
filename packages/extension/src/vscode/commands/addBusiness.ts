import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigManager } from '../../core/config';
import { Paths } from '../../core/paths';

export async function addBusiness(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('duet');
    const dataFolder = config.get<string>('data_folder');
    if (!dataFolder) {
        vscode.window.showErrorMessage("Duet Data Folder not configured.");
        return;
    }

    const uris = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select Business Folder'
    });

    if (!uris || uris.length === 0) {
        return;
    }

    const businessPath = uris[0].fsPath;
    const paths = new Paths(dataFolder);
    const configManager = new ConfigManager(paths.configPath);

    try {
        const duetConfig = await configManager.read();
        
        if (duetConfig.businessFolders.includes(businessPath)) {
            vscode.window.showInformationMessage('Business folder already added.');
            return;
        }

        // Check/Create manifest
        const manifestPath = path.join(businessPath, 'business.json');
        try {
            await fs.access(manifestPath);
        } catch {
            const defaultManifest = {
                name: path.basename(businessPath),
                icon: '📁'
            };
            await fs.writeFile(manifestPath, JSON.stringify(defaultManifest, null, 2));
        }

        duetConfig.businessFolders.push(businessPath);
        await configManager.write(duetConfig);

        vscode.window.showInformationMessage(`Added business: ${businessPath}`);
        await vscode.commands.executeCommand('duet.refresh');

    } catch (err) {
        vscode.window.showErrorMessage(`Failed to add business: ${err}`);
    }
}
