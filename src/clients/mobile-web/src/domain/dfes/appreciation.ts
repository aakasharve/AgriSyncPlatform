/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 5) - Sathi names each piece of work he logged.
 *
 * Built only from the saved record (P4): his work titles, his product names exactly as stored, the amounts, hours and counts he
 * said. Nothing is added that the record does not hold, and nothing he said is dropped. Work tagged `plannedOnly` (still to be
 * done, e.g. "खुरपणी पण करायची आहे") is NOT named as done: it goes to `plannedNames`. Spray tank water (`role: spray-carrier`) is
 * the spray's, not a separate watering, so it is not named twice. Marathi mode shows Marathi only: units and digits in Marathi;
 * a product name is his word and stays as stored.
 */
import type {
    ActivityExpenseEvent, CropActivityEvent, InputEvent, IrrigationEvent, LabourEvent, MachineryEvent,
} from '../types/log.types';
import { digitsFor } from '../../shared/utils/marathiDigits';
import { fillPattern, SATHI_PATTERNS } from './sathiPatterns';

export interface AppreciationRecord {
    cropActivities?: CropActivityEvent[];
    inputs?: InputEvent[];
    irrigation?: IrrigationEvent[];
    labour?: LabourEvent[];
    machinery?: MachineryEvent[];
    activityExpenses?: ActivityExpenseEvent[];
}

export type SathiLanguage = 'mr' | 'en';

export interface AppreciationItems {
    namedItems: string[];
    plannedNames: string[];
}

const GENERIC_TITLES = new Set(['Crop Activity', 'Log Entry', 'Field Work', 'Work Done']);

const UNIT_MR: Readonly<Record<string, string>> = {
    ml: 'मिली', l: 'लिटर', lt: 'लिटर', ltr: 'लिटर', litre: 'लिटर', liter: 'लिटर', kg: 'किलो', g: 'ग्रॅम', gm: 'ग्रॅम',
};

const MACHINE_MR: Readonly<Record<string, string>> = {
    tractor: 'ट्रॅक्टर', tiller: 'टिलर', harvester: 'हार्वेस्टर', drone: 'ड्रोन', sprayer: 'फवारणी यंत्र',
};

const unitIn = (unit: string | undefined, lang: SathiLanguage): string => {
    const u = (unit ?? '').trim();
    return lang === 'mr' ? UNIT_MR[u.toLowerCase()] ?? u : u;
};

const amount = (n: number | undefined, unit: string | undefined, lang: SathiLanguage): string =>
    n === undefined || n === null ? '' : `${digitsFor(n, lang)}${unit ? ` ${unitIn(unit, lang)}` : ''}`;

const join = (...parts: string[]): string => parts.map(p => p.trim()).filter(p => p.length > 0).join(' ');

function activityName(a: CropActivityEvent): string | null {
    const title = (a.title ?? '').trim();
    if (title && !GENERIC_TITLES.has(title)) return title;
    const type = (a.workTypes ?? []).find(t => t && !GENERIC_TITLES.has(t));
    return type?.trim() || null;
}

function inputNames(i: InputEvent, lang: SathiLanguage): string[] {
    const mix = (i.mix ?? []).filter(m => (m.productName ?? '').trim().length > 0);
    if (mix.length > 0) return mix.map(m => join(m.productName.trim(), amount(m.dose, m.unit, lang)));
    const name = (i.productName ?? '').trim();
    return name ? [join(name, amount(i.quantity, i.unit, lang))] : [];
}

function waterName(w: IrrigationEvent, lang: SathiLanguage): string | null {
    if (w.role === 'spray-carrier') return null;
    const water = lang === 'mr' ? 'पाणी' : 'water';
    if (w.durationHours !== undefined) return join(water, digitsFor(w.durationHours, lang), lang === 'mr' ? 'तास' : 'h');
    if (w.waterVolumeLitres !== undefined) return join(water, digitsFor(w.waterVolumeLitres, lang), lang === 'mr' ? 'लिटर' : 'L');
    return null;
}

function labourNames(l: LabourEvent, lang: SathiLanguage): string[] {
    const out: string[] = [];
    if (l.femaleCount) out.push(join(digitsFor(l.femaleCount, lang), lang === 'mr' ? 'बायका' : 'women'));
    if (l.maleCount) out.push(join(digitsFor(l.maleCount, lang), lang === 'mr' ? 'गडी' : 'men'));
    if (out.length === 0 && l.count) out.push(join(digitsFor(l.count, lang), lang === 'mr' ? 'मजूर' : 'workers'));
    return out;
}

function machineName(m: MachineryEvent, lang: SathiLanguage): string | null {
    const type = (m.type ?? 'unknown') as string;
    const label = lang === 'mr' ? MACHINE_MR[type] ?? 'यंत्र' : type === 'unknown' ? 'machine' : type;
    const hours = m.hoursUsed !== undefined ? join(digitsFor(m.hoursUsed, lang), lang === 'mr' ? 'तास' : 'h') : '';
    return join(label, hours) || null;
}

function expenseName(e: ActivityExpenseEvent, lang: SathiLanguage): string | null {
    const what = (e.reason ?? e.category ?? '').trim();
    const money = e.totalAmount !== undefined ? `₹${digitsFor(e.totalAmount, lang)}` : '';
    return join(what, money) || null;
}

/** Each piece of work he logged, in record order, in this language; `null` when the record holds nothing to name. */
export function appreciationItems(record: AppreciationRecord, lang: SathiLanguage): AppreciationItems | null {
    const namedItems: string[] = [];
    const plannedNames: string[] = [];

    for (const a of record.cropActivities ?? []) {
        const name = activityName(a);
        if (!name) continue;
        (a.plannedOnly === true ? plannedNames : namedItems).push(name);
    }
    for (const i of record.inputs ?? []) namedItems.push(...inputNames(i, lang));
    for (const w of record.irrigation ?? []) { const n = waterName(w, lang); if (n) namedItems.push(n); }
    for (const l of record.labour ?? []) namedItems.push(...labourNames(l, lang));
    for (const m of record.machinery ?? []) { const n = machineName(m, lang); if (n) namedItems.push(n); }
    for (const e of record.activityExpenses ?? []) { const n = expenseName(e, lang); if (n) namedItems.push(n); }

    return namedItems.length + plannedNames.length > 0 ? { namedItems, plannedNames } : null;
}

export interface AppreciationText {
    text: string;
    /** True only when every pattern used carries the founder's tick. */
    approved: boolean;
    items: AppreciationItems;
}

/** The appreciation sentence from the approved patterns, or `null` when there is nothing to name. */
export function appreciationText(record: AppreciationRecord, lang: SathiLanguage): AppreciationText | null {
    const items = appreciationItems(record, lang);
    if (!items) return null;
    const sep = lang === 'mr' ? ', ' : ', ';
    const parts: string[] = [];
    let approved = true;
    if (items.namedItems.length > 0) {
        parts.push(fillPattern(SATHI_PATTERNS.appreciation[lang], { items: items.namedItems.join(sep) }));
        approved = approved && SATHI_PATTERNS.appreciation.approved;
    }
    if (items.plannedNames.length > 0) {
        parts.push(fillPattern(SATHI_PATTERNS.appreciationPlanned[lang], { planned: items.plannedNames.join(sep) }));
        approved = approved && SATHI_PATTERNS.appreciationPlanned.approved;
    }
    return { text: parts.join(' '), approved, items };
}
