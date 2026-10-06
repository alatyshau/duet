/**
 * What of the view is available now — the context keys the menus stand on.
 * One pure function, so every «unavailable» of the menus has a test.
 */
export type PlusDepth = '1' | '2' | 'all';

export interface ViewFacts {
    /** A ticket is chosen. */
    hasTicket: boolean;
    /** Its content was read and confirmed by the last reading. */
    ready: boolean;
    /** A file operation is under way. */
    busy: boolean;
    /** The view file of the ticket was read: the rule and its level may be changed. */
    hasViewState: boolean;
    showHidden: boolean;
    followEditor: boolean;
    plusDepth: PlusDepth;
    oneFolder: boolean;
    oneFolderLevel: number;
    /** A folder is among the shown rows. */
    hasFolders: boolean;
    /** A folder is seen expanded. */
    hasExpanded: boolean;
    /** The set of expanded folders is not empty, hidden and nested ones counted. */
    anyExpanded: boolean;
    /** The pins of the root were changed by hand: there is something to reset. */
    rootManual: boolean;
    /** The order may not be written. */
    orderLocked: boolean;
}

export interface ContextKeys {
    showHidden: boolean;
    followEditor: boolean;
    oneFolder: boolean;
    oneFolderLevel: number;
    depth: PlusDepth;
    ready: boolean;
    busy: boolean;
    hasViewState: boolean;
    hasFolders: boolean;
    hasExpanded: boolean;
    anyExpanded: boolean;
    /** A mass expansion to this depth would reach the level the rule acts from. */
    block1: boolean;
    block2: boolean;
    blockAll: boolean;
    /** The depth chosen for the plus button is blocked. */
    blockDepth: boolean;
    rootManual: boolean;
    orderLocked: boolean;
}

export function availability(facts: ViewFacts): ContextKeys {
    const ruleOn = facts.hasTicket && facts.oneFolder;
    const block1 = ruleOn && facts.oneFolderLevel <= 1;
    const block2 = ruleOn && facts.oneFolderLevel <= 2;
    const blockAll = ruleOn;
    return {
        showHidden: facts.showHidden,
        followEditor: facts.followEditor,
        oneFolder: ruleOn,
        oneFolderLevel: facts.oneFolderLevel,
        depth: facts.plusDepth,
        ready: facts.hasTicket && facts.ready,
        busy: facts.busy,
        hasViewState: facts.hasTicket && facts.hasViewState,
        hasFolders: facts.hasTicket && facts.hasFolders,
        hasExpanded: facts.hasTicket && facts.hasExpanded,
        anyExpanded: facts.hasTicket && facts.anyExpanded,
        block1,
        block2,
        blockAll,
        blockDepth: facts.plusDepth === '1' ? block1 : facts.plusDepth === '2' ? block2 : blockAll,
        rootManual: facts.hasTicket && facts.rootManual,
        orderLocked: facts.orderLocked
    };
}
