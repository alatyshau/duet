import * as path from 'path';
import { FileSystem } from '../fs';
import { spaceIntentName } from './naming';
import { TicketPlace, TicketReader } from './tickets';

/**
 * A new ticket of a business: the next project number, a folder in `work/`
 * named by it, and an `INDEX.md` with the frontmatter of a project. The user
 * gives only the name; the number is never asked for.
 */

/** Longest name after the number: the folder name also names the workspace file of the window. */
export const MAX_TICKET_NAME_LENGTH = 100;

/**
 * Typed text → the part of the folder name after the number, in strict
 * PascalCase: `ui research` → `UiResearch`, `UI research` → `UiResearch`,
 * `синхронизация корзины` → `СинхронизацияКорзины`, `duet work 2` → `DuetWork2`.
 *
 * Only letters and digits stay; everything else — spaces, slashes, dots,
 * underscores — ends a word, so the result is always one folder name; an
 * apostrophe is dropped without ending the word. A word also starts where
 * `spaceIntentName` sees one in a name typed together — `IntentSwitcher` →
 * `IntentSwitcher`, `UIResearch` → `UiResearch` — so the folder name and the
 * readable name made from it follow one rule of words. The price is the same
 * as in any PascalCase converter: a capital after a single small letter starts
 * a word too, `iPhone` → `IPhone`. Every word gets a capital first letter and
 * small letters after it. Empty when the text has no letter or digit.
 */
export function pascalCaseName(raw: string): string {
    return spaceIntentName(raw.normalize('NFC').replace(/['’]/g, ''))
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        // A combining mark typed on its own is not a word
        .filter(word => /[\p{L}\p{N}]/u.test(word))
        .map(word => {
            const [first, ...rest] = Array.from(word);
            return first.toUpperCase() + rest.join('').toLowerCase();
        })
        .join('');
}

/**
 * The next project number of a business: one above the highest three-digit
 * number among `taken`. Programs (`DUEX01`), processes (`DUEA01`) and numbers
 * of another code are not counted. Null when the code has no number left.
 */
export function nextProjectNumber(code: string, taken: readonly string[]): string | null {
    let highest = 0;
    for (const number of taken) {
        if (number.length === code.length + 3 && number.startsWith(code) && /^\d{3}$/.test(number.slice(code.length))) {
            highest = Math.max(highest, Number(number.slice(code.length)));
        }
    }
    return highest >= 999 ? null : `${code}${String(highest + 1).padStart(3, '0')}`;
}

/** `YYYY-MM-DD` of the local day: the day the user sees, not the UTC one. */
export function localDate(now: Date): string {
    const two = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/**
 * Text of the `INDEX.md` of a new ticket: the frontmatter of a project with
 * `business-area` and `parent` left empty — they are filled in when the ticket
 * goes to work — and a heading.
 */
export function newTicketIndexText(number: string, slug: string, opened: string): string {
    const name = spaceIntentName(slug);
    return [
        '---',
        'folder-type: work',
        'work-type: project',
        `opened: ${opened}`,
        'business-area:',
        'parent:',
        '---',
        '',
        name ? `# ${number} — ${name}` : `# ${number}`,
        ''
    ].join('\n');
}

/** A ticket `createTicket` made: where it lies, and its number. */
export interface NewTicket extends TicketPlace {
    number: string;
}

/**
 * Create the folder of a new ticket in `work/` with its `INDEX.md`.
 *
 * The number is the next one after every ticket of the business — in `work/`,
 * `backlog/` and `archive/`. Nothing holds it between the reading and the
 * `mkdir`: an agent or another window may take the same number under another
 * name in that moment, and two folders then carry it until one is renumbered
 * by hand. There is no shared counter on purpose. The folder is made without
 * `recursive`, so a folder of the very same name is never written into.
 *
 * @param slug - the name after the number, from `pascalCaseName`; empty for a bare number
 * @throws when the folders of the business cannot be read, the code has no
 *   number left, or the folder or its `INDEX.md` cannot be written
 */
export async function createTicket(
    fileSystem: FileSystem,
    reader: TicketReader,
    businessPath: string,
    code: string,
    slug: string,
    now: Date
): Promise<NewTicket> {
    const number = nextProjectNumber(code, await reader.allNumbers(businessPath));
    if (!number) {
        throw new Error(`у кода ${code} не осталось номеров`);
    }
    const workDir = path.join(businessPath, 'work');
    const folder = slug ? `${number}_${slug}` : number;
    const folderPath = path.join(workDir, folder);
    await fileSystem.mkdir(workDir, { recursive: true });
    try {
        await fileSystem.mkdir(folderPath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(`папка work/${folder} появилась только что — нажмите ещё раз, номер будет следующий`);
        }
        throw error;
    }
    try {
        await fileSystem.writeFile(path.join(folderPath, 'INDEX.md'), newTicketIndexText(number, slug, localDate(now)), 'utf8');
    } catch (error) {
        // The folder stays and holds the number: say so, or the next click makes a second one beside it
        throw new Error(`папка work/${folder} создана, но INDEX.md в ней не записан: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { number, shelf: 'work', folder, path: folderPath };
}
