import * as vscode from 'vscode';
import { BinProvider } from '../providers/BinProvider';
import { WorkView } from '../work/WorkView';

export class BusinessViews {
    constructor(private readonly bin: BinProvider, private readonly work: WorkView | null) {}

    async select(node: unknown): Promise<void> {
        const row = node as { type?: unknown; entityId?: unknown } | undefined;
        if (row?.type !== 'context' || typeof row.entityId !== 'number') { return; }
        if (this.bin.showBusiness(row.entityId)) { await this.work?.clearForBusiness(); }
    }

    async home(): Promise<void> {
        // Reset synchronously before either disk reading; commands do not call one another.
        await Promise.all([this.bin.goHome(), this.work?.goHome()]);
    }

    register(context: vscode.ExtensionContext): void {
        if (this.work) { this.work.refreshHome = () => this.home(); }
        context.subscriptions.push(
            vscode.commands.registerCommand('duet.contexts.select', (node: unknown) => this.select(node)),
            vscode.commands.registerCommand('duet.bin.refresh', () => this.home()),
            { dispose: () => { if (this.work) { this.work.refreshHome = null; } } }
        );
    }
}
