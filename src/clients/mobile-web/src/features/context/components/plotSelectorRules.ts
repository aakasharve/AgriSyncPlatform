/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a; founder picks 2026-11-20, "many plots of one crop")
 *
 * THE rules of "how do I show a crop's plots", in one place, pure. Every screen that lists a crop's plots (the log's plot question,
 * planning, the task-done sheet, the place picker, the आढावा picker and its plot cards) reads its thresholds from here, so 15 plots look
 * and behave the same everywhere and the next lane (schedule library, Team, Setup) only has to ask.
 *
 *   - 1 to 6 plots           chips, as before.
 *   - 7 or more plots        a number grid plus quick buttons ("सगळे", and only the true ones).
 *   - 25 or more plots       a search box too (a number or a name; a Devanagari digit and a Latin digit both work).
 *   - 4 or more plots of one crop: its photo ONCE, in a header; its plots carry only the crop's colour and name.
 *     1 to 3 plots keep a photo per card, as before. The founder's words: "if same crop is more than 3 times it should only show one
 *     image no repeated image use this principle every where".
 *
 * Honesty: a quick button is built only from a fact the phone already holds (the work records, indexed by date). A button whose count
 * is zero is not drawn; nothing here invents a number or a label.
 */
import type { DailyLog } from '../../../types';
import { digitsFor } from '../../../shared/utils/marathiDigits';

/** From this many plots: a number grid and quick buttons instead of chips. */
export const PLOT_GRID_FROM = 7;
/** From this many plots: a search box over the number grid. */
export const PLOT_SEARCH_FROM = 25;
/** From this many plots of one crop: the crop's photo once in a header, the plots carry only its colour and name. */
export const PHOTO_ONCE_FROM = 4;
/** From this many plot cards of one crop: two small cards across instead of one full card each (the same cut as the photo). */
export const SMALL_CARDS_FROM = PHOTO_ONCE_FROM;
/** More crops than this on the all-crops card: `ALL_CROPS_PHOTOS_WHEN_MANY` photos and a "+N पिकं" tile. */
export const ALL_CROPS_PHOTOS_MAX = 8;
export const ALL_CROPS_PHOTOS_WHEN_MANY = 7;

export type PlotPickMode = 'chips' | 'grid';

/** How the plots of one crop are drawn for a picker: chips up to 6, a number grid from 7. */
export const plotPickMode = (plotCount: number): PlotPickMode => (plotCount >= PLOT_GRID_FROM ? 'grid' : 'chips');
/** Whether the number grid carries a search box. */
export const hasPlotSearch = (plotCount: number): boolean => plotCount >= PLOT_SEARCH_FROM;
/** Whether the crop's photo is shown once in a header (and not on every plot). */
export const photoOnceFor = (plotCount: number): boolean => plotCount >= PHOTO_ONCE_FROM;
/** Whether a crop's plot cards are two small cards across. */
export const smallPlotCardsFor = (plotCount: number): boolean => plotCount >= SMALL_CARDS_FROM;

/** How many crop photos the all-crops card draws, and how many crops the "+N पिकं" tile stands for. */
export const allCropsPhotoSlots = (cropCount: number): { shown: number; more: number } =>
    cropCount > ALL_CROPS_PHOTOS_MAX ? { shown: ALL_CROPS_PHOTOS_WHEN_MANY, more: cropCount - ALL_CROPS_PHOTOS_WHEN_MANY } : { shown: cropCount, more: 0 };

/** Columns of the all-crops card's photos: as many as crops up to four; five to eight crops make two rows of four. */
export const allCropsColumns = (shownPhotos: number, hasMoreTile: boolean): number => Math.min(4, Math.max(2, shownPhotos + (hasMoreTile ? 1 : 0)));

// ── names and numbers ────────────────────────────────────────────────────────────────────────────────

const DEVANAGARI_ZERO = 0x0966;

/** Devanagari digits (०-९) to Latin (0-9), so a search for "७" and for "7" are the same search. Anything else is untouched. */
export const toLatinDigits = (text: string): string =>
    text.replace(/[०-९]/g, ch => String(ch.charCodeAt(0) - DEVANAGARI_ZERO));

const SEPARATOR = /^[\s\-–—·.:_/]+/;

/**
 * The plot's name inside its crop's group: "द्राक्ष G7" becomes "G7" (the header already says द्राक्ष). DISPLAY ONLY - the stored name never
 * changes. Only a leading crop word followed by a separator is removed, and only when something is left; any other name, and a name that
 * is nothing but the crop word, comes back as it is. `cropNames` are the crop's names as the farmer may see them in any language.
 */
export function plotShortName(plotName: string, cropNames: readonly (string | undefined)[]): string {
    const name = plotName.trim();
    const lower = name.toLowerCase();
    for (const raw of cropNames) {
        const crop = raw?.trim();
        if (!crop) continue;
        if (!lower.startsWith(crop.toLowerCase())) continue;
        const rest = name.slice(crop.length);
        if (!SEPARATOR.test(rest)) continue;
        const left = rest.replace(SEPARATOR, '').trim();
        if (left) return left;
    }
    return name;
}

/** The plot's place in its crop as the farmer reads it (1 for the first plot): the same number the calendar prints. */
export const plotPosition = (index: number): number => index + 1;

// ── natural number order (CTO ruling 2026-11-20: G2 before G10 everywhere plots are listed) ──────────

const digitRuns = (name: string): string[] => toLatinDigits(name).toLowerCase().match(/\d+|\D+/g) ?? [];
const hasDigit = (name: string): boolean => /[0-9०-९]/.test(name);

/**
 * Two plot names in natural number order: "G2" before "G10", a Devanagari digit the same as a Latin one ("ऊस २" before "ऊस १०"). A name with
 * a digit comes before a name with none; two names with no digit compare equal (the caller keeps their order). Display order only.
 */
export function compareNaturally(a: string, b: string): number {
    const da = hasDigit(a);
    const db = hasDigit(b);
    if (da !== db) return da ? -1 : 1;
    if (!da) return 0;
    const ta = digitRuns(a);
    const tb = digitRuns(b);
    for (let i = 0; i < Math.min(ta.length, tb.length); i++) {
        const x = ta[i];
        const y = tb[i];
        const nx = /^[0-9]/.test(x);
        const ny = /^[0-9]/.test(y);
        if (nx && ny) {
            const d = Number(x) - Number(y);
            if (d !== 0) return d < 0 ? -1 : 1;
        } else if (nx !== ny) {
            return nx ? -1 : 1;
        } else if (x !== y) {
            return x < y ? -1 : 1;
        }
    }
    return ta.length === tb.length ? 0 : ta.length < tb.length ? -1 : 1;
}

/** The positions of `names` in natural number order; ties (and names without a digit) keep their original order. */
export const naturalOrder = (names: readonly string[]): number[] =>
    names.map((_, i) => i).sort((i, j) => compareNaturally(names[i], names[j]) || i - j);

/** The items in natural order of their plot names, stable: the one sort every list of plots uses. A new array; the input is not touched. */
export const sortedNaturally = <T>(items: readonly T[], nameOf: (item: T) => string): T[] =>
    naturalOrder(items.map(nameOf)).map(i => items[i]);

/**
 * Does this plot answer the search? A search of only digits matches the plot's place number, or a whole run of digits in its name
 * ("G7" for "7", never "G17"); any other search matches the name. Devanagari and Latin digits are the same. An empty search matches all.
 */
export function plotMatchesQuery(plot: { name: string; position: number }, query: string): boolean {
    const q = toLatinDigits(query).trim().toLowerCase();
    if (!q) return true;
    const name = toLatinDigits(plot.name).toLowerCase();
    if (/^\d+$/.test(q)) {
        const runs: string[] = name.match(/\d+/g) ?? [];
        return String(plot.position) === q || runs.includes(q);
    }
    return name.includes(q);
}

// ── true facts for the quick buttons ─────────────────────────────────────────────────────────────────

/**
 * The plots that have work recorded on a day: the plots named by the day's records that are not deleted. These are the same records the
 * आढावा plot cards count, so a button's number and a card never disagree.
 */
export function plotIdsWithWorkOn(logs: readonly Pick<DailyLog, 'date' | 'deletion' | 'context'>[], dateKey: string): Set<string> {
    const ids = new Set<string>();
    for (const log of logs) {
        if (log?.date !== dateKey || log.deletion) continue;
        for (const s of log.context?.selection ?? []) for (const id of s.selectedPlotIds ?? []) ids.add(id);
    }
    return ids;
}

/** What the phone knows about work on two days; `null` where it could not be read (then no button that needs it is drawn). */
export interface PlotWorkFacts {
    yesterday: ReadonlySet<string> | null;
    today: ReadonlySet<string> | null;
}

export type QuickKind = 'yesterday' | 'todayLeft' | 'toldToday';

export interface QuickButton {
    id: string;
    label: string;
    /** The plots this button chooses (never empty: a button with none is not built). */
    plotIds: string[];
}

export const QUICK_WORDS = {
    mr: { all: 'सगळे निवडा', allDone: 'सगळे निवडले', yesterday: 'कालचेच', todayLeft: 'आज बाकी', toldToday: 'आज सांगितलेले' },
    en: { all: 'Select all', allDone: 'All selected', yesterday: 'Same as yesterday', todayLeft: 'Left for today', toldToday: 'Told today' },
} as const;

/** "आज बाकी ६" - a quick button's label with its real count, in the language's digits. */
export const quickLabel = (word: string, count: number, language: string | null | undefined): string => `${word} ${digitsFor(count, language)}`;

/**
 * The true quick buttons for one set of plots, in the order they are drawn: "कालचेच" (work recorded yesterday), "आज बाकी" (nothing
 * recorded today). Only the kinds asked for in `kinds`; a kind whose facts are unknown, or whose count is zero, is left out.
 */
export function buildQuickButtons(opts: {
    plotIds: readonly string[];
    facts: PlotWorkFacts | null | undefined;
    kinds: readonly QuickKind[];
    language?: string | null;
}): QuickButton[] {
    const { plotIds, facts, kinds, language } = opts;
    const w = QUICK_WORDS[language === 'en' ? 'en' : 'mr'];
    const out: QuickButton[] = [];
    const add = (id: QuickKind, word: string, ids: string[]) => {
        if (ids.length > 0) out.push({ id, label: quickLabel(word, ids.length, language), plotIds: ids });
    };
    for (const kind of kinds) {
        if (!facts) continue;
        if (kind === 'yesterday' && facts.yesterday) add(kind, w.yesterday, plotIds.filter(id => facts.yesterday!.has(id)));
        if (kind === 'toldToday' && facts.today) add(kind, w.toldToday, plotIds.filter(id => facts.today!.has(id)));
        if (kind === 'todayLeft' && facts.today) add(kind, w.todayLeft, plotIds.filter(id => !facts.today!.has(id)));
    }
    return out;
}

// ── choosing ─────────────────────────────────────────────────────────────────────────────────────────

/** Add the plot, or take it off; a new one goes last (the order the farmer tapped them in). */
export const toggleId = (chosen: readonly string[], id: string): string[] =>
    chosen.includes(id) ? chosen.filter(x => x !== id) : [...chosen, id];

export const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every(x => b.includes(x));

/** Every one of these plots is chosen (and there is at least one). */
export const allChosen = (plotIds: readonly string[], chosen: readonly string[]): boolean => plotIds.length > 0 && plotIds.every(id => chosen.includes(id));

/** The plots the "सगळे" toggle leaves chosen: all of them, or - when all were chosen and clearing is allowed - none. */
export const afterAllToggle = (plotIds: readonly string[], chosen: readonly string[], canClear: boolean): string[] =>
    allChosen(plotIds, chosen) ? (canClear ? [] : [...plotIds]) : [...plotIds];

// ── the words and the count line ─────────────────────────────────────────────────────────────────────

export const SELECTOR_WORDS = {
    mr: { search: 'प्लॉट शोधा: नाव किंवा नंबर', noMatch: 'असा प्लॉट सापडला नाही', showAll: 'सगळे दाखवा', seeAll: 'सगळी बघा', plotWord: 'प्लॉट', cropsWord: 'पिकं', moreCrops: 'पिकं' },
    en: { search: 'Find a plot: name or number', noMatch: 'No such plot', showAll: 'Show all', seeAll: 'See all', plotWord: 'plots', cropsWord: 'crops', moreCrops: 'crops' },
} as const;

/** "१५ पैकी ४ निवडले": of the total, how many are chosen. One sentence, always the same words. */
export const pickedCountText = (total: number, picked: number, language: string | null | undefined): string =>
    language === 'en' ? `${picked} of ${total} chosen` : `${digitsFor(total, language)} पैकी ${digitsFor(picked, language)} निवडले`;

/** "फक्त G7 दिसतो": what the आढावा page shows after one tap. */
export const onlyShownText = (name: string, language: string | null | undefined): string =>
    language === 'en' ? `Only ${name} is shown` : `फक्त ${name} दिसतो`;

/** "२ पिकं · १८ प्लॉट": the all-crops card's one line. */
export const allCropsLine = (crops: number, plots: number, language: string | null | undefined): string => {
    const w = SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'];
    return `${digitsFor(crops, language)} ${w.cropsWord} · ${digitsFor(plots, language)} ${w.plotWord}`;
};

/** "+३ पिकं": the tile for the crops that did not fit among the photos. */
export const moreCropsText = (n: number, language: string | null | undefined): string => `+${digitsFor(n, language)} ${SELECTOR_WORDS[language === 'en' ? 'en' : 'mr'].moreCrops}`;
