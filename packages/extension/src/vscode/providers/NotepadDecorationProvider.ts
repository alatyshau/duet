import * as vscode from 'vscode';
import { intentColorId } from '../../core/intents/colors';
import { normalizePath } from '../../core/pathUtils';
import { IntentsRuntime } from '../intents/IntentsRuntime';

/**
 * Colours the name of this window's notepad with the colour of the window — on
 * its tab, the one tab that stands for the intent, and wherever else the
 * editor lists the file. Only the notepad of the ticket the window is opened
 * on, and only in an intent window: a notepad of another ticket opened here
 * keeps the colour of the theme.
 *
 * The colour is the one in force in the window now, from the same declared
 * colours the rows of the views use (`duet.intent.color1`…): in a light theme
 * the dark, saturated window colour, in a dark theme its lighter shade. The
 * editor offers a file only the colour of its name, never a background.
 */
export class NotepadDecorationProvider implements vscode.FileDecorationProvider {
    private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChangeFileDecorations = this.emitter.event;
    private readonly subscription: vscode.Disposable;

    private notepad: { uri: vscode.Uri; path: string } | null = null;
    private colorId: string | null;

    constructor(private readonly runtime: IntentsRuntime) {
        this.colorId = this.colorNow();
        // The window changed its colour: the tab follows
        this.subscription = runtime.onDidChange(() => this.refresh());
    }

    dispose(): void {
        this.subscription.dispose();
        this.emitter.dispose();
    }

    /** The notepad of this window is at this path; told once it exists. */
    setNotepad(file: string): void {
        this.notepad = { uri: vscode.Uri.file(file), path: normalizePath(file) };
        this.colorId = this.colorNow();
        this.emitter.fire(this.notepad.uri);
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (!this.notepad || !this.colorId || uri.scheme !== 'file' || normalizePath(uri.fsPath) !== this.notepad.path) {
            return undefined;
        }
        // Not propagated: the ticket folder keeps its own colour
        return { color: new vscode.ThemeColor(this.colorId), propagate: false };
    }

    private refresh(): void {
        const next = this.colorNow();
        if (next === this.colorId) {
            return;
        }
        this.colorId = next;
        if (this.notepad) {
            this.emitter.fire(this.notepad.uri);
        }
    }

    private colorNow(): string | null {
        const own = this.runtime.own;
        return own?.subject === 'intent' ? intentColorId(this.runtime.colorOf(own.key)) : null;
    }
}
