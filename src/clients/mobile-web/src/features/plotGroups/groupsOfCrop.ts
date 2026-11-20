/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane GRP-1a) - the groups among the plots of ONE crop, for the selectors
 * (a quick button per group). Pure: it reads the plots it is given and nothing else.
 *
 * WHAT A GROUP IS. Only a label: plots with the same TRIMMED `groupName` are one group; a plot with no name (missing, null or
 * blank) is in no group. There is no group id, no stored order and no colour.
 *
 * ACCESS (binding for every screen that uses this). Team access is stored as a LIST OF PLOT IDS and does NOT follow a group:
 * ticking a group later ticks only the plots it holds at that moment, and a plot added to the group afterwards is NOT covered by
 * that earlier tick. So nothing may ever display a group name as someone's access ("access: विहिरीजवळचे" would be a lie the day a
 * plot joins the group). A group name may label a selection shortcut; it may never describe a person's reach.
 */

/** What the grouping reads from a plot: the app's `Plot` and the server's `PlotDto` both fit. */
export interface GroupablePlot {
    id: string;
    name: string;
    groupName?: string | null;
}

export interface PlotGroup {
    /** The trimmed group name, as the first plot of the group spells it. */
    name: string;
    /** The plots of the group, in natural number order (G2 before G10). */
    plotIds: string[];
}

const ASCII_ZERO = 0x30;
const DEVANAGARI_ZERO = 0x0966;

/** The value of a decimal digit (ASCII or Devanagari), or -1 when the character is not one. */
function digitValue(ch: string): number {
    const code = ch.charCodeAt(0);
    if (code >= ASCII_ZERO && code <= ASCII_ZERO + 9) return code - ASCII_ZERO;
    if (code >= DEVANAGARI_ZERO && code <= DEVANAGARI_ZERO + 9) return code - DEVANAGARI_ZERO;
    return -1;
}

type Chunk = { digits: string } | { text: string };

/** "G10" -> [text "g", digits "10"]; digits are normalised to ASCII without leading zeros so any length compares exactly. */
function chunksOf(name: string): Chunk[] {
    const chunks: Chunk[] = [];
    let run = '';
    let runIsDigits = false;
    const flush = () => {
        if (!run) return;
        chunks.push(runIsDigits ? { digits: run.replace(/^0+(?=\d)/, '') } : { text: run });
        run = '';
    };
    for (const ch of name.trim().toLowerCase()) {
        const value = digitValue(ch);
        const isDigit = value >= 0;
        if (run && isDigit !== runIsDigits) flush();
        runIsDigits = isDigit;
        run += isDigit ? String(value) : ch;
    }
    flush();
    return chunks;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Natural order: runs of digits compare as numbers ("G2" < "G10"), everything else by code point. Deterministic on every device. */
export function compareNaturally(a: string, b: string): number {
    const left = chunksOf(a);
    const right = chunksOf(b);
    for (let i = 0; i < Math.min(left.length, right.length); i++) {
        const l = left[i];
        const r = right[i];
        if ('digits' in l && 'digits' in r) {
            const byLength = l.digits.length - r.digits.length;
            if (byLength !== 0) return byLength < 0 ? -1 : 1;
            const byValue = compareText(l.digits, r.digits);
            if (byValue !== 0) return byValue;
        } else if ('digits' in l) {
            return -1;
        } else if ('digits' in r) {
            return 1;
        } else {
            const byText = compareText(l.text, r.text);
            if (byText !== 0) return byText;
        }
    }
    return left.length - right.length;
}

/** A plot's group name, trimmed; null when it has none (missing, null, blank or not text). */
export function groupNameOf(plot: Pick<GroupablePlot, 'groupName'>): string | null {
    return typeof plot.groupName === 'string' && plot.groupName.trim() ? plot.groupName.trim() : null;
}

/**
 * The groups among `plots` (the plots of one crop): groups in the natural order of their FIRST plot, the plots inside each in
 * natural order. Plots with no group are in none. Empty input gives no groups. The input is never changed.
 */
export function groupsOfCrop(plots: readonly GroupablePlot[]): PlotGroup[] {
    const ordered = [...plots].sort((a, b) => compareNaturally(a.name, b.name) || compareText(a.id, b.id));
    const groups = new Map<string, PlotGroup>();
    for (const plot of ordered) {
        const name = groupNameOf(plot);
        if (name === null) continue;
        const group = groups.get(name);
        if (group) group.plotIds.push(plot.id);
        else groups.set(name, { name, plotIds: [plot.id] });
    }
    return [...groups.values()];
}
