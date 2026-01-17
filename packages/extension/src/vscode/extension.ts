import * as vscode from 'vscode';
import { OnboardingProvider } from './providers/OnboardingProvider';
import { selectDataFolder } from './commands/onboarding';

class StubProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }
    getChildren(): vscode.ProviderResult<vscode.TreeItem[]> { return Promise.resolve([]); }
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Duet extension is active');

    // Onboarding View
    const onboardingProvider = new OnboardingProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.onboarding', onboardingProvider)
    );

    // Register stubs for future views to prevent UI errors
    const stubProvider = new StubProvider();
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('duet.context', stubProvider),
        vscode.window.registerTreeDataProvider('duet.businesses', stubProvider),
        vscode.window.registerTreeDataProvider('duet.projects', stubProvider)
    );

    // Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('duet.selectDataFolder', selectDataFolder)
    );
}

export function deactivate() { }
