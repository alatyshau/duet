/**
 * ContextProvider — TreeDataProvider for the КОНТЕКСТ section.
 *
 * Source of truth: backend `/orientation`. The provider renders the chain of
 * contexts the current workspace folders resolve into, then top-level products
 * declared in that context, then components nested under each product. The
 * single artefact passed in is `OrientationResponse`; nothing is recomputed
 * from the local workspace folder list.
 *
 * Refresh pathways:
 *  - on `onDidChangeWorkspaceFolders` → call `refreshOrientation(paths)`
 *  - explicit `updateOrientation(response)` (e.g. from the `duet.refresh` command)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { ChainItem, ComponentInfo, OrientationResponse, OrientationWorkspace, ProductInfo } from '../../core/api-client';
import { resolveAtRef } from '../../core/pathUtils';

type DisplayNode = ChainDisplayNode | ProductDisplayNode | ComponentDisplayNode | InfoNode;

interface ChainDisplayNode {
    kind: 'chain';
    name: string;
    icon: string;
    description?: string;
    isLast: boolean;
    children: DisplayNode[];
    tooltipPath?: string;
}

interface ProductDisplayNode {
    kind: 'product';
    name: string;
    atRef: string;
    absolutePath: string | null;
    spec?: string;
    description?: string;
    components: ComponentDisplayNode[];
}

interface ComponentDisplayNode {
    kind: 'component';
    name: string;
    relativePath: string;
    absolutePath: string | null;
    productAtRef: string;
    spec?: string;
    description?: string;
}

interface InfoNode {
    kind: 'info';
    message: string;
    detail?: string;
}

export type ContextDisplayNode = DisplayNode;

export type RefreshOrientationFn = (workspacePaths: string[]) => Promise<OrientationResponse | null>;

function currentWorkspacePaths(): string[] {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
        return [];
    }
    return folders.map(f => f.uri.fsPath);
}

export class ContextProvider implements vscode.TreeDataProvider<DisplayNode> {
    private _onDidChangeTreeData = new vscode.EventEmitter<DisplayNode | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private roots: DisplayNode[] = [];
    private disposables: vscode.Disposable[] = [];

    constructor(
        initial: OrientationResponse | null,
        private readonly refreshOrientation: RefreshOrientationFn
    ) {
        this.rebuildFromOrientation(initial);

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                void this.refresh();
            })
        );
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Replace the orientation snapshot and fire a tree refresh.
     * Called by external refresh flows (e.g. `duet.refresh` command).
     */
    updateOrientation(response: OrientationResponse | null): void {
        this.rebuildFromOrientation(response);
        this._onDidChangeTreeData.fire();
    }

    /**
     * Re-fetch orientation for the current workspace folders and rebuild.
     */
    async refresh(): Promise<void> {
        try {
            const response = await this.refreshOrientation(currentWorkspacePaths());
            this.rebuildFromOrientation(response);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.roots = [{ kind: 'info', message: 'Ошибка обновления контекста', detail: msg }];
        }
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: DisplayNode): vscode.TreeItem {
        const hasChildren = this.getChildrenInternal(element).length > 0;
        const collapsibleState = hasChildren
            ? vscode.TreeItemCollapsibleState.Expanded
            : vscode.TreeItemCollapsibleState.None;

        const item = new vscode.TreeItem(this.formatLabel(element), collapsibleState);
        item.id = this.nodeId(element);
        item.tooltip = this.formatTooltip(element);
        item.description = this.formatDescription(element);
        item.contextValue = element.kind;
        return item;
    }

    getChildren(element?: DisplayNode): vscode.ProviderResult<DisplayNode[]> {
        if (!element) {
            return this.roots;
        }
        return this.getChildrenInternal(element);
    }

    getParent(element: DisplayNode): vscode.ProviderResult<DisplayNode> {
        return this.findParent(this.roots, element);
    }

    private getChildrenInternal(element: DisplayNode): DisplayNode[] {
        switch (element.kind) {
            case 'chain':
                return element.children;
            case 'product':
                return element.components;
            case 'component':
            case 'info':
                return [];
        }
    }

    private findParent(nodes: DisplayNode[], target: DisplayNode): DisplayNode | null {
        for (const node of nodes) {
            const children = this.getChildrenInternal(node);
            if (children.includes(target)) {
                return node;
            }
            const deeper = this.findParent(children, target);
            if (deeper) {
                return deeper;
            }
        }
        return null;
    }

    private rebuildFromOrientation(response: OrientationResponse | null): void {
        if (!response) {
            this.roots = [{ kind: 'info', message: 'Контекст не загружен' }];
            return;
        }

        const workspace = response.workspace;
        if (workspace.kind === 'unknown' || !response.context || response.context.chain.length === 0) {
            this.roots = [{
                kind: 'info',
                message: 'Папка вне иерархии контекстов',
                detail: workspace.context_folder ?? undefined
            }];
            return;
        }

        const productNodes = (response.products ?? []).map(p => this.buildProductNode(p, workspace));
        const chainRoot = this.buildChainNodes(response.context.chain, productNodes);
        this.roots = chainRoot ? [chainRoot] : [];
    }

    private buildChainNodes(chain: ChainItem[], products: ProductDisplayNode[]): ChainDisplayNode | null {
        if (chain.length === 0) {
            return null;
        }

        let trailing: ChainDisplayNode | null = null;
        for (let i = chain.length - 1; i >= 0; i--) {
            const item = chain[i];
            const isLast = i === chain.length - 1;
            const children: DisplayNode[] = isLast
                ? products
                : (trailing ? [trailing] : []);
            const node: ChainDisplayNode = {
                kind: 'chain',
                name: item.name,
                icon: item.icon,
                description: item.description,
                isLast,
                children
            };
            trailing = node;
        }
        return trailing;
    }

    private buildProductNode(product: ProductInfo, workspace: OrientationWorkspace): ProductDisplayNode {
        const absolutePath = resolveAtRef(
            product.path,
            workspace.git_folders,
            workspace.context_name,
            workspace.context_folder
        );
        const components = (product.components ?? []).map(c => this.buildComponentNode(c, product.path, absolutePath));
        return {
            kind: 'product',
            name: product.name,
            atRef: product.path,
            absolutePath,
            spec: product.spec,
            description: product.description,
            components
        };
    }

    private buildComponentNode(
        component: ComponentInfo,
        productAtRef: string,
        productAbsolutePath: string | null
    ): ComponentDisplayNode {
        const absolutePath = productAbsolutePath
            ? path.join(productAbsolutePath, component.path)
            : null;
        return {
            kind: 'component',
            name: component.name,
            relativePath: component.path,
            absolutePath,
            productAtRef,
            spec: component.spec,
            description: component.description
        };
    }

    private formatLabel(element: DisplayNode): string {
        if (element.kind === 'info') {
            return `ℹ️ ${element.message}`;
        }
        if (element.kind === 'chain') {
            return element.icon ? `${element.icon} ${element.name}` : element.name;
        }
        return element.name;
    }

    private formatDescription(element: DisplayNode): string | undefined {
        if (element.kind === 'component') {
            return 'comp';
        }
        return undefined;
    }

    private formatTooltip(element: DisplayNode): string | undefined {
        if (element.kind === 'info') {
            return element.detail;
        }
        if (element.kind === 'chain') {
            return element.description ?? element.name;
        }
        if (element.kind === 'product') {
            const lines: string[] = [element.atRef];
            if (element.spec) {
                lines.push(`spec: ${element.spec}`);
            }
            if (element.description) {
                lines.push(element.description);
            }
            if (element.absolutePath) {
                lines.push(element.absolutePath);
            }
            return lines.join('\n');
        }
        if (element.kind === 'component') {
            const lines: string[] = [`${element.productAtRef}/${element.relativePath}`];
            if (element.spec) {
                lines.push(`spec: ${element.spec}`);
            }
            if (element.description) {
                lines.push(element.description);
            }
            if (element.absolutePath) {
                lines.push(element.absolutePath);
            }
            return lines.join('\n');
        }
        return undefined;
    }

    private nodeId(element: DisplayNode): string {
        switch (element.kind) {
            case 'chain':
                return `chain:${element.name}`;
            case 'product':
                return `product:${element.atRef}`;
            case 'component':
                return `component:${element.productAtRef}/${element.relativePath}`;
            case 'info':
                return `info:${element.message}`;
        }
    }
}

/**
 * Command handler for opening DuetData folder in system file manager.
 */
export async function openDataFolderCommand(reposPath: string): Promise<void> {
    const dataFolder = path.dirname(reposPath);
    await vscode.env.openExternal(vscode.Uri.file(dataFolder));
}
