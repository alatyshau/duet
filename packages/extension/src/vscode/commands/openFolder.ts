import * as vscode from 'vscode';
import { TreeNode } from '../../core/tree/businessTree';

export async function openInCurrentWindow(node: TreeNode) {
    if (!node || !node.id) {
        vscode.window.showErrorMessage('Invalid node: missing path');
        return;
    }
    const uri = vscode.Uri.file(node.id);
    // forceNewWindow = false
    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
}

export async function openInNewWindow(node: TreeNode) {
    if (!node || !node.id) {
        vscode.window.showErrorMessage('Invalid node: missing path');
        return;
    }
    const uri = vscode.Uri.file(node.id);
    // forceNewWindow = true
    await vscode.commands.executeCommand('vscode.openFolder', uri, true);
}
