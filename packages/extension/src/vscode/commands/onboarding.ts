import * as vscode from 'vscode';

/**
 * Open Duet Host download page or show installation instructions.
 */
export async function installHost(): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        'Для работы Duet нужен Duet Host.\n\nЗапустите Host приложение — оно создаст файл конфигурации ~/.org.ve68.duet',
        'Перезагрузить окно'
    );

    if (action === 'Перезагрузить окно') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
}
