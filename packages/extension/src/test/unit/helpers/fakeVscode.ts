/* eslint-disable @typescript-eslint/naming-convention */
/**
 * A stand-in for the `vscode` module, enough for the «Рабочая папка» view: a
 * tree view that remembers what it was told and lets a test play the person —
 * expand a folder, select rows, type a name, answer a question.
 *
 * Used as `vi.mock('vscode', async () => (await import('./helpers/fakeVscode')).fakeVscode)`;
 * the test reaches the state through `fake`.
 */
type Listener<T> = (value: T) => unknown;

class Emitter<T> {
    private listeners: Listener<T>[] = [];
    event = (listener: Listener<T>) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire = (value?: T) => { [...this.listeners].forEach(l => l(value as T)); };
    dispose = () => { this.listeners = []; };
}

export interface FakeUri { scheme: string; fsPath: string; path: string; toString(): string }
const uri = (fsPath: string): FakeUri => ({ scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` });

class TabInputText { constructor(public uri: FakeUri) {} }
class TabInputCustom { constructor(public uri: FakeUri) {} }
class TabInputNotebook { constructor(public uri: FakeUri) {} }
class TabInputTextDiff { constructor(public original: FakeUri, public modified: FakeUri) {} }
class TabInputNotebookDiff { constructor(public original: FakeUri, public modified: FakeUri) {} }

export class FakeTreeView {
    title = '';
    description: string | undefined;
    message: string | undefined;
    visible = true;
    selection: string[] = [];
    readonly revealed: Array<{ element: string; options: Record<string, unknown> }> = [];
    readonly expand = new Emitter<{ element: string }>();
    readonly collapse = new Emitter<{ element: string }>();
    readonly select = new Emitter<{ selection: string[] }>();
    readonly visibility = new Emitter<{ visible: boolean }>();
    onDidExpandElement = this.expand.event;
    onDidCollapseElement = this.collapse.event;
    onDidChangeSelection = this.select.event;
    onDidChangeVisibility = this.visibility.event;
    constructor(readonly id: string, readonly options: Record<string, unknown>) {}
    reveal = async (element: string, options: Record<string, unknown> = {}) => {
        this.revealed.push({ element, options });
        if (options.select) {
            this.selection = [element];
        }
    };
    dispose = () => undefined;
}

export class FakeInputBox {
    title = '';
    value = '';
    valueSelection: [number, number] | undefined;
    ignoreFocusOut = false;
    validationMessage: { message: string; severity: number } | undefined;
    shown = false;
    disposed = false;
    private readonly change = new Emitter<string>();
    private readonly accept = new Emitter<void>();
    private readonly hide = new Emitter<void>();
    onDidChangeValue = this.change.event;
    onDidAccept = this.accept.event;
    onDidHide = this.hide.event;
    show = () => { this.shown = true; };
    dispose = () => { this.disposed = true; };
    /** Type a name. */
    type(value: string): void { this.value = value; this.change.fire(value); }
    /** Press Enter. */
    enter(): void { this.accept.fire(); }
    /** Press Escape. */
    escape(): void { this.hide.fire(); }
}

export interface FakeWatcher { base: string; pattern: string; create: Emitter<FakeUri>; change: Emitter<FakeUri>; remove: Emitter<FakeUri>; disposed: boolean }

function createState() {
    return {
        warnings: [] as string[],
        infos: [] as string[],
        /** What a modal question is answered with. */
        answer: 'Удалить' as string | undefined,
        contexts: {} as Record<string, unknown>,
        executed: [] as Array<{ command: string; args: unknown[] }>,
        trees: new Map<string, FakeTreeView>(),
        inputBoxes: [] as FakeInputBox[],
        watchers: [] as FakeWatcher[],
        opened: [] as Array<{ path: string; options: unknown }>,
        clipboard: '',
        config: {} as Record<string, unknown>,
        /** Folder of the window the ticket lies in; null — no workspace folder holds it. */
        workspaceFolder: null as string | null,
        activeFile: null as string | null,
        /** Files shown in visible editors: the active tab of each group. */
        visibleFiles: [] as string[],
        /** Comparisons shown in visible editors, a group each. */
        visibleDiffs: [] as Array<{ original: string; modified: string }>,
        dirtyFiles: [] as string[],
        workspaceState: new Map<string, unknown>(),
        editors: new Emitter<void>(),
        tabs: new Emitter<void>(),
        configuration: new Emitter<{ affectsConfiguration: (section: string) => boolean }>()
    };
}

export let fake = createState();

/** Start every test from a clean editor. */
export function resetFake(): void {
    fake = createState();
}

const tabGroups = {
    get all() {
        const group = (input: unknown, isDirty: boolean) => {
            const tab = { input, isDirty };
            return { activeTab: tab, tabs: [tab] };
        };
        return [
            ...fake.visibleFiles.map(file => group(new TabInputText(uri(file)), fake.dirtyFiles.includes(file))),
            ...fake.visibleDiffs.map(diff => group(new TabInputTextDiff(uri(diff.original), uri(diff.modified)), false))
        ];
    },
    get activeTabGroup() { return tabGroups.all[0]; },
    onDidChangeTabs: (listener: Listener<void>) => fake.tabs.event(listener),
    onDidChangeTabGroups: () => ({ dispose: () => undefined })
};

export const fakeVscode = {
    EventEmitter: Emitter,
    Uri: { file: uri, parse: (text: string) => uri(decodeURIComponent(text.replace(/^file:\/\//, ''))) },
    TreeItem: class {
        id?: string;
        label?: unknown;
        resourceUri?: FakeUri;
        contextValue?: string;
        command?: unknown;
        constructor(labelOrUri: unknown, public collapsibleState: number) {
            if (labelOrUri && typeof labelOrUri === 'object') {
                this.resourceUri = labelOrUri as FakeUri;
            } else {
                this.label = labelOrUri;
            }
        }
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    InputBoxValidationSeverity: { Info: 1, Warning: 2, Error: 3 },
    FileType: { File: 1, Directory: 2 },
    RelativePattern: class { constructor(public base: FakeUri, public pattern: string) {} },
    DataTransferItem: class {
        constructor(public value: unknown) {}
        asFile = () => undefined;
        asString = async () => String(this.value);
    },
    TabInputText, TabInputCustom, TabInputNotebook, TabInputTextDiff, TabInputNotebookDiff,
    window: {
        createTreeView: (id: string, options: Record<string, unknown>) => {
            const view = new FakeTreeView(id, options);
            fake.trees.set(id, view);
            return view;
        },
        createInputBox: () => {
            const box = new FakeInputBox();
            fake.inputBoxes.push(box);
            return box;
        },
        showWarningMessage: async (line: string, options?: { modal?: boolean }) => {
            fake.warnings.push(line);
            return options?.modal ? fake.answer : undefined;
        },
        showInformationMessage: async (line: string) => { fake.infos.push(line); },
        withProgress: (_options: unknown, task: () => Promise<unknown>) => task(),
        showTextDocument: async (target: FakeUri, options: unknown) => {
            fake.opened.push({ path: target.fsPath, options });
            fake.activeFile = target.fsPath;
            fake.visibleFiles = [target.fsPath];
        },
        get activeTextEditor() {
            return fake.activeFile ? { document: { uri: uri(fake.activeFile) } } : undefined;
        },
        onDidChangeActiveTextEditor: (listener: Listener<void>) => fake.editors.event(listener),
        tabGroups
    },
    workspace: {
        get textDocuments() { return fake.dirtyFiles.map(file => ({ isDirty: true, uri: uri(file) })); },
        createFileSystemWatcher: (pattern: { base: FakeUri; pattern: string }) => {
            const watcher: FakeWatcher = {
                base: pattern.base.fsPath, pattern: pattern.pattern,
                create: new Emitter<FakeUri>(), change: new Emitter<FakeUri>(), remove: new Emitter<FakeUri>(), disposed: false
            };
            fake.watchers.push(watcher);
            return {
                onDidCreate: watcher.create.event, onDidChange: watcher.change.event, onDidDelete: watcher.remove.event,
                dispose: () => { watcher.disposed = true; }
            };
        },
        getConfiguration: (section: string) => ({ get: (key: string) => fake.config[`${section}.${key}`] }),
        getWorkspaceFolder: () => (fake.workspaceFolder ? { uri: uri(fake.workspaceFolder) } : undefined),
        onDidChangeConfiguration: (listener: Listener<{ affectsConfiguration: (section: string) => boolean }>) => fake.configuration.event(listener),
        fs: { stat: async () => ({ type: 1 }) }
    },
    commands: {
        executeCommand: async (command: string, ...args: unknown[]) => {
            if (command === 'setContext') {
                fake.contexts[args[0] as string] = args[1];
            } else {
                fake.executed.push({ command, args });
            }
        },
        registerCommand: () => ({ dispose: () => undefined })
    },
    env: { uriScheme: 'vscode', clipboard: { writeText: async (text: string) => { fake.clipboard = text; } } }
};
