import * as vscode from 'vscode';

export class OnboardingProvider implements vscode.TreeDataProvider<vscode.TreeItem> {

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: vscode.TreeItem): Thenable<vscode.TreeItem[]> {
        if (element) {
            return Promise.resolve([]);
        }

        const items: vscode.TreeItem[] = [];

        const infoItem = new vscode.TreeItem('Duet не настроен', vscode.TreeItemCollapsibleState.None);
        infoItem.contextValue = 'info';
        infoItem.description = 'нет ~/.org.ve68.duet';
        items.push(infoItem);

        const installItem = new vscode.TreeItem('Установите Duet Host', vscode.TreeItemCollapsibleState.None);
        installItem.command = {
            command: 'duet.installHost',
            title: 'Установить Duet Host',
            tooltip: 'Запустите Duet Host для первоначальной настройки'
        };
        installItem.description = 'для настройки';
        items.push(installItem);

        return Promise.resolve(items);
    }
}
