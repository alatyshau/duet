import { IntentsRuntime } from './IntentsRuntime';

/**
 * The intents runtime of this window, for commands that are registered apart
 * from it — opening a business needs it to choose and hold the window colour.
 * Null until activation has started it, and when Duet is not configured.
 */
let current: IntentsRuntime | null = null;

export function setIntentsRuntime(runtime: IntentsRuntime | null): void {
    current = runtime;
}

export function getIntentsRuntime(): IntentsRuntime | null {
    return current;
}
