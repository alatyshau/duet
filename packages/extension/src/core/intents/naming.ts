import { parseTicketFolderName } from '../pathUtils';

/**
 * An intent is a ticket of a business. Its name is the ticket folder name
 * without the number, spaced for reading. One function serves the row in the
 * views, the tab label and the notepad heading, so the three never disagree.
 */
export interface IntentIdentity {
    /** Ticket number: `DUE017`. */
    number: string;
    /** Ticket folder name: `DUE017_IntentSwitcher`. */
    folder: string;
    /** Readable name: `Intent Switcher`. Empty when the folder is the bare number. */
    name: string;
}

/**
 * `IntentSwitcher` → `Intent Switcher`, `UIResearch` → `UI Research`,
 * `DuetWork2` → `Duet Work2`, `DuetWork_Full` → `Duet Work Full`.
 * Underscores become spaces; a space goes where PascalCase starts a new word.
 * Letters are matched by Unicode case, so Cyrillic names split the same way.
 */
export function spaceIntentName(raw: string): string {
    return raw
        .replace(/_/g, ' ')
        .replace(/(?<=[\p{Ll}\p{Nd}])(?=\p{Lu})/gu, ' ')
        .replace(/(?<=\p{Lu})(?=\p{Lu}\p{Ll})/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Identity of the intent a ticket folder stands for, or null when the name is not a ticket folder. */
export function intentIdentity(folder: string): IntentIdentity | null {
    const parsed = parseTicketFolderName(folder);
    if (!parsed) {
        return null;
    }
    return { number: parsed.number, folder, name: spaceIntentName(parsed.rest) };
}

/** Stands in a business row where an intent row shows its ticket number. */
export const BUSINESS_TAG = 'biz';

export interface RowText {
    /** Icon and name: `🧰 Intent Switcher`. */
    label: string;
    /** The tag — a ticket number or `biz` — which the tree draws smaller, after the name. */
    description: string | undefined;
    /** Where the name stands in `label`: start inclusive, end exclusive. */
    name: [number, number];
}

/**
 * Text of a row in both views. The left edge belongs to the icon, the name
 * follows it, and the tag goes into the description: a number of uneven width
 * in front would push the names out of line and leave the icon no place. A row
 * without an icon has none — no placeholder. A row without a name shows its tag
 * as the name.
 */
export function rowText(icon: string, name: string, tag: string): RowText {
    const shown = name || tag;
    const label = icon ? `${icon} ${shown}` : shown;
    return {
        label,
        description: name ? tag : undefined,
        name: [label.length - shown.length, label.length]
    };
}

/** Title of the bin view in a window without a business. */
export const BIN_TITLE = 'Корзина';

/** Title of the bin view: `Корзина DuetLab` — whose tickets it shows. */
export function binTitle(businessName: string | null | undefined): string {
    return businessName ? `${BIN_TITLE} ${businessName}` : BIN_TITLE;
}

/**
 * Emoji of an intent, the same wherever the intent is shown — its row in
 * «Активная Работа» and the tab of its notepad. Three steps: the ticket's own;
 * else the one of its nearest parent ticket that has one; else the one of its
 * business. The first two come together as `ticketIcon`
 * (`TicketReader.inheritedIcon`). Empty when none of the three has one.
 */
export function intentIcon(ticketIcon: string, businessIcon: string): string {
    return ticketIcon || businessIcon;
}

/**
 * Tab label of the notepad: `🧰 Intent Switcher` — the intent's emoji
 * (`intentIcon`) and its name; without the emoji when the intent has none.
 */
export function intentTabLabel(icon: string, intent: Pick<IntentIdentity, 'number' | 'name'>): string {
    const name = intent.name || intent.number;
    return icon ? `${icon} ${name}` : name;
}

/** First line of the notepad: `# DUE017 · Intent Switcher · Notepad`. */
export function notepadHeading(intent: Pick<IntentIdentity, 'number' | 'name'>): string {
    return intent.name
        ? `# ${intent.number} · ${intent.name} · Notepad`
        : `# ${intent.number} · Notepad`;
}
