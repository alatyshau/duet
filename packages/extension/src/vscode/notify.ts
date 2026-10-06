import * as vscode from 'vscode';

/** A refusal or a notice is one line. */
export function say(line: string): void {
    void vscode.window.showWarningMessage(line);
}

/** One line about something that was done and that the user should know of — a file moved to another folder. */
export function inform(line: string): void {
    void vscode.window.showInformationMessage(line);
}

export function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
