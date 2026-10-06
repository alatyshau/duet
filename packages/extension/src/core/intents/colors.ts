/**
 * Window colour of an intent: eight colours that carry white text.
 *
 * An intent remembers up to three colours — the main one and two spares — and
 * opens in the first of them that no open window of the program holds. The
 * main colour stays the main one even when a spare is used.
 */
export const INTENT_PALETTE: readonly string[] = [
    '#1f6f43', '#1f4f8f', '#6b3fa0', '#1f7a7a',
    '#5a6a1f', '#8f4a1f', '#8f1f3f', '#8f1f7a'
];

/**
 * Theme colour ids the extension declares for the palette, in palette order
 * (`contributes.colors` in package.json). A row decoration can only name a
 * colour by such an id, never by its hex value. In light themes an id stands
 * for the palette colour itself; in dark themes for a lighter shade of it,
 * because the palette is dark — chosen to carry white text.
 */
export const INTENT_COLOR_IDS: readonly string[] = INTENT_PALETTE.map((_, index) => `duet.intent.color${index + 1}`);

/** Theme colour id for a window colour; null when the colour is not one of the palette. */
export function intentColorId(color: string | null | undefined): string | null {
    const index = color ? INTENT_PALETTE.indexOf(color.toLowerCase()) : -1;
    return index === -1 ? null : INTENT_COLOR_IDS[index];
}

/**
 * The light version of a window colour, for a backdrop behind text: the colour
 * itself at one fifth strength. Transparency, not a fixed light colour, on
 * purpose — over a light side bar it gives a light tint, over a dark one a dark
 * tint, and over the selection in the same colour it vanishes, so the text on
 * it stays readable in every case.
 */
export function backdropColor(color: string): string {
    return `${color}33`;
}

/** The main colour plus two spares. */
export const REMEMBERED_COLORS_LIMIT = 3;

export interface ColorChoice {
    /** Colour the window opens in. */
    color: string;
    /** Colours to remember for the intent, main first. */
    remembered: string[];
}

export function isPaletteColor(color: unknown): color is string {
    return typeof color === 'string' && INTENT_PALETTE.includes(color.toLowerCase());
}

/** Palette colours only, lower case, no repeats, at most the remembered limit. */
export function normalizeRemembered(colors: unknown): string[] {
    if (!Array.isArray(colors)) {
        return [];
    }
    const result: string[] = [];
    for (const color of colors) {
        if (isPaletteColor(color) && !result.includes(color.toLowerCase())) {
            result.push(color.toLowerCase());
        }
    }
    return result.slice(0, REMEMBERED_COLORS_LIMIT);
}

/**
 * Choose the colour an intent opens in.
 *
 * @param remembered - colours the intent already remembers, main first
 * @param occupied - colours of the open windows of this program, one entry per window
 * @param random - `Math.random` in production; injected in tests
 */
export function chooseIntentColor(
    remembered: string[],
    occupied: string[],
    random: () => number = Math.random
): ColorChoice {
    const known = normalizeRemembered(remembered);
    const taken = occupied.map(c => c.toLowerCase());

    const free = known.find(c => !taken.includes(c));
    if (free) {
        return { color: free, remembered: known };
    }

    const unoccupied = INTENT_PALETTE.filter(c => !taken.includes(c));
    if (unoccupied.length > 0) {
        const color = pick(unoccupied, random);
        // A new colour is remembered while the intent has room for one; with the
        // main colour and both spares taken, the window gets a colour for this time only.
        return known.length < REMEMBERED_COLORS_LIMIT
            ? { color, remembered: [...known, color] }
            : { color, remembered: known };
    }

    // More windows than colours: repeat one of the least used, remember nothing.
    const usage = INTENT_PALETTE.map(c => taken.filter(t => t === c).length);
    const least = Math.min(...usage);
    const rarest = INTENT_PALETTE.filter((_, i) => usage[i] === least);
    return { color: pick(rarest, random), remembered: known };
}

function pick(colors: readonly string[], random: () => number): string {
    const index = Math.min(colors.length - 1, Math.floor(random() * colors.length));
    return colors[index];
}
