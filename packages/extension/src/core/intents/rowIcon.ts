/**
 * The icon of a row as a picture. A tree row has one place for an icon, at its
 * left edge, and it takes an image, not text; an emoji drawn as a small SVG
 * goes there. Every row gets the picture — an empty one when it has no emoji —
 * so the names of all rows start in one column.
 */
export function rowIconSvg(emoji: string): string {
    const glyph = emoji
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    const text = glyph
        ? `<text x="8" y="12.5" font-size="12.5" text-anchor="middle">${glyph}</text>`
        : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">${text}</svg>`;
}

/** The picture as a `data:` address a tree row accepts for its icon. */
export function rowIconDataUri(emoji: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(rowIconSvg(emoji), 'utf8').toString('base64')}`;
}
