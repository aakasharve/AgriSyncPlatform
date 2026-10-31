/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-61 = 5A + rule TAP-1, 2026-10-31: "voice is
 * always the first choice; typing and tapping are always there as the fallback") — "किंवा दाबून बदला" on the बदला screen.
 * Pure.
 *
 * ONE WORKING COPY of the entry. A spoken (or typed) change is merged into it by the existing rule (`mergeCorrection`, a
 * bucket he spoke of replaces that bucket), and every tap changes it too, so speaking and tapping add up in any order.
 * "जतन करा" sends the difference between the entry and the copy — the same new content version the spoken change sent
 * (`revise_log_content`, queued, so it works with no internet; P3: the server keeps every version, P10).
 *
 * What a tap can change (the working phones' 5A screen):
 *   - the KIND of crop work (the app's own work names: {title: 'फवारणी', workTypes: ['Spraying']}, as the parser writes);
 *   - a product's name, amount and unit;
 *   - water's method and hours;
 *   - a worker COUNT (only of an engagement the server knows: it goes as a labour correction, which needs the internet
 *     until the queued route exists — `correctionCapabilities.ts`);
 *   - "काढा" / "परत आणा" any part except workers (removing an engagement has no route to the server: it would be undone by
 *     the next pull, P10 — so it is not offered); at least ONE part always stays;
 *   - "+ आणखी जोडा": crop work, water, or a product (not workers, for the same reason).
 * Nothing here invents a number: a value he did not state shows "—" (P4).
 */
import type { CropActivityEvent, DailyLog, InputEvent, IrrigationEvent, LabourEvent } from '../../../../types';
import type { IdGenerator } from '../../../../core/domain/services/IdGenerator';
import { workTypeNameIn } from '../../../../shared/names/namesIn';
import { plannedOnce, type PartKey } from '../voiceResult/resultModel';

/** The buckets a row can stand for, in the screen's order. */
export const TAP_BUCKETS = ['cropActivities', 'labour', 'irrigation', 'inputs', 'activityExpenses', 'machinery', 'observations', 'plannedTasks'] as const;
export type TapBucket = typeof TAP_BUCKETS[number];

const PART_OF: Record<TapBucket, PartKey> = {
    cropActivities: 'crop', labour: 'labour', irrigation: 'irrigation', inputs: 'inputs',
    activityExpenses: 'expense', machinery: 'machinery', observations: 'observation', plannedTasks: 'planned',
};

/** The kinds "+ आणखी जोडा" offers. */
export type AddKind = 'cropActivities' | 'irrigation' | 'inputs';
export const ADD_KINDS: readonly AddKind[] = ['cropActivities', 'irrigation', 'inputs'];

/** The work names a tap can choose (the app's own list: Marathi shown, English stored beside it). */
export const WORK_CHOICES: ReadonlyArray<readonly [string, string]> = [
    ['Spraying', 'फवारणी'], ['Weeding', 'खुरपणी'], ['Pruning', 'छाटणी'], ['Tying', 'बांधणी'], ['Harvesting', 'काढणी'],
    ['Fertilizer application', 'खत देणे'], ['Tillage', 'नांगरणी'], ['Leaf removal', 'पाने काढणे'], ['Inspection', 'पाहणी'], ['Other', 'इतर'],
];
/** Water methods (stored as the app stores them). */
export const WATER_METHODS = ['Drip', 'Flood', 'Sprinkler'] as const;
export const UNIT_CHOICES = ['ml', 'L', 'g', 'kg'] as const;

const WORDS = {
    mr: {
        Drip: 'ठिबक', Flood: 'पाट', Sprinkler: 'तुषार', hours: 'तास', people: 'जण',
        ml: 'मिली', L: 'लिटर', g: 'ग्रॅम', kg: 'किलो',
    },
    en: {
        Drip: 'Drip', Flood: 'Flood', Sprinkler: 'Sprinkler', hours: 'hours', people: 'people',
        ml: 'ml', L: 'litres', g: 'g', kg: 'kg',
    },
} as const;
// PROPOSED (Marathi) / PROPOSED (English) — every word above; "ठिबक / पाट / तुषार" are the working phones' own.
const wordsIn = (language: string | null | undefined) => (language === 'en' ? WORDS.en : WORDS.mr);

export const methodName = (m: string | undefined, language: string | null | undefined): string => {
    const w = wordsIn(language) as Record<string, string>;
    if (!m) return '';
    const key = m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(); // stored as 'Drip' or 'drip'
    return w[key] ?? m;
};
export const unitName = (u: string | undefined, language: string | null | undefined): string => {
    const w = wordsIn(language) as Record<string, string>;
    if (!u) return '';
    const key = u === 'l' || u.toLowerCase() === 'litres' || u.toLowerCase() === 'liters' ? 'L' : u;
    return w[key] ?? u;
};

const positive = (n: number | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const join = (...xs: Array<string | undefined>): string => xs.filter(x => !!x && x.trim()).join(' · ');
const DASH = '—';

/** A product's editable face: the first item of its mix, else the legacy fields. */
export interface ProductFace { name: string; qty?: number; unit?: string }
export function productFace(e: InputEvent): ProductFace {
    const first = e.mix?.[0];
    return first
        ? { name: first.productName ?? '', qty: first.dose, unit: first.unit }
        : { name: e.productName ?? '', qty: e.quantity, unit: e.unit };
}

/** The words of one item on this screen, in this language ("—" for what was not stated). */
export function itemText(bucket: TapBucket, item: unknown, language: string | null | undefined): string {
    const w = wordsIn(language);
    switch (bucket) {
        case 'cropActivities': {
            const a = item as CropActivityEvent;
            return workTypeNameIn(a.title, language === 'en' ? 'en' : 'mr') || a.title || DASH;
        }
        case 'inputs': {
            const f = productFace(item as InputEvent);
            const amount = positive(f.qty) ? `${f.qty} ${unitName(f.unit, language)}`.trim() : '';
            return join(f.name || DASH, amount) || DASH;
        }
        case 'irrigation': {
            const e = item as IrrigationEvent;
            return join(methodName(e.method, language), positive(e.durationHours) ? `${e.durationHours} ${w.hours}` : '') || DASH;
        }
        case 'labour': {
            const e = item as LabourEvent;
            return positive(e.count) ? `${e.count} ${w.people}` : DASH;
        }
        case 'activityExpenses': {
            const e = item as { reason?: string; totalAmount?: number };
            return join(e.reason, positive(e.totalAmount) ? `₹${e.totalAmount}` : '') || DASH;
        }
        case 'machinery': {
            const e = item as { type?: string; hoursUsed?: number };
            return join(e.type, positive(e.hoursUsed) ? `${e.hoursUsed} ${w.hours}` : '') || DASH;
        }
        case 'observations':
            return (item as { textRaw?: string }).textRaw?.trim() || DASH;
        case 'plannedTasks':
            return (item as { title?: string }).title?.trim() || DASH;
        default:
            return DASH;
    }
}

type Item = { id?: string };
const itemsOf = (log: DailyLog, bucket: TapBucket): Item[] => ((log[bucket] as Item[] | undefined) ?? []);
/**
 * Is this item a row of its own? Water actually given is a part (a spray's tank water is not). A stoppage note is not a
 * part. Planned work and its reminders are shown ONCE, by the result screen's own rule (`plannedOnce`, fix 1 M6).
 */
const rowFilter = (log: DailyLog) => {
    const once = plannedOnce(log);
    const notes = new Set(once.observations.map(o => o.id));
    const tasks = new Set(once.tasks.map(t => t.id));
    return (bucket: TapBucket, item: Item): boolean => {
        if (bucket === 'irrigation') return (item as IrrigationEvent).role !== 'spray-carrier';
        if (bucket === 'observations') return (item as { noteType?: string }).noteType !== 'issue' && notes.has(item.id as string);
        if (bucket === 'plannedTasks') return tasks.has(item.id as string);
        return true;
    };
};

/** What goes and comes back WITH this row (lane OF fix 1, M6): a planned task's reminders, a reminder's own task. */
export function partnersOf(working: DailyLog, id: string): string[] {
    return plannedOnce(working).partnersOf(id);
}

export interface TapRow {
    bucket: TapBucket;
    part: PartKey;
    id: string;
    text: string;
    /** The value before, when this item was changed (struck through on screen). */
    was?: string;
    removed: boolean;
    /** A saved part his words replaced or dropped: shown struck through, nothing to tap (his words did it). */
    gone?: boolean;
    isNew: boolean;
    /** Its value can be tapped (crop work, product, water, a worker count of a known engagement). */
    editable: boolean;
    /** It may be removed ("काढा"). */
    removable: boolean;
}

/**
 * Every row of the working copy, in the screen's order, each against the entry as it is saved. A part his words replaced
 * (a spoken change replaces the whole bucket, with new items) is paired with the saved part in the same place, so it
 * reads "बदललं" with its old value struck through; a saved part his words left out is shown struck through (`gone`).
 */
export function tapRows(original: DailyLog, working: DailyLog, removed: ReadonlySet<string>, language: string | null | undefined): TapRow[] {
    const rows: TapRow[] = [];
    const isRowBefore = rowFilter(original);
    const isRowNow = rowFilter(working);
    for (const bucket of TAP_BUCKETS) {
        const before = itemsOf(original, bucket).filter(i => i.id && isRowBefore(bucket, i));
        const now = itemsOf(working, bucket).filter(i => i.id && isRowNow(bucket, i));
        const nowIds = new Set(now.map(i => i.id));
        const beforeIds = new Set(before.map(i => i.id));
        const unmatched = before.filter(i => !nowIds.has(i.id));
        let pair = 0;
        now.forEach(item => {
            const same = beforeIds.has(item.id) ? before.find(b => b.id === item.id) : undefined;
            const was = same ?? unmatched[pair++];
            const text = itemText(bucket, item, language);
            const wasText = was ? itemText(bucket, was, language) : undefined;
            rows.push({
                bucket, part: PART_OF[bucket], id: item.id as string, text,
                ...(wasText !== undefined && wasText !== text && { was: wasText }),
                removed: removed.has(item.id as string),
                isNew: !was,
                editable: bucket === 'cropActivities' || bucket === 'inputs' || bucket === 'irrigation'
                    || (bucket === 'labour' && !!(item as LabourEvent).labourAssignmentId),
                removable: bucket !== 'labour',
            });
        });
        // A saved part his words left out: struck through, with "परत आणा" like a tapped removal (fix 1, L7).
        unmatched.slice(pair).forEach(item => rows.push({
            bucket, part: PART_OF[bucket], id: item.id as string, text: itemText(bucket, item, language),
            removed: true, gone: true, isNew: false, editable: false, removable: bucket !== 'labour',
        }));
    }
    return rows;
}

/** The entry as "जतन करा" would leave it: the working copy without what he removed. */
export function afterOf(working: DailyLog, removed: ReadonlySet<string>): DailyLog {
    if (removed.size === 0) return working;
    const out: DailyLog = { ...working };
    for (const bucket of TAP_BUCKETS) {
        const items = itemsOf(working, bucket);
        if (items.some(i => i.id && removed.has(i.id))) {
            (out as unknown as Record<string, unknown>)[bucket] = items.filter(i => !(i.id && removed.has(i.id)));
        }
    }
    return out;
}

/** May this row be removed now? Never the last part standing (the working phones: "एक तरी भाग राहू द्या"). */
export function canRemove(rows: readonly TapRow[], id: string): boolean {
    const row = rows.find(r => r.id === id);
    if (!row || !row.removable || row.removed) return false;
    return rows.filter(r => !r.removed && !r.gone).length > 1;
}

const stable = (v: unknown): string => JSON.stringify(v ?? null);

/** The buckets that differ between the entry and what would be saved (only these are sent). */
export function tapUpdates(original: DailyLog, after: DailyLog): Partial<DailyLog> {
    const updates: Partial<DailyLog> = {};
    for (const bucket of TAP_BUCKETS) {
        if (stable(original[bucket]) !== stable(after[bucket])) (updates as Record<string, unknown>)[bucket] = after[bucket] ?? [];
    }
    return updates;
}

/** Replace one item of the working copy (by id). */
export function withItem<T extends Item>(working: DailyLog, bucket: TapBucket, id: string, change: (item: T) => T): DailyLog {
    const items = itemsOf(working, bucket) as T[];
    return { ...working, [bucket]: items.map(i => (i.id === id ? change(i) : i)) } as DailyLog;
}

/** A new item of this kind, added to the working copy (its values come from the sheet he fills). */
export function newItem(kind: AddKind, idGen: IdGenerator): Item {
    const id = idGen.generate();
    // Lane OF fix 1 (L1): a new part starts with NOTHING chosen — he picks the work / the water himself.
    if (kind === 'cropActivities') return { id, title: '' } as CropActivityEvent;
    if (kind === 'irrigation') return { id } as IrrigationEvent;
    return { id, mix: [{ id: idGen.generate(), productName: '' }] } as unknown as InputEvent;
}

export function withNew(working: DailyLog, kind: AddKind, item: Item): DailyLog {
    return { ...working, [kind]: [...itemsOf(working, kind), item] } as DailyLog;
}

/** A saved part his words left out, brought back as it was saved (fix 1, L7). */
export function withRestored(working: DailyLog, original: DailyLog, id: string): DailyLog {
    const bucket = TAP_BUCKETS.find(b => itemsOf(original, b).some(i => i.id === id));
    const item = bucket ? itemsOf(original, bucket).find(i => i.id === id) : undefined;
    if (!bucket || !item || itemsOf(working, bucket).some(i => i.id === id)) return working;
    return { ...working, [bucket]: [...itemsOf(working, bucket), item] } as DailyLog;
}

export function withoutItem(working: DailyLog, bucket: TapBucket, id: string): DailyLog {
    return { ...working, [bucket]: itemsOf(working, bucket).filter(i => i.id !== id) } as DailyLog;
}

/** The crop work set to one of the app's work names (Marathi title, English work type — as the parser writes it). */
export const setWork = (a: CropActivityEvent, en: string, mr: string): CropActivityEvent => ({ ...a, title: mr, workTypes: [en] });

/**
 * Lane OF fix 1 (H2) — what he typed as an amount, read only when he presses ठीक: '' = no amount (undefined); a number
 * (Marathi digits read too, one decimal point) as a number; anything else `null` (refused, said plainly — never guessed).
 */
export function parseAmount(text: string): number | undefined | null {
    const t = text.trim().replace(/[०-९]/g, d => String('०१२३४५६७८९'.indexOf(d)));
    if (t === '') return undefined;
    if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
}

/** A product's name / amount / unit, on its first mix item (or the legacy fields when it has no mix). */
export function setProduct(e: InputEvent, face: ProductFace): InputEvent {
    const name = face.name.trim();
    if (e.mix && e.mix.length > 0) {
        const [first, ...rest] = e.mix;
        return {
            ...e,
            mix: [{ ...first, productName: name, ...(positive(face.qty) ? { dose: face.qty } : { dose: undefined }), ...(face.unit ? { unit: face.unit } : {}) }, ...rest],
            ...(e.productName !== undefined && { productName: name }),
        };
    }
    return { ...e, productName: name, ...(positive(face.qty) ? { quantity: face.qty } : { quantity: undefined }), ...(face.unit ? { unit: face.unit } : {}) };
}

export const setWater = (e: IrrigationEvent, method: string | undefined, hours: number | undefined): IrrigationEvent =>
    ({ ...e, ...(method ? { method } : {}), ...(positive(hours) ? { durationHours: hours } : {}) });

/** A worker count he tapped: the count only (never a sum of names, P7). */
export const setCount = (e: LabourEvent, count: number): LabourEvent => (positive(count) ? { ...e, count: Math.round(count) } : e);
