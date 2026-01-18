import * as vscode from 'vscode';
import { ProjectsList, ProjectItem } from '../../core/tree/projectsList';
import { DatabaseManager } from '../../core/db';

export class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectItem | undefined | null | void> = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private logic: ProjectsList;
    private selectedContext: string | null = null;
    private _disposable: vscode.Disposable;

    constructor(db: DatabaseManager) {
        this.logic = new ProjectsList(db);

        // Listen to selection in Business Tree (or active editor?)
        // Spec: "Связать выбор в ДЕЛА -> обновление ПРОЕКТЫ"
        // Also context from active editor? 
        // "Секция 'Проекты' — только проекты текущего продукта (не глобальный список)"
        // Let's listen to active editor for now as Context does. 
        // Ideally we want to listen to TreeView selection event, but TreeView is in another provider.
        // We can use a command or a shared state service.
        // Simple start: listen to Active Editor like ContextProvider.
        // AND listen to a command 'duet.selectContext' called by BusinessTree selection.
        
        this._disposable = vscode.window.onDidChangeActiveTextEditor(() => this.updateFromEditor());
        this.updateFromEditor();
    }

    dispose() {
        this._disposable.dispose();
    }

    private updateFromEditor() {
        if (vscode.window.activeTextEditor) {
            this.selectedContext = vscode.window.activeTextEditor.document.uri.fsPath;
            this.refresh();
        }
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }
    
    // API to manually set context (e.g. from BusinessTree click)
    setContext(path: string) {
        this.selectedContext = path;
        this.refresh();
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.id = element.id;  
        // item.command = { command: 'duet.openProject', ... }
        return item;
    }

    getChildren(element?: ProjectItem): vscode.ProviderResult<ProjectItem[]> {
        if (element) {
            return [];
        }
        return this.logic.getProjects(this.selectedContext);
    }
}
