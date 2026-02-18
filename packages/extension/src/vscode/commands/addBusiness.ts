import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DuetApiClient } from '../../core/api-client';

export async function addBusiness(apiClient: DuetApiClient): Promise<void> {
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

    try {
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

        // Add via backend API (writes to DuetConfig/settings.json + rescans)
        const result = await apiClient.addBusiness(businessPath);

        if (result.status === 'exists') {
            vscode.window.showInformationMessage('Business folder already added.');
            return;
        }

        vscode.window.showInformationMessage(`Added business: ${businessPath}`);
        await vscode.commands.executeCommand('duet.refresh');

    } catch (err) {
        vscode.window.showErrorMessage(`Failed to add business: ${err}`);
    }
}
