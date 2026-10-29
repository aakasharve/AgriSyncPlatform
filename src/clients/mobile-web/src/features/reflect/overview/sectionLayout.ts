/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-4) — which आढावा sections start open, which
 * are remembered, and in what order. Pure.
 *
 * Founder D-4 (26 Oct): "Treat remembered folds and section order as existing functionality. Do not silently
 * remove them during the redesign." LIVE remembers each fold (`collapsible-<id>`) and the block order
 * (`reflect-block-order`); the redesign had dropped both. They come back, and a farmer upgrading from LIVE keeps
 * the choices he made there (P11): his LIVE fold of notes / today's plot work and his LIVE order of the two are
 * read when he has made no choice in the new page yet.
 *
 * The three versions the founder asked to compare at phone size (D-4; defined in
 * `ALIGN-PLANNING-ATTENTION-2026-10-27.md` §5.3 step 4), same farm data:
 *   V1 — all open, nothing remembered (the TEST build before this change);
 *   V2 — the founder's preferred start: शेताची स्थिती, करायची कामे, प्लॉटनिहाय काम open; notes, calendar and
 *        money folded (their headers keep a count / a line); folds and order remembered. THE DEFAULT, and the
 *        only version a release build ever runs;
 *   V3 — LIVE's way: remembered folds and order, everything open at first except the calendar and the money,
 *        which open one at a time (opening one folds the other), as LIVE's two accordions did.
 * शेताची स्थिती stays first in every version: it picks the crop and plot every section below reads (LIVE kept
 * its farm status fixed on top too). Folding is not permission (D-4): a folded section is still the same
 * section; nothing here shows or hides anything a role may not see.
 */

export type SectionId = 'status' | 'todo' | 'day' | 'notes' | 'calendar' | 'cost';
export type LayoutVersion = 'v1' | 'v2' | 'v3';

export const LAYOUT_VERSIONS: readonly LayoutVersion[] = ['v1', 'v2', 'v3'];
export const DEFAULT_LAYOUT: LayoutVersion = 'v2';

/** Always first, never moved. */
export const FIXED_FIRST: SectionId = 'status';
/** The sections that can be moved, in their first-use order. */
export const DEFAULT_ORDER: readonly SectionId[] = ['todo', 'day', 'notes', 'calendar', 'cost'];

const MOVABLE = new Set<SectionId>(DEFAULT_ORDER);

/** Opened together in V3, one at a time (LIVE's calendar / money accordions). */
export const ONE_AT_A_TIME: readonly SectionId[] = ['calendar', 'cost'];

const V2_FIRST_OPEN = new Set<SectionId>(['status', 'todo', 'day']);

export function firstOpen(version: LayoutVersion, id: SectionId): boolean {
    if (version === 'v1') return true;
    if (version === 'v2') return V2_FIRST_OPEN.has(id);
    return !ONE_AT_A_TIME.includes(id);
}

export const remembers = (version: LayoutVersion): boolean => version !== 'v1';

/** The uiPrefs keys a version keeps its choices under. V2 (the real one) owns the plain keys. */
export function prefKeys(version: LayoutVersion): { folds: string; order: string } {
    return version === 'v3'
        ? { folds: 'reflect-v3-folds', order: 'reflect-v3-section-order' }
        : { folds: 'reflect-folds', order: 'reflect-section-order' };
}

/** LIVE's own keys (`CollapsibleBlock.tsx`, `ReflectPage.tsx` at b3d28967), read only when nothing new is stored. */
export const LEGACY_FOLD_KEYS: Partial<Record<SectionId, string>> = {
    notes: 'collapsible-notes',
    day: 'collapsible-daily-logs',
};
export const LEGACY_ORDER_KEY = 'reflect-block-order';

export type FoldMap = Partial<Record<SectionId, boolean>>;

export function foldsOf(value: unknown): FoldMap {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: FoldMap = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === 'boolean' && (k === FIXED_FIRST || MOVABLE.has(k as SectionId))) out[k as SectionId] = v;
    }
    return out;
}

/** A stored order made whole: known ids once each, any missing id appended in first-use order. `null` if unusable. */
export function orderOf(value: unknown): SectionId[] | null {
    if (!Array.isArray(value)) return null;
    const seen = new Set<SectionId>();
    for (const v of value) if (typeof v === 'string' && MOVABLE.has(v as SectionId)) seen.add(v as SectionId);
    if (seen.size === 0) return null;
    return [...seen, ...DEFAULT_ORDER.filter(id => !seen.has(id))];
}

/**
 * LIVE's order (`['farm-status', 'notes', 'daily-logs']`, any order of the last two) in the new sections: the
 * only choice it could hold is whether notes came before the day's plot work.
 */
export function orderFromLegacy(value: unknown): SectionId[] | null {
    if (!Array.isArray(value)) return null;
    const notes = value.indexOf('notes');
    const day = value.indexOf('daily-logs');
    if (notes < 0 || day < 0 || notes > day) return null;
    return ['todo', 'notes', 'day', 'calendar', 'cost'];
}

/** Is the section open: his choice here, else his LIVE choice, else the version's first-use state. */
export function isOpen(version: LayoutVersion, id: SectionId, folds: FoldMap, legacy: FoldMap): boolean {
    if (!remembers(version)) return folds[id] ?? true;
    return folds[id] ?? (version === DEFAULT_LAYOUT ? legacy[id] : undefined) ?? firstOpen(version, id);
}

/** The folds after a tap on one section's header (V3 folds the other one-at-a-time section when one opens). */
export function toggled(version: LayoutVersion, id: SectionId, folds: FoldMap, legacy: FoldMap): FoldMap {
    const nowOpen = !isOpen(version, id, folds, legacy);
    const next: FoldMap = { ...folds, [id]: nowOpen };
    if (version === 'v3' && nowOpen && ONE_AT_A_TIME.includes(id)) {
        for (const other of ONE_AT_A_TIME) if (other !== id) next[other] = false;
    }
    return next;
}

/** Move one section up (-1) or down (+1); anything else (or the edge) leaves the order as it is. */
export function moved(order: readonly SectionId[], id: SectionId, step: -1 | 1): SectionId[] {
    const i = order.indexOf(id);
    const j = i + step;
    if (i < 0 || j < 0 || j >= order.length) return [...order];
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
}
