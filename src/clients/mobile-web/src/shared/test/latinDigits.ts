/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-D2; founder D-123b) - the test side of "Marathi mode shows Devanagari
 * digits": find every Latin digit (0-9) in what a screen shows, text and spoken labels alike.
 *
 * Limit: the attribute scan covers aria-label, title, placeholder and alt only. It does NOT read aria-valuetext, aria-valuenow, or the `value`
 * of an input (a range, a number field); a screen that prints a number there is not checked by this helper.
 *
 * An `allowed` entry is a piece of text that is NOT a number the app printed - a name as it was recorded, a quoted publication
 * title - and every test that passes one names it and says why. Nothing else is skipped.
 */

const LATIN_DIGIT = /[0-9]/;
const LABEL_ATTRS = ['aria-label', 'title', 'placeholder', 'alt'] as const;

const strip = (text: string, allowed: readonly string[]): string =>
    allowed.reduce((rest, piece) => (piece ? rest.split(piece).join('') : rest), text);

const where = (node: Node): string => {
    const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
    return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.tagName.toLowerCase() ?? '?';
};

/** Every piece of visible text (and every spoken label) under `root` that still holds a Latin digit, with where it sits. */
export function latinDigitFindings(root: Element, allowed: readonly string[] = []): string[] {
    const found: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = strip(n.textContent ?? '', allowed);
        if (LATIN_DIGIT.test(text)) found.push(`[${where(n)}] "${text.trim()}"`);
    }
    const all = [root, ...Array.from(root.querySelectorAll('*'))];
    for (const el of all) {
        for (const attr of LABEL_ATTRS) {
            const value = strip(el.getAttribute(attr) ?? '', allowed);
            if (LATIN_DIGIT.test(value)) found.push(`[${where(el)} @${attr}] "${value.trim()}"`);
        }
    }
    return found;
}
