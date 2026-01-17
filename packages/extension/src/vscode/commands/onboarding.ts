import * as vscode from 'vscode';
import * as os from 'os';

export async function selectDataFolder(): Promise<void> {
    const defaultUri = vscode.Uri.file(os.homedir());

    const options: vscode.OpenDialogOptions = {
        defaultUri,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Выбрать папку DuetData',
        title: 'Выберите или создайте папку для данных Duet'
    };

    const uris = await vscode.window.showOpenDialog(options);
    if (uris && uris.length > 0) {
        const selectedPath = uris[0].fsPath;
        await updateDataFolderSetting(selectedPath);
        vscode.window.showInformationMessage(`Папка DuetData: ${selectedPath}`);
    }
}

async function updateDataFolderSetting(folderPath: string): Promise<void> {
    const config = vscode.workspace.getConfiguration('duet');
    await config.update('data_folder', folderPath, vscode.ConfigurationTarget.Global);
}
