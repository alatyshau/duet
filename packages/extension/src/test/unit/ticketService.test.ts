/* eslint-disable @typescript-eslint/naming-convention */
import { describe, it, expect, vi } from 'vitest';
import {
    ServerTicketService,
    TicketActionResponse,
    ticketNameLength
} from '../../core/intents/ticketService';

const answer = (over: Partial<TicketActionResponse>): TicketActionResponse =>
    ({ text: '', is_error: false, tickets: [], ...over });

describe('ServerTicketService', () => {
    it('creates a ticket through the server and tells where it lies', async () => {
        const ticketAction = vi.fn(async () => answer({
            tickets: [{ number: 'DUE039', name: 'UiResearch', shelf: 'work', folder: '/drive/DuetLab/work/DUE039_UiResearch' }]
        }));
        const made = await new ServerTicketService({ ticketAction }).create('DUE', 'ui research');

        // The name goes as typed: the folder name is made by the server
        expect(ticketAction).toHaveBeenCalledWith('new_ticket', { name: 'ui research', code: 'DUE' });
        expect(made).toEqual({
            number: 'DUE039', shelf: 'work', folder: 'DUE039_UiResearch', path: '/drive/DuetLab/work/DUE039_UiResearch'
        });
    });

    it('moves a ticket by its number and gives the new path', async () => {
        const ticketAction = vi.fn(async () => answer({
            tickets: [{ number: 'DUE008', name: 'CoreProtocols', shelf: 'backlog', folder: '/drive/DuetLab/backlog/DUE008_CoreProtocols' }]
        }));
        const moved = await new ServerTicketService({ ticketAction }).move('DUE008', 'backlog');

        expect(ticketAction).toHaveBeenCalledWith('move_ticket', { ticket: 'DUE008', to: 'backlog' });
        expect(moved).toBe('/drive/DuetLab/backlog/DUE008_CoreProtocols');
    });

    it("throws the server's reason without the Error: prefix", async () => {
        const ticketAction = async () => answer({ is_error: true, text: 'Error: ticket DUE099 not found in DuetLab.' });
        await expect(new ServerTicketService({ ticketAction }).move('DUE099', 'work'))
            .rejects.toThrow(/^ticket DUE099 not found in DuetLab\.$/);
    });

    it('says the server did not answer when the request itself fails', async () => {
        const ticketAction = async (): Promise<TicketActionResponse> => { throw new Error('fetch failed'); };
        await expect(new ServerTicketService({ ticketAction }).create('DUE', 'x'))
            .rejects.toThrow(/сервер Duet не ответил.*fetch failed/);
    });

    it('does not take a success without a ticket for one', async () => {
        const ticketAction = async () => answer({ text: 'No changes.' });
        await expect(new ServerTicketService({ ticketAction }).move('DUE008', 'work')).rejects.toThrow(/без тикета/);
    });
});

describe('ticketNameLength', () => {
    it('counts the letters and digits the folder name is made of', () => {
        expect(ticketNameLength('ui research')).toBe(10);
        expect(ticketNameLength('  bin-sync_now.please  ')).toBe(16);
        expect(ticketNameLength('синхронизация корзины')).toBe(20);
        expect(ticketNameLength('')).toBe(0);
        expect(ticketNameLength(' — … ')).toBe(0);
    });
});
