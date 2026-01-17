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

        // Information text
        const infoItem = new vscode.TreeItem('Укажите папку для данных:', vscode.TreeItemCollapsibleState.None);
        infoItem.contextValue = 'info';
        items.push(infoItem);

        // Select/Create Folder Button
        const selectItem = new vscode.TreeItem('📁 Выбрать папку DuetData...', vscode.TreeItemCollapsibleState.None);
        selectItem.command = {
            command: 'duet.selectDataFolder',
            title: 'Выбрать папку',
            tooltip: 'Выбрать или создать папку DuetData'
        };
        items.push(selectItem);

        return Promise.resolve(items);
    }
}
