import * as vscode from 'vscode';
import { ProjectsList, ProjectItem } from '../../core/tree/projectsList';
import { DatabaseManager } from '../../core/db';

/**
 * TreeDataProvider for ПРОЕКТЫ section.
 * Context is set via setContext() from ДЕЛА selection (see extension.ts).
 */
export class ProjectsProvider implements vscode.TreeDataProvider<ProjectItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ProjectItem | undefined | null | void> = new vscode.EventEmitter<ProjectItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ProjectItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private logic: ProjectsList;
    private selectedContext: string | null = null;

    constructor(db: DatabaseManager) {
        this.logic = new ProjectsList(db);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setContext(drivePath: string) {
        this.selectedContext = drivePath;
        this.refresh();
    }

    getTreeItem(element: ProjectItem): vscode.TreeItem {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        item.id = element.id;
        return item;
    }

    getChildren(element?: ProjectItem): vscode.ProviderResult<ProjectItem[]> {
        if (element) {
            return [];
        }
        return this.logic.getProjects(this.selectedContext);
    }
}
