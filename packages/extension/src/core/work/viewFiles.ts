import { PlusDepth } from '../folderView/availability';

/**
 * The two small files the view keeps in DuetData.
 *
 * The ticket file holds what is expanded together with the «one folder at a
 * time» rule and its level, so a ticket comes back as a consistent whole. It
 * is per ticket and machine, shared by the programs. The window file holds
 * what belongs to the view of one window: the eye, following the editor, the
 * depth of the plus button.
 */
export const VIEW_VERSION = 1;

export interface TicketView {
    expanded: string[];
    oneFolder: boolean;
    oneFolderFromLevel: number;
}

export const DEFAULT_TICKET_VIEW: TicketView = { expanded: [], oneFolder: false, oneFolderFromLevel: 2 };

export interface TicketViewRead {
    view: TicketView;
    /** False for a file of a newer Duet: it is shown and never written. */
    writable: boolean;
}

/** Read the ticket file; null text — no file yet. Text that cannot be parsed gives the defaults. */
export function parseTicketView(text: string | null): TicketViewRead {
    if (text === null) {
        return { view: DEFAULT_TICKET_VIEW, writable: true };
    }
    let data: Record<string, unknown>;
    try {
        data = JSON.parse(text);
    } catch {
        return { view: DEFAULT_TICKET_VIEW, writable: true };
    }
    if (!data || typeof data !== 'object') {
        return { view: DEFAULT_TICKET_VIEW, writable: true };
    }
    const level = data.oneFolderFromLevel;
    return {
        view: {
            expanded: Array.isArray(data.expanded) ? data.expanded.filter((item): item is string => typeof item === 'string') : [],
            oneFolder: data.oneFolder === true,
            oneFolderFromLevel: level === 1 || level === 2 || level === 3 ? level : 2
        },
        writable: !(typeof data.version === 'number' && data.version > VIEW_VERSION)
    };
}

export function serializeTicketView(view: TicketView): string {
    return JSON.stringify({ version: VIEW_VERSION, ...view, expanded: [...view.expanded].sort() }, null, 2) + '\n';
}

export interface WindowView {
    showHidden: boolean;
    followEditor: boolean;
    plusDepth: PlusDepth;
}

/** Hidden files hidden, the editor not followed, the plus button opens one level. */
export const DEFAULT_WINDOW_VIEW: WindowView = { showHidden: false, followEditor: false, plusDepth: '1' };

export function parseWindowView(text: string | null | undefined): WindowView {
    if (!text) {
        return DEFAULT_WINDOW_VIEW;
    }
    try {
        const data = JSON.parse(text) as Record<string, unknown>;
        const depth = data.plusDepth;
        return {
            showHidden: data.showHidden === true,
            followEditor: data.followEditor === true,
            plusDepth: depth === '2' || depth === 'all' ? depth : '1'
        };
    } catch {
        return DEFAULT_WINDOW_VIEW;
    }
}

export function serializeWindowView(view: WindowView): string {
    return JSON.stringify({ version: VIEW_VERSION, ...view }, null, 2) + '\n';
}
