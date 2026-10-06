import { insertNextTo, placeNextTo, sortByOrder } from './order';
import { Shelf, TicketInfo } from './tickets';

/**
 * The bin: all tickets of a business from `work/` and `backlog/`, laid out by
 * container.
 *
 * A container is a ticket with `work-type: process` or `program`. Containers
 * always stand flat, in the remembered order; those it does not hold come
 * after — processes first, then programs, by number. Under a
 * container go its tickets from `work/`, then a «Backlog» node with its tickets
 * from `backlog/`. Tickets without a container form the «Unsorted» group of the
 * same shape. A container group stands in the root while the container or one
 * of its tickets lies in `work/`; otherwise the whole group goes under the root
 * «Backlog». Every row appears once.
 */

export const CONTAINER_TYPES: readonly string[] = ['process', 'program'];
export const UNSORTED_GROUP = 'unsorted';
export const ROOT_GROUP = 'root';

export interface TicketNode {
    kind: 'ticket';
    /** Stable across refreshes: `ticket:<folder path>`. Two folders with one number get two keys. */
    key: string;
    ticket: TicketInfo;
    /** True for a process or a program. */
    container: boolean;
    /** Group the row belongs to: the container's folder path, or `unsorted`. */
    group: string;
    children: BinNode[];
}

export interface BacklogNode {
    kind: 'backlog';
    key: string;
    /** Group whose backlog this is; `root` for the root «Backlog» that holds whole container groups. */
    group: string;
    children: BinNode[];
}

export interface UnsortedNode {
    kind: 'unsorted';
    key: string;
    group: string;
    children: BinNode[];
}

export type BinNode = TicketNode | BacklogNode | UnsortedNode;

export function isContainer(ticket: TicketInfo): boolean {
    return ticket.workType !== null && CONTAINER_TYPES.includes(ticket.workType);
}

interface Group {
    work: TicketInfo[];
    backlog: TicketInfo[];
}

/**
 * Build the bin from the tickets of a business and its remembered order.
 * Tickets inside a group follow the order; those it does not hold come after, by number.
 * Containers follow it among themselves the same way (`sortContainers`).
 */
export function buildBinTree(tickets: TicketInfo[], order: string[]): BinNode[] {
    // One folder answers for a number: the one in work, then the first by path
    const byNumber = new Map<string, TicketInfo>();
    for (const ticket of [...tickets].sort(byShelfThenPath)) {
        if (!byNumber.has(ticket.number)) {
            byNumber.set(ticket.number, ticket);
        }
    }

    const containers = sortContainers(tickets.filter(isContainer), order);
    const groups = new Map<string, Group>(containers.map(c => [c.path, { work: [], backlog: [] }]));
    const unsorted: Group = { work: [], backlog: [] };

    for (const ticket of tickets) {
        if (isContainer(ticket)) {
            continue;
        }
        const container = containerOf(ticket, byNumber);
        const group = container ? groups.get(container.path)! : unsorted;
        group[ticket.shelf].push(ticket);
    }

    const shelfNodes = (list: TicketInfo[], group: string): TicketNode[] =>
        sortByOrder(list, order, t => t.number, t => t.path).map(ticket => ({
            kind: 'ticket', key: ticketKey(ticket), ticket, container: false, group, children: []
        }));
    const groupChildren = (group: Group, key: string): BinNode[] => {
        const children: BinNode[] = shelfNodes(group.work, key);
        if (group.backlog.length > 0) {
            children.push({
                kind: 'backlog', key: `backlog:${key}`, group: key, children: shelfNodes(group.backlog, key)
            });
        }
        return children;
    };

    const root: BinNode[] = [];
    const backlogged: BinNode[] = [];
    for (const container of containers) {
        const group = groups.get(container.path)!;
        const node: TicketNode = {
            kind: 'ticket',
            key: ticketKey(container),
            ticket: container,
            container: true,
            group: container.path,
            children: groupChildren(group, container.path)
        };
        // A program does not hide in the backlog while one of its tickets is in work
        (container.shelf === 'work' || group.work.length > 0 ? root : backlogged).push(node);
    }
    if (unsorted.work.length + unsorted.backlog.length > 0) {
        root.push({
            kind: 'unsorted', key: UNSORTED_GROUP, group: UNSORTED_GROUP,
            children: groupChildren(unsorted, UNSORTED_GROUP)
        });
    }
    if (backlogged.length > 0) {
        root.push({ kind: 'backlog', key: `backlog:${ROOT_GROUP}`, group: ROOT_GROUP, children: backlogged });
    }
    return root;
}

export function ticketKey(ticket: Pick<TicketInfo, 'path'>): string {
    return `ticket:${ticket.path}`;
}

/**
 * The container of a ticket: the nearest process or program up the `parent`
 * chain. A parent that is not in `work/` or `backlog/` of the business, or a
 * chain that ends without a container, gives null — the ticket is «Unsorted».
 */
function containerOf(ticket: TicketInfo, byNumber: Map<string, TicketInfo>): TicketInfo | null {
    const seen = new Set<string>([ticket.number]);
    let parent = ticket.parent;
    while (parent && !seen.has(parent)) {
        seen.add(parent);
        const found = byNumber.get(parent);
        if (!found) {
            return null;
        }
        if (isContainer(found)) {
            return found;
        }
        parent = found.parent;
    }
    return null;
}

function byShelfThenPath(a: TicketInfo, b: TicketInfo): number {
    if (a.shelf !== b.shelf) {
        return a.shelf === 'work' ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Containers in shown order: those the remembered order holds, in its sequence —
 * processes and programs mixed as the user put them; the rest after them,
 * processes first, then programs, by number.
 */
function sortContainers(containers: TicketInfo[], order: string[]): TicketInfo[] {
    const position = new Map(order.map((n, i) => [n, i]));
    return [...containers].sort((a, b) => {
        const pa = position.get(a.number);
        const pb = position.get(b.number);
        if (pa !== undefined && pb !== undefined && pa !== pb) {
            return pa - pb;
        }
        if ((pa === undefined) !== (pb === undefined)) {
            return pa !== undefined ? -1 : 1;
        }
        return byTypeThenNumber(a, b);
    });
}

function byTypeThenNumber(a: TicketInfo, b: TicketInfo): number {
    if (a.workType !== b.workType) {
        return a.workType === 'process' ? -1 : 1;
    }
    if (a.number !== b.number) {
        return a.number < b.number ? -1 : 1;
    }
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

export function findBinNode(nodes: BinNode[], key: string): BinNode | null {
    for (const node of nodes) {
        if (node.key === key) {
            return node;
        }
        const deeper = findBinNode(node.children, key);
        if (deeper) {
            return deeper;
        }
    }
    return null;
}

export function parentOfBinNode(nodes: BinNode[], key: string, parent: BinNode | null = null): BinNode | null {
    for (const node of nodes) {
        if (node.key === key) {
            return parent;
        }
        const deeper = parentOfBinNode(node.children, key, node);
        if (deeper) {
            return deeper;
        }
    }
    return null;
}

/** Ticket rows of the tree, containers included. */
export function binTickets(nodes: BinNode[]): TicketNode[] {
    return nodes.flatMap(node => node.kind === 'ticket'
        ? [node, ...binTickets(node.children)]
        : binTickets(node.children));
}

/**
 * One group as the single sequence a drag is measured in: the header, the
 * tickets in work, the «Backlog» node, the tickets in the backlog.
 */
export interface GroupSequence {
    /** The container row, or the «Unsorted» node. */
    header: BinNode;
    work: TicketNode[];
    backlogNode: BacklogNode | null;
    backlog: TicketNode[];
}

export function groupSequence(tree: BinNode[], group: string): GroupSequence | null {
    const header = group === UNSORTED_GROUP
        ? findBinNode(tree, UNSORTED_GROUP)
        : findBinNode(tree, `ticket:${group}`);
    if (!header) {
        return null;
    }
    const work = header.children.filter((n): n is TicketNode => n.kind === 'ticket');
    const backlogNode = header.children.find((n): n is BacklogNode => n.kind === 'backlog') ?? null;
    const backlog = (backlogNode?.children ?? []).filter((n): n is TicketNode => n.kind === 'ticket');
    return { header, work, backlogNode, backlog };
}

export type BinDrop =
    /** Nothing happens; `reason` is the one line to tell the user, null when there is nothing to say. */
    | { ok: false; reason: string | null }
    | {
        ok: true;
        ticket: TicketInfo;
        /** Shelf the ticket lands on. */
        shelf: Shelf;
        /** True when the landing shelf differs from the ticket's own, so its folder moves. */
        move: boolean;
        /**
         * Numbers of the rows the drop put in order, in shown order after it: for a
         * ticket the landing shelf of its group, for a container the containers of its level.
         */
        shelfOrder: string[];
    };

/**
 * Decide what a drop in the bin does. The tree view reports only the row the
 * drop landed on, not the place between rows, so "up or down" is measured in
 * the group's sequence: a row dragged up lands before the target, a row dragged
 * down lands after it. A drop on the header puts the ticket first in work; a
 * drop on «Backlog» from work puts it first in the backlog, from the backlog —
 * last in work.
 *
 * A ticket moves only inside its own group. A container only changes its place
 * among the containers of its level (`decideContainerDrop`). The tree view
 * cannot forbid a drop in advance, so a refusal is returned as a line to show.
 */
export function decideBinDrop(
    tree: BinNode[],
    sourceKey: string,
    targetKey: string | null,
    isOpen: (ticketNumber: string) => boolean
): BinDrop {
    const source = findBinNode(tree, sourceKey);
    if (!source) {
        return { ok: false, reason: 'Корзина изменилась: этой строки больше нет.' };
    }
    if (source.kind !== 'ticket') {
        return { ok: false, reason: 'Перетаскиваются только тикеты.' };
    }
    if (source.container) {
        return decideContainerDrop(tree, source, targetKey);
    }
    const outside = 'Тикет перетаскивается только внутри своей группы: между её работой и её «Backlog».';
    if (targetKey === null) {
        return { ok: false, reason: outside };
    }
    if (targetKey === sourceKey) {
        return { ok: false, reason: null };
    }
    const sequence = groupSequence(tree, source.group);
    if (!sequence) {
        return { ok: false, reason: 'Корзина изменилась: группы этой строки больше нет.' };
    }

    const flat: BinNode[] = [
        sequence.header,
        ...sequence.work,
        ...(sequence.backlogNode ? [sequence.backlogNode] : []),
        ...sequence.backlog
    ];
    const from = flat.findIndex(n => n.key === sourceKey);
    const to = flat.findIndex(n => n.key === targetKey);
    if (to === -1) {
        return { ok: false, reason: outside };
    }
    const target = flat[to];
    const numbers = (shelf: Shelf): string[] =>
        (shelf === 'work' ? sequence.work : sequence.backlog).map(n => n.ticket.number);
    const number = source.ticket.number;
    const own = source.ticket.shelf;

    let shelf: Shelf;
    let shelfOrder: string[];
    if (target.key === sequence.header.key) {
        shelf = 'work';
        shelfOrder = [number, ...numbers('work').filter(n => n !== number)];
    } else if (target.kind === 'backlog') {
        shelf = own === 'work' ? 'backlog' : 'work';
        shelfOrder = shelf === 'backlog'
            ? [number, ...numbers('backlog')]
            : [...numbers('work'), number];
    } else if (target.kind === 'ticket') {
        shelf = target.ticket.shelf;
        shelfOrder = insertNextTo(numbers(shelf), number, target.ticket.number, from < to);
    } else {
        return { ok: false, reason: outside };
    }

    const move = shelf !== own;
    if (move && shelf === 'backlog' && isOpen(number)) {
        return { ok: false, reason: 'У тикета открыто окно: в «Backlog» он не переносится.' };
    }
    if (!move && sameList(shelfOrder, numbers(shelf))) {
        return { ok: false, reason: null };
    }
    return { ok: true, ticket: source.ticket, shelf, move, shelfOrder };
}

/**
 * A dragged process or program changes its place among the containers of its
 * level: those of the root, or those under the root «Backlog». Its folder never
 * moves. The row the drop landed on stands for the row of the level it belongs
 * to: a drop on a ticket of another program is a drop on that program. Dragged
 * up, the container lands before the target, dragged down — after it. A drop on
 * «Unsorted» or past the rows puts it last, a drop on the root «Backlog» from
 * inside it — first.
 */
function decideContainerDrop(tree: BinNode[], source: TicketNode, targetKey: string | null): BinDrop {
    const rootBacklog = tree.find((n): n is BacklogNode => n.kind === 'backlog' && n.group === ROOT_GROUP) ?? null;
    const containersOf = (nodes: BinNode[]): TicketNode[] =>
        nodes.filter((n): n is TicketNode => n.kind === 'ticket' && n.container);
    const inBacklog = rootBacklog !== null && rootBacklog.children.some(n => n.key === source.key);
    const level = containersOf(inBacklog ? rootBacklog.children : tree);
    const numbers = level.map(n => n.ticket.number);
    const number = source.ticket.number;
    const otherLevel = 'Процесс или программа перетаскиванием только меняет место среди соседних; в «Backlog» и обратно так не переносится.';

    let next: string[];
    if (targetKey === null) {
        next = placeNextTo(numbers, number, null);
    } else {
        const target = levelRowOf(tree, targetKey, rootBacklog);
        if (!target) {
            return { ok: false, reason: 'Корзина изменилась: этой строки больше нет.' };
        }
        if (target.key === source.key) {
            return { ok: false, reason: null };
        }
        if (target === rootBacklog) {
            if (!inBacklog) {
                return { ok: false, reason: otherLevel };
            }
            next = [number, ...numbers.filter(n => n !== number)];
        } else if (target.kind === 'unsorted') {
            if (inBacklog) {
                return { ok: false, reason: otherLevel };
            }
            next = placeNextTo(numbers, number, null);
        } else if (target.kind === 'ticket' && level.some(n => n.key === target.key)) {
            next = placeNextTo(numbers, number, target.ticket.number);
        } else {
            return { ok: false, reason: otherLevel };
        }
    }
    if (sameList(next, numbers)) {
        return { ok: false, reason: null };
    }
    return { ok: true, ticket: source.ticket, shelf: source.ticket.shelf, move: false, shelfOrder: next };
}

/**
 * The row of a level a row stands in or is: a root container, «Unsorted», the
 * root «Backlog», or a container under the root «Backlog». Null when the row is gone.
 */
function levelRowOf(tree: BinNode[], key: string, rootBacklog: BacklogNode | null): BinNode | null {
    let node = findBinNode(tree, key);
    while (node) {
        const parent = parentOfBinNode(tree, node.key);
        if (!parent || parent === rootBacklog) {
            return node;
        }
        node = parent;
    }
    return null;
}

function sameList(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}
