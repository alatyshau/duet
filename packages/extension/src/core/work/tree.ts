import { PlusDepth, ViewFacts } from '../folderView/availability';
import {
    changedFolders, collapseDeepestLevel, expandAll, expandToLevel, oneAtATime, pickBranch, revealPath, visiblyExpanded
} from '../folderView/expand';
import { FilterInput, computeHidden } from '../folderView/filter';
import { compileExclude } from '../folderView/glob';
import { ROOT, isUnder, parentOf, rebase } from '../folderView/names';
import { OrderFile, isPinned } from '../folderView/order';
import { Row, RowContext, admittedFolders, childRows, screenRows } from '../folderView/rows';
import { Snapshot, entryAt } from '../folderView/snapshot';

/** The files the root of a ticket starts with as pinned — and no other folder; a person may unpin them and pin others. */
export const PINNED_FILES: readonly string[] = ['INDEX.md', 'AGENDA.md', 'notepad.md'];

export type TreeAction = 'collapseAll' | 'expandAll' | 'expandLevel1' | 'expandLevel2' | 'collapseLevel';

/** What an expansion reported by the tree led to. */
export type ExpandOutcome =
    /** The tree repeats what is already known — nothing to do. */
    | 'echo'
    /** The folder is expanded; only its own row needs a new look. */
    | 'plain'
    /** Other folders were collapsed: the whole tree is drawn anew. */
    | 'enforced'
    /** A drag is under way: nothing is drawn until it ends. */
    | 'deferred';

export const NO_FILTER: FilterInput = {
    showHidden: false, prefix: '', exclude: compileExclude(undefined), ignored: null, visibleEditors: []
};

/**
 * The tree of one ticket as the view holds it: the folder read into memory,
 * the order, the filter and the set of expanded folders. No disk and no
 * editor here — only what follows from what.
 *
 * VS Code keeps the expansion of a row by its id and gives an extension no
 * way to collapse one row, so the view declares the state of every folder
 * from its own set and, to change a folder against the tree's memory, gives
 * the folder a new id: its *epoch* goes up, and the tree draws it afresh in
 * the declared state.
 */
export class WorkTree {
    snapshot: Snapshot | null = null;
    /** The pins shown: the last ones read well; null — every folder has the pins it starts with. */
    order: OrderFile | null = null;
    expanded = new Set<string>();
    oneFolder = false;
    oneFolderLevel = 2;
    /** True when this window changed what is expanded or the rule since the last write. */
    dirty = false;

    private filter: FilterInput = NO_FILTER;
    private hidden: ReadonlySet<string> = new Set();
    private readonly epochs = new Map<string, number>();
    private lastExpanded: string | null = null;
    private drag: { opened: boolean } | null = null;
    private gesture: string | null = null;

    /** Start over for another ticket. */
    reset(): void {
        this.snapshot = null;
        this.order = null;
        this.expanded = new Set();
        this.oneFolder = false;
        this.oneFolderLevel = 2;
        this.dirty = false;
        this.hidden = new Set();
        this.epochs.clear();
        this.lastExpanded = null;
        this.drag = null;
        this.gesture = null;
    }

    /**
     * Take a fresh reading of the folder. A folder that is no longer in the
     * full listing of its parent leaves the expanded set: one that comes back
     * under the same name comes back collapsed.
     */
    setSnapshot(snapshot: Snapshot): void {
        this.snapshot = snapshot;
        for (const folder of [...this.expanded]) {
            const parent = snapshot.dirs.get(parentOf(folder));
            if (parent?.state === 'ok' && entryAt(snapshot, folder)?.kind !== 'dir') {
                this.expanded.delete(folder);
                this.dirty = true;
            }
        }
        this.refilter();
    }

    setFilter(filter: FilterInput): void {
        this.filter = filter;
        this.refilter();
    }

    getFilter(): FilterInput {
        return this.filter;
    }

    private refilter(): void {
        this.hidden = this.snapshot ? computeHidden(this.snapshot, this.filter) : new Set();
    }

    isHidden(rel: string): boolean {
        return this.hidden.has(rel);
    }

    /**
     * Would a row of this name be hidden? Asked before a name is given: a
     * person must not create what they then cannot see. `replacing` is the path
     * the name stands in for — a file shown in an editor stays shown under its new name.
     */
    wouldBeHidden(folder: string, name: string, isDir: boolean, replacing?: string): boolean {
        const listing = this.snapshot?.dirs.get(folder);
        if (!this.snapshot || listing?.state !== 'ok' || this.filter.showHidden) {
            return false;
        }
        const rel = folder === ROOT ? name : `${folder}/${name}`;
        const dirs = new Map(this.snapshot.dirs);
        dirs.set(folder, {
            state: 'ok',
            entries: [...listing.entries.filter(entry => entry.name !== name), { name, kind: isDir ? 'dir' : 'file' }]
        });
        const visibleEditors = this.filter.visibleEditors.map(shown => (replacing ? rebase(shown, replacing, rel) : shown));
        return computeHidden({ dirs }, { ...this.filter, visibleEditors }).has(rel);
    }

    private context(): RowContext | null {
        return this.snapshot
            ? { snapshot: this.snapshot, hidden: this.hidden, order: this.order, pinned: PINNED_FILES }
            : null;
    }

    children(folder: string): Row[] {
        const context = this.context();
        return context ? childRows(context, folder) : [];
    }

    /** The rows on the screen, top to bottom. */
    rows(): Row[] {
        const context = this.context();
        return context ? screenRows(context, this.expanded) : [];
    }

    /** Folders a person could see, in screen order. */
    admitted(): string[] {
        const context = this.context();
        return context ? admittedFolders(context) : [];
    }

    epochOf(folder: string): number {
        return this.epochs.get(folder) ?? 0;
    }

    /** True when a person changed the pins of the folder: there is something to reset. */
    isManual(folder: string): boolean {
        return !!this.order?.folders[folder];
    }

    isPinned(folder: string, name: string, isDir: boolean): boolean {
        return isPinned(this.order, folder, PINNED_FILES, name, isDir);
    }

    /** Make the tree show `next`: the folders whose state changes get a new id. True when anything changed. */
    enforce(next: ReadonlySet<string>): boolean {
        const changed = changedFolders(this.expanded, next);
        if (changed.length === 0) {
            return false;
        }
        changed.forEach(folder => this.epochs.set(folder, this.epochOf(folder) + 1));
        this.expanded = new Set(next);
        this.dirty = true;
        return true;
    }

    /** The tree says a folder was expanded — by hand, by a key, under a dragged row. */
    didExpand(folder: string): ExpandOutcome {
        if (this.expanded.has(folder)) {
            return 'echo';
        }
        // The platform's recursive gesture sends an event per folder of the branch; with the
        // rule on only the folder that was pointed at opens, the ones below it are drawn collapsed
        if (this.oneFolder && !this.drag && this.gesture !== null && isUnder(folder, this.gesture)) {
            this.epochs.set(folder, this.epochOf(folder) + 1);
            return 'enforced';
        }
        this.expanded.add(folder);
        this.lastExpanded = folder;
        this.dirty = true;
        if (this.drag) {
            this.drag.opened = true;
            return 'deferred';
        }
        if (!this.oneFolder) {
            return 'plain';
        }
        this.gesture = folder;
        const next = oneAtATime(this.expanded, folder, this.oneFolderLevel);
        return this.enforce(next) ? 'enforced' : 'plain';
    }

    /** The events of one gesture have all come: the next expansion is a gesture of its own. */
    endGesture(): void {
        this.gesture = null;
    }

    /** The tree says a folder was collapsed. What is expanded below it is kept. */
    didCollapse(folder: string): boolean {
        if (!this.expanded.delete(folder)) {
            return false;
        }
        this.dirty = true;
        return true;
    }

    /** A drag of the view's own rows began: until it ends nothing is collapsed and nothing is drawn. */
    beginDrag(): void {
        this.drag = { opened: false };
    }

    isDragging(): boolean {
        return this.drag !== null;
    }

    /**
     * The drag ended. When folders opened under the pointer meanwhile, the
     * rule is applied now: after a drop the folder of the target stays
     * expanded, after a cancel — the folder of the source. True when the tree
     * must be drawn anew.
     */
    endDrag(folder: string): boolean {
        const drag = this.drag;
        this.drag = null;
        if (!drag?.opened) {
            return false;
        }
        if (this.oneFolder) {
            this.enforce(oneAtATime(this.expanded, folder, this.oneFolderLevel));
        }
        return true;
    }

    run(action: TreeAction): boolean {
        const admitted = this.admitted();
        switch (action) {
            case 'collapseAll': return this.enforce(new Set());
            case 'expandAll': return this.enforce(expandAll(this.expanded, admitted));
            case 'expandLevel1': return this.enforce(expandToLevel(this.expanded, admitted, 1));
            case 'expandLevel2': return this.enforce(expandToLevel(this.expanded, admitted, 2));
            case 'collapseLevel': return this.enforce(collapseDeepestLevel(this.expanded, admitted));
        }
    }

    /** The minus-plus button: collapse all while a folder is seen expanded, else expand to the chosen depth. */
    toggle(depth: PlusDepth): boolean {
        if (visiblyExpanded(this.expanded, this.admitted()).length > 0) {
            return this.run('collapseAll');
        }
        return this.run(depth === '1' ? 'expandLevel1' : depth === '2' ? 'expandLevel2' : 'expandAll');
    }

    /**
     * Switch the rule or change its level. Switching it on brings the view to
     * the rule at once: the branch of `revealFile` when given, else the branch
     * chosen by `pickBranch`. Nothing collapsed is opened by this alone.
     */
    setRule(on: boolean, level: number, focusFolder: string | null, revealFile: string | null): boolean {
        this.oneFolder = on;
        this.oneFolderLevel = level;
        this.dirty = true;
        if (!on) {
            return false;
        }
        if (revealFile) {
            return this.enforce(revealPath(this.expanded, revealFile, level));
        }
        const branch = pickBranch(this.expanded, this.admitted(), focusFolder, this.lastExpanded, level);
        return branch ? this.enforce(oneAtATime(this.expanded, branch, level)) : false;
    }

    /** Expand the way to a file, under the rule when it is on. */
    reveal(file: string): boolean {
        return this.enforce(revealPath(this.expanded, file, this.oneFolder ? this.oneFolderLevel : null));
    }

    /** A folder got another path through the view: what was expanded follows it. */
    folderMoved(from: string, to: string): void {
        const moved = new Set([...this.expanded].map(folder => rebase(folder, from, to)));
        this.expanded = moved;
        this.dirty = true;
        if (this.oneFolder && moved.has(to)) {
            this.enforce(oneAtATime(moved, to, this.oneFolderLevel));
        }
    }

    /** A folder was deleted through the view. */
    folderRemoved(folder: string): void {
        for (const known of [...this.expanded]) {
            if (known === folder || isUnder(known, folder)) {
                this.expanded.delete(known);
                this.dirty = true;
            }
        }
    }

    facts(): Pick<ViewFacts, 'hasFolders' | 'hasExpanded' | 'anyExpanded' | 'rootManual' | 'oneFolder' | 'oneFolderLevel'> {
        const admitted = this.admitted();
        return {
            hasFolders: admitted.length > 0,
            hasExpanded: visiblyExpanded(this.expanded, admitted).length > 0,
            anyExpanded: this.expanded.size > 0,
            rootManual: this.isManual(ROOT),
            oneFolder: this.oneFolder,
            oneFolderLevel: this.oneFolderLevel
        };
    }
}
