/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b Task 6; founder D-132 Q4 = 1 with note, D-134) - "बदलांची यादी".
 *
 * A CHANGE LIST under each own schedule: one line per change - what, when (`madeAtUtc` of that version), who (`madeByUserId` -> a name) - NOT old
 * versions to open. Worked out ON THE PHONE from the versions the pull carries: every save is a new row and the pull returns every version row
 * (SCH-OWN-a ruling; no new route). Pure: no React, no Dexie.
 *
 * Rules:
 *   - the FIRST version says how it began: with works it can only have been copied from a checked schedule (a blank start stores none), without, it was
 *     built from blank. A version whose previous row the phone does not hold gives NO line (we cannot know what changed; nothing is made up);
 *   - a later version gives one line per change: the schedule renamed, a made-for tag set / changed / removed, a stage added / changed / removed, a
 *     work added / changed / removed. Works are matched by their NAME, stages by theirs. A save that changed nothing gives no line;
 *   - a person the phone has no name for gives no name - never an id.
 * Words are PROPOSED (the v3 page's own examples: "सिंचन जोडलं — दिवस 10–40", "फवारणी काढली"). Verb agreement is a v3 "to be confirmed": the page's
 * own rough rule is kept (a work whose name ends in ी takes the feminine verb), marked PROPOSED.
 */
import type { MadeForKey, OwnChain, OwnStage, OwnWork, ScheduleBody } from './ownScheduleModel';
import { MADE_FOR_KEYS } from './ownScheduleModel';
import { tagLabel } from './madeFor';

export type ChangeLanguage = 'mr' | 'en';

export type ChangeItem =
    | { kind: 'built' }
    | { kind: 'copied' }
    | { kind: 'renamed'; name: string }
    | { kind: 'madeFor'; field: MadeForKey; value: string | null }
    | { kind: 'stageAdded' | 'stageChanged'; stage: OwnStage }
    | { kind: 'stageRemoved'; name: string }
    | { kind: 'workAdded' | 'workChanged'; work: OwnWork; frequencyChanged: boolean }
    | { kind: 'workRemoved'; name: string };

const key = (name: string): string => name.trim().toLowerCase();

/** Pairs the items of two lists by name (the n-th "ठिबक" with the n-th "ठिबक"). */
function pairByName<T extends { name: string }>(before: readonly T[], after: readonly T[]) {
    const pool = new Map<string, T[]>();
    for (const item of before) pool.set(key(item.name), [...(pool.get(key(item.name)) ?? []), item]);
    const pairs: Array<{ before: T | null; after: T }> = [];
    for (const item of after) {
        const list = pool.get(key(item.name));
        pairs.push({ before: list && list.length > 0 ? list.shift() ?? null : null, after: item });
    }
    const removed = [...pool.values()].flat();
    return { pairs, removed };
}

const sameWork = (a: OwnWork, b: OwnWork): boolean =>
    a.part === b.part && a.startDay === b.startDay && a.endDay === b.endDay && a.mode === b.mode && a.intervalDays === b.intervalDays;

/** What changed from one version's body to the next, in kinds (words come after). */
export function diffVersions(previous: ScheduleBody, current: ScheduleBody): ChangeItem[] {
    const out: ChangeItem[] = [];
    if (key(previous.name) !== key(current.name)) out.push({ kind: 'renamed', name: current.name });
    for (const field of MADE_FOR_KEYS) {
        const before = previous.madeFor[field] ?? null;
        const after = current.madeFor[field] ?? null;
        if (before !== after) out.push({ kind: 'madeFor', field, value: after });
    }
    const stages = pairByName(previous.stages, current.stages);
    for (const pair of stages.pairs) {
        if (!pair.before) out.push({ kind: 'stageAdded', stage: pair.after });
        else if (pair.before.startDay !== pair.after.startDay || pair.before.endDay !== pair.after.endDay) out.push({ kind: 'stageChanged', stage: pair.after });
    }
    for (const gone of stages.removed) out.push({ kind: 'stageRemoved', name: gone.name });
    const works = pairByName(previous.works, current.works);
    for (const pair of works.pairs) {
        if (!pair.before) out.push({ kind: 'workAdded', work: pair.after, frequencyChanged: true });
        else if (!sameWork(pair.before, pair.after)) {
            out.push({ kind: 'workChanged', work: pair.after, frequencyChanged: pair.before.mode !== pair.after.mode || pair.before.intervalDays !== pair.after.intervalDays });
        }
    }
    for (const gone of works.removed) out.push({ kind: 'workRemoved', name: gone.name });
    return out;
}

// ---- words -----------------------------------------------------------------------------------------------------------------------------------

/** "ठिबक सिंचन (0:52:34)" -> "ठिबक सिंचन": the name without a trailing bracket, for the agreement guess. */
const baseName = (name: string): string => name.replace(/\s*\([^)]*\)\s*$/, '').trim();
/** PROPOSED (Marathi): the v3 page's rough agreement rule - a work whose name ends in ी takes the feminine verb (फवारणी काढली, सिंचन काढलं). */
const feminine = (name: string): boolean => /ी$/.test(baseName(name));

const SHORT: Readonly<Record<ChangeLanguage, Readonly<Record<MadeForKey, string>>>> = {
    mr: { variety: 'वाण', soilType: 'माती', region: 'प्रदेश', climate: 'हवामान' }, // the app's own words (varietyCatalog's "वाण", the v3 page's short labels)
    en: { variety: 'variety', soilType: 'soil', region: 'region', climate: 'climate' }, // PROPOSED (English)
};

export const daysText = (from: number, to: number, language: ChangeLanguage): string =>
    language === 'mr' ? (from === to ? `दिवस ${from}` : `दिवस ${from}–${to}`) : (from === to ? `day ${from}` : `days ${from}–${to}`);

export const frequencyText = (mode: OwnWork['mode'], n: number, language: ChangeLanguage): string => {
    if (language === 'mr') return mode === 'one_time' ? 'एकदाच' : mode === 'every_n_days' ? `दर ${n} दिवसांनी` : `आठवड्यातून ${n} वेळा`;
    return mode === 'one_time' ? 'once' : mode === 'every_n_days' ? `every ${n} days` : `${n} times a week`;
};

const workTail = (work: OwnWork, withFrequency: boolean, language: ChangeLanguage): string =>
    ` — ${daysText(work.startDay, work.endDay, language)}${withFrequency && work.mode !== 'one_time' ? ` · ${frequencyText(work.mode, work.intervalDays, language)}` : ''}`;

/** The line for one change. */
export function changeText(item: ChangeItem, language: ChangeLanguage): string {
    const mr = language === 'mr';
    switch (item.kind) {
        case 'built': return mr ? 'शेड्यूल बनवलं' : 'Schedule made'; // PROPOSED (v3 page: chgBuilt)
        case 'copied': return mr ? 'तपासलेल्या शेड्यूलवरून बनवलं' : 'Made from a checked schedule'; // PROPOSED (v3 page: chgCopied)
        case 'renamed': return mr ? `नाव बदललं: ${item.name}` : `Renamed: ${item.name}`; // PROPOSED
        case 'madeFor': {
            const label = SHORT[language][item.field];
            if (item.value === null) return mr ? `यासाठी बनवलं: ${label} काढलं` : `Made for: ${label} removed`; // PROPOSED (v3 page: mfDel)
            return `${mr ? 'यासाठी बनवलं' : 'Made for'}: ${label} ${tagLabel(item.field, item.value, language)}`; // PROPOSED (v3 page: mfSet)
        }
        case 'stageAdded': return `${mr ? 'स्टेज जोडली' : 'Stage added'} — ${item.stage.name} · ${daysText(item.stage.startDay, item.stage.endDay, language)}`; // PROPOSED
        case 'stageChanged': return `${mr ? 'स्टेज बदलली' : 'Stage changed'} — ${item.stage.name} · ${daysText(item.stage.startDay, item.stage.endDay, language)}`; // PROPOSED
        case 'stageRemoved': return `${mr ? 'स्टेज काढली' : 'Stage removed'} — ${item.name}`; // PROPOSED
        case 'workAdded': return mr
            ? `${item.work.name} ${feminine(item.work.name) ? 'जोडली' : 'जोडलं'}${workTail(item.work, true, language)}` // PROPOSED (v3 page: chgAdd)
            : `${item.work.name} added${workTail(item.work, true, language)}`; // PROPOSED (English)
        case 'workChanged': return mr
            ? `${item.work.name} ${feminine(item.work.name) ? 'बदलली' : 'बदललं'}${workTail(item.work, item.frequencyChanged, language)}` // PROPOSED (v3 page: chgEdit)
            : `${item.work.name} changed${workTail(item.work, item.frequencyChanged, language)}`; // PROPOSED (English)
        case 'workRemoved': return mr
            ? `${item.name} ${feminine(item.name) ? 'काढली' : 'काढलं'}` // PROPOSED (v3 page: chgDel)
            : `${item.name} removed`; // PROPOSED (English)
    }
}

/** "7 नोव्हें" / "7 Nov" - the day and the short month, in India's day. An unreadable date is left out, never guessed. */
export function shortDateLabel(iso: string | null | undefined, language: ChangeLanguage): string | null {
    if (!iso) return null;
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) return null;
    try {
        return new Intl.DateTimeFormat(language === 'mr' ? 'mr-IN-u-nu-latn' : 'en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(at);
    } catch {
        return at.toISOString().slice(5, 10);
    }
}

export interface ChangeEntry {
    versionId: string;
    version: number;
    text: string;
    dateLabel: string | null;
    byName: string | null;
    /** True on the first line of a version: it also says "आवृत्ती n". */
    showVersion: boolean;
}

/** The whole change list of one schedule, newest version first. `nameOf` gives a person's name or null (never an id). */
export function changeEntries(chain: OwnChain, options: { nameOf: (userId: string | null) => string | null; language: ChangeLanguage }): ChangeEntry[] {
    const { nameOf, language } = options;
    const groups: ChangeEntry[][] = [];
    chain.versions.forEach((version, index) => {
        let items: ChangeItem[];
        if (index === 0) {
            if (chain.missingBefore) return;
            items = [{ kind: version.works.length > 0 ? 'copied' : 'built' }];
        } else {
            items = diffVersions(chain.versions[index - 1], version);
        }
        const dateLabel = shortDateLabel(version.madeAtUtc, language);
        const byName = version.madeByUserId ? nameOf(version.madeByUserId) : null;
        groups.push(items.map((item, i) => ({
            versionId: version.id, version: version.version ?? index + 1, text: changeText(item, language), dateLabel, byName, showVersion: i === 0,
        })));
    });
    // Newest version first; inside a version the lines keep the order they are worked out in.
    return groups.reverse().flat();
}
