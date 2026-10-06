import * as path from 'path';
import { normalizePath, parseTicketFolderName } from '../pathUtils';

/**
 * An intent window is a window opened by a workspace file Duet built for a
 * ticket: `DuetData/workspaces/<business>/<ticket folder>.code-workspace`. The
 * ticket is known by its number; where its folder lies now — work, backlog or
 * archive — is not part of the definition.
 */
export interface IntentWindow {
    /** Ticket number: `DUE017`. */
    ticket: string;
    /** Ticket folder name the file was built for: `DUE017_IntentSwitcher`. */
    ticketFolder: string;
    /** Name of the business as the folder under `workspaces/` spells it. */
    businessDir: string;
}

const WORKSPACE_EXT = '.code-workspace';

/** The intent a window belongs to, by the path of its workspace file; null for any other window. */
export function intentWindowOf(workspaceFile: string | undefined, workspacesDir: string): IntentWindow | null {
    if (!workspaceFile || !workspaceFile.endsWith(WORKSPACE_EXT)) {
        return null;
    }
    const businessDir = path.dirname(workspaceFile);
    if (normalizePath(path.dirname(businessDir)) !== normalizePath(workspacesDir)) {
        return null;
    }
    const ticketFolder = path.basename(workspaceFile).slice(0, -WORKSPACE_EXT.length);
    const parsed = parseTicketFolderName(ticketFolder);
    if (!parsed) {
        return null;
    }
    return { ticket: parsed.number, ticketFolder, businessDir: path.basename(businessDir) };
}

/**
 * A business window opened by a workspace file is one whose file lies right in
 * `DuetData/workspaces/` — where Duet writes the files of businesses with repos:
 * `workspaces/DuetLab.code-workspace`. Returns the name the file spells.
 */
export function businessWindowOf(workspaceFile: string | undefined, workspacesDir: string): string | null {
    if (!workspaceFile || !workspaceFile.endsWith(WORKSPACE_EXT)) {
        return null;
    }
    if (normalizePath(path.dirname(workspaceFile)) !== normalizePath(workspacesDir)) {
        return null;
    }
    return path.basename(workspaceFile).slice(0, -WORKSPACE_EXT.length) || null;
}

/**
 * Key of a business window among the markers: `@DuetLab`. A ticket number never
 * starts with `@`, so the two cannot meet. Characters a file name cannot hold
 * are replaced, because the key is part of the marker's file name.
 */
export function businessKey(name: string): string {
    // eslint-disable-next-line no-control-regex
    return `@${name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')}`;
}

/** Folder name under `intents/` for a program, from `vscode.env.uriScheme`: `vscode`, `vscodium`, `cursor`. */
export function programFolderName(uriScheme: string): string {
    const name = uriScheme.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^\.+/, '');
    return name || 'unknown';
}
