import { ContextEntity } from '../api-client';
import { normalizePath } from '../pathUtils';

/**
 * The КОНТЕКСТ panel: where the window stands in the tree of businesses.
 *
 * Built from the `/contexts` list the extension already holds — no backend
 * round trip. Three levels at most: the venture (root of the parent chain),
 * the current business, and the businesses directly under it. Intermediate
 * parents are not shown; the full tree is the «Все Бизнесы» view.
 */

export type BusinessRole = 'venture' | 'current' | 'child';

export interface BusinessPanelNode {
    kind: 'business';
    role: BusinessRole;
    name: string;
    icon: string;
    description?: string;
    absolutePath?: string;
    children: BusinessPanelNode[];
}

/**
 * The current business of a window: the business whose folder is among the
 * window's folders. A repo folder never chooses a business — one repo may be
 * declared by several. With several business folders open, the meta-context
 * wins, otherwise the first in the window's folder order (the Backend's rule
 * for deploying instructions).
 */
export function findCurrentBusiness(
    contexts: ContextEntity[],
    openPaths: string[]
): ContextEntity | null {
    const byPath = new Map<string, ContextEntity>();
    for (const context of contexts) {
        if (context.absolute_path) {
            byPath.set(normalizePath(context.absolute_path), context);
        }
    }
    const open = openPaths
        .map(p => byPath.get(normalizePath(p)))
        .filter((c): c is ContextEntity => c !== undefined);
    return open.find(c => c.meta) ?? open[0] ?? null;
}

/** Build the panel's root node, or null when the window has no current business. */
export function buildContextPanel(
    contexts: ContextEntity[],
    openPaths: string[]
): BusinessPanelNode | null {
    const current = findCurrentBusiness(contexts, openPaths);
    if (!current) {
        return null;
    }

    const byId = new Map(contexts.map(c => [c.id, c]));
    let venture = current;
    const seen = new Set<string>([current.id]);
    while (venture.parent_id) {
        const parent = byId.get(venture.parent_id);
        if (!parent || seen.has(parent.id)) {
            break;
        }
        seen.add(parent.id);
        venture = parent;
    }

    const children = contexts
        .filter(c => c.parent_id === current.id)
        .map(c => toNode(c, 'child', []));

    if (venture.id === current.id) {
        return toNode(current, 'venture', children);
    }
    return toNode(venture, 'venture', [toNode(current, 'current', children)]);
}

function toNode(context: ContextEntity, role: BusinessRole, children: BusinessPanelNode[]): BusinessPanelNode {
    return {
        kind: 'business',
        role,
        name: context.name,
        icon: context.icon ?? '',
        description: context.description ?? undefined,
        absolutePath: context.absolute_path ?? undefined,
        children
    };
}
