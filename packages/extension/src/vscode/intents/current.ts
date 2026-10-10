import { TicketService } from '../../core/intents/ticketService';
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

/**
 * The ticket service of this window — the server that creates and moves
 * tickets — for the same commands. Null until the port of the backend is known.
 */
let tickets: TicketService | null = null;

export function setTicketService(service: TicketService | null): void {
    tickets = service;
}

export function getTicketService(): TicketService | null {
    return tickets;
}
