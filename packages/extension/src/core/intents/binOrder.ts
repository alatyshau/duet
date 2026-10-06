import * as path from 'path';
import { FileSystem, nodeFs } from '../fs';
import { parseOrder, serializeOrder } from './order';

/**
 * The remembered order of a business's tickets in the bin:
 * `<business>/.vscode/duet-intents.json`, one flat list of ticket numbers. It
 * lies in the business folder, so it is the same for every program and machine.
 *
 * The file is on a cloud drive: it is written in place by a single write, never
 * through a temporary file and a rename, which a sync client may turn into a
 * conflict copy. Only the exact file name is read, so such copies are harmless.
 */
export function binOrderPath(businessPath: string): string {
    return path.join(businessPath, '.vscode', 'duet-intents.json');
}

/**
 * Read the order. An absent file is an empty order; a file that cannot be read
 * gives null, and the caller keeps the last order it read well.
 */
export async function readBinOrder(businessPath: string, fileSystem?: FileSystem): Promise<string[] | null> {
    const fs = fileSystem ?? nodeFs;
    let text: string;
    try {
        text = await fs.readFile(binOrderPath(businessPath), 'utf8');
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'ENOENT' ? [] : null;
    }
    return parseOrder(text);
}

export async function writeBinOrder(businessPath: string, order: string[], fileSystem?: FileSystem): Promise<void> {
    const fs = fileSystem ?? nodeFs;
    const file = binOrderPath(businessPath);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, serializeOrder(order), 'utf8');
}

/**
 * Drop from the order the numbers found in the archive. A number that is not on
 * the shelves and not in the archive stays: its folder may simply not be synced yet.
 *
 * @param present - numbers that lie in work or backlog now
 * @param inArchive - looks one number up in the archive
 */
export async function pruneArchived(
    order: string[],
    present: ReadonlySet<string>,
    inArchive: (ticketNumber: string) => Promise<boolean>
): Promise<string[]> {
    const result: string[] = [];
    for (const ticketNumber of order) {
        if (present.has(ticketNumber) || !(await inArchive(ticketNumber))) {
            result.push(ticketNumber);
        }
    }
    return result;
}
