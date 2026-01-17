import { vi } from 'vitest';

export const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
};

export const existsSync = vi.fn();

export default {
    promises,
    existsSync,
};
