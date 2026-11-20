/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (founder 2026-11-20, crop photos: the plot card's title bar carries the crop's own colour).
 *
 * Which text colour reads on a crop's colour (a Tailwind `bg-NAME-SHADE` class from `profile/helpers/cropPalette.ts`): white only on the
 * dark ones, dark ink on every other, so the plot name is never light letters on a light bar.
 */
const ALWAYS_DARK_BASES = ['indigo', 'violet', 'purple'];

/** `text-white` on a dark colour, `text-stone-900` on any other (and on a colour that is not a Tailwind background class). */
export function inkOnColour(colourClass: string | undefined): 'text-white' | 'text-stone-900' {
    const m = /^bg-([a-z]+)-(\d{3})$/.exec(colourClass ?? '');
    if (!m) return 'text-stone-900';
    const base = m[1];
    const shade = Number(m[2]);
    if (shade >= 700) return 'text-white';
    if (ALWAYS_DARK_BASES.includes(base) && shade >= 500) return 'text-white';
    if (base === 'blue' && shade >= 600) return 'text-white';
    return 'text-stone-900';
}
