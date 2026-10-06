import * as os from 'os';
import * as path from 'path';
import { FileSystem, nodeFs } from '../fs';
import { parseOrder, serializeOrder } from './order';

/**
 * Window markers: how the windows of one program learn which intents are open.
 *
 * A window Duet opened — on an intent or on a business — writes a marker about
 * itself at start and removes it when it closes. The file is per process, not
 * per ticket — `<key>-<pid>.json` — so two windows on one ticket never erase
 * each other's marker. Markers live in
 * `DuetData/intents/<program>/windows/`; a window reads and writes only the
 * folder of its own program.
 *
 * (The word "pointer" is taken by `~/.org.ve68.duet`; this is a "window marker".)
 */

/** Where the ticket of the window lies now. */
export type TicketLocation = 'work' | 'backlog' | 'archive' | 'missing';

export interface WindowMarker {
    /** `window` — a live intent window; `reservation` — a window that is being opened. */
    kind: 'window' | 'reservation';
    /** What the window is opened on. Absent in markers of the first version, which knew intents only. */
    subject: 'intent' | 'business';
    /** Key of the window: the ticket number `DUE017`, or `@DuetLab` for a business window. */
    ticket: string;
    /** Ticket folder name: `DUE017_IntentSwitcher`. Empty for a business window. */
    ticketFolder: string;
    /** Business name and folder. */
    business: string;
    businessPath: string;
    /** Emoji of the business from its `context.json`; empty when it has none. */
    icon: string;
    /**
     * Emoji of the ticket: the `icon` of its `INDEX.md`, else the icon of the nearest ticket up its
     * `parent` chain (`TicketReader.inheritedIcon`); empty when none of them has one.
     */
    ticketIcon: string;
    /** What opening again brings the window forward: its workspace file, or the folder of a business opened as a folder. */
    workspaceFile: string;
    location: TicketLocation;
    /** Window colour in force, null when the window has none. */
    color: string | null;
    /** Extension host process of the window. */
    pid: number;
    /** Epoch milliseconds of the write. */
    writtenAt: number;
    /** Reservation only: epoch milliseconds after which it no longer counts. */
    expiresAt?: number;
}

/** A reservation holds an intent and its colour between the click and the start of the new window. */
export const RESERVATION_MS = 30_000;
/** Longest remembered order of active intents. */
export const ACTIVE_ORDER_LIMIT = 200;

export function markerFileName(marker: Pick<WindowMarker, 'kind' | 'ticket' | 'pid'>): string {
    return marker.kind === 'reservation'
        ? `${marker.ticket}-${marker.pid}.reserve.json`
        : `${marker.ticket}-${marker.pid}.json`;
}

/** Parse a marker file; null when the text is not a marker. */
export function parseMarker(text: string): WindowMarker | null {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        return null;
    }
    if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        return null;
    }
    const m = data as Record<string, unknown>;
    const kind = m.kind === 'reservation' ? 'reservation' : m.kind === 'window' ? 'window' : null;
    if (
        !kind ||
        typeof m.ticket !== 'string' || !m.ticket ||
        typeof m.ticketFolder !== 'string' ||
        typeof m.workspaceFile !== 'string' ||
        typeof m.pid !== 'number' ||
        typeof m.writtenAt !== 'number'
    ) {
        return null;
    }
    const location: TicketLocation =
        m.location === 'work' || m.location === 'backlog' || m.location === 'archive' ? m.location : 'missing';
    return {
        kind,
        subject: m.subject === 'business' ? 'business' : 'intent',
        ticket: m.ticket,
        ticketFolder: m.ticketFolder,
        business: typeof m.business === 'string' ? m.business : '',
        businessPath: typeof m.businessPath === 'string' ? m.businessPath : '',
        icon: typeof m.icon === 'string' ? m.icon : '',
        ticketIcon: typeof m.ticketIcon === 'string' ? m.ticketIcon : '',
        workspaceFile: m.workspaceFile,
        location,
        color: typeof m.color === 'string' ? m.color : null,
        pid: m.pid,
        writtenAt: m.writtenAt,
        ...(typeof m.expiresAt === 'number' ? { expiresAt: m.expiresAt } : {})
    };
}

export interface MarkerClock {
    /** Epoch milliseconds now. */
    now: number;
    /** Epoch milliseconds of the last system boot. */
    bootTime: number;
    isAlive: (pid: number) => boolean;
}

/**
 * Split markers into live and dead.
 *
 * A window marker is dead when its process is gone or it was written before the
 * last boot (the pid may belong to another process by now). A reservation is
 * dead when its time is out or the real window of the same ticket has shown up;
 * its pid is not checked — «open in the current window» ends the process that
 * wrote it.
 */
export function splitMarkers(
    markers: WindowMarker[],
    clock: MarkerClock
): { live: WindowMarker[]; dead: WindowMarker[] } {
    const live: WindowMarker[] = [];
    const dead: WindowMarker[] = [];
    for (const marker of markers) {
        if (marker.kind !== 'window') {
            continue;
        }
        const alive = marker.writtenAt >= clock.bootTime && clock.isAlive(marker.pid);
        (alive ? live : dead).push(marker);
    }
    const openTickets = new Set(live.map(m => m.ticket));
    for (const marker of markers) {
        if (marker.kind !== 'reservation') {
            continue;
        }
        const valid = (marker.expiresAt ?? 0) > clock.now && !openTickets.has(marker.ticket);
        (valid ? live : dead).push(marker);
    }
    return { live, dead };
}

/** Colours held by the open windows of the program, one entry per window, except those of `exceptTicket`. */
export function occupiedColors(live: WindowMarker[], exceptTicket?: string): string[] {
    return live
        .filter(m => m.ticket !== exceptTicket && m.color)
        .map(m => (m.color as string).toLowerCase());
}

/** The process and the clock a marker store runs in. Injected in tests. */
export interface MarkerEnv {
    pid: number;
    now: () => number;
    bootTime: () => number;
    isAlive: (pid: number) => boolean;
}

export const nodeMarkerEnv: MarkerEnv = {
    pid: process.pid,
    now: () => Date.now(),
    bootTime: () => Date.now() - os.uptime() * 1000,
    isAlive: (pid) => {
        try {
            process.kill(pid, 0);
            return true;
        } catch (error) {
            // EPERM: the process exists but belongs to another user
            return (error as NodeJS.ErrnoException).code === 'EPERM';
        }
    }
};

/**
 * Reads and writes the intents folder of one program:
 * `windows/<ticket>-<pid>.json` markers and `active.json`, the order of active
 * intents. Everything here is in DuetData, so writes go through a temporary
 * file and a rename.
 */
export class MarkerStore {
    private readonly fs: FileSystem;
    private readonly env: MarkerEnv;

    constructor(readonly programDir: string, fileSystem?: FileSystem, env?: MarkerEnv) {
        this.fs = fileSystem ?? nodeFs;
        this.env = env ?? nodeMarkerEnv;
    }

    get windowsDir(): string {
        return path.join(this.programDir, 'windows');
    }

    get orderPath(): string {
        return path.join(this.programDir, 'active.json');
    }

    get pid(): number {
        return this.env.pid;
    }

    pathOf(marker: Pick<WindowMarker, 'kind' | 'ticket' | 'pid'>): string {
        return path.join(this.windowsDir, markerFileName(marker));
    }

    /** The folder must exist before a watcher is put on it. */
    async ensureDirs(): Promise<void> {
        await this.fs.mkdir(this.windowsDir, { recursive: true });
    }

    /** Write the marker of this process; `writtenAt` and `pid` are filled in here. */
    async write(marker: Omit<WindowMarker, 'pid' | 'writtenAt' | 'expiresAt'>): Promise<WindowMarker> {
        const now = this.env.now();
        const full: WindowMarker = {
            ...marker,
            pid: this.env.pid,
            writtenAt: now,
            ...(marker.kind === 'reservation' ? { expiresAt: now + RESERVATION_MS } : {})
        };
        await this.ensureDirs();
        await this.fs.atomicWriteFile(this.pathOf(full), JSON.stringify(full, null, 2) + '\n', 'utf8');
        return full;
    }

    async exists(marker: Pick<WindowMarker, 'kind' | 'ticket' | 'pid'>): Promise<boolean> {
        try {
            await this.fs.access(this.pathOf(marker));
            return true;
        } catch {
            return false;
        }
    }

    async remove(marker: Pick<WindowMarker, 'kind' | 'ticket' | 'pid'>): Promise<void> {
        try {
            await this.fs.unlink(this.pathOf(marker));
        } catch {
            // already gone
        }
    }

    /**
     * Read the live markers of the program. Dead ones are removed on the way:
     * any reader may do that. Files that are not markers are left alone.
     */
    async read(): Promise<WindowMarker[]> {
        let names: string[];
        try {
            const entries = await this.fs.readdir(this.windowsDir, { withFileTypes: true });
            names = entries.filter(e => !e.isDirectory() && e.name.endsWith('.json')).map(e => e.name);
        } catch {
            return [];
        }
        const markers: WindowMarker[] = [];
        for (const name of names.sort()) {
            try {
                const marker = parseMarker(await this.fs.readFile(path.join(this.windowsDir, name), 'utf8'));
                // The name is the identity: a copy under another name is not a marker
                if (marker && markerFileName(marker) === name) {
                    markers.push(marker);
                }
            } catch {
                // removed between the listing and the read
            }
        }
        const { live, dead } = splitMarkers(markers, {
            now: this.env.now(),
            bootTime: this.env.bootTime(),
            isAlive: this.env.isAlive
        });
        await Promise.all(dead.map(m => this.remove(m)));
        return live;
    }

    /** Remembered order of active intents; empty when the file is absent or unreadable. */
    async readOrder(): Promise<string[]> {
        try {
            return parseOrder(await this.fs.readFile(this.orderPath, 'utf8')) ?? [];
        } catch {
            return [];
        }
    }

    async writeOrder(order: string[]): Promise<void> {
        await this.fs.mkdir(this.programDir, { recursive: true });
        await this.fs.atomicWriteFile(
            this.orderPath,
            serializeOrder(order.slice(0, ACTIVE_ORDER_LIMIT)),
            'utf8'
        );
    }
}
