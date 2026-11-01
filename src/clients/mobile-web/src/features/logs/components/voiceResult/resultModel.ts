/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-09..LP-15, LP-21, LP-24)
 *
 * The ONE result screen's view model, built from REAL logs (never the preview's sample day). Pure.
 *
 * Rules it keeps (founder PLR-D1 rounds 2-5, doctrine P4):
 *   - EIGHT parts of a day. A part he did not mention is listed as "not mentioned" — never as a 0.
 *   - A value is shown only as it was recorded: no count, hour or rupee is computed, nothing is summed.
 *   - His words are colour-marked ONLY with a phrase that is VERIFIED: the item's `sourceText`, not flagged
 *     unverified by the server (`provenanceVerified !== false`), and found word-for-word in his transcript.
 *     An item without such a phrase is shown without a quote; no phrase is ever made up.
 *   - An item the server could NOT verify (`provenanceVerified === false`) is never a plain fact: it carries
 *     `verified: false` (the screen shows the approved "हे मी नक्की ऐकलं नाही" flag) and does not make its
 *     part "told" — the ring's own rule (`dayCategoryCoverage` drops such items too). Its part reads "not sure",
 *     never "not said" (PLR-D1 LP-19: never tell him he did not say what the screen shows he said).
 *   - ONE rule for the ring and the eight parts (round 3): a part is "told" exactly when the ring's own coverage
 *     says so (`toldParts`). So the money he states on labour, a spray or a machine makes खर्च told (and is shown
 *     there, as he said it), water that was not given is a stoppage (not पाणी ✓), a spray tank's water belongs
 *     to the spray, and an "issue" note is a stoppage — each exactly where the ring puts it.
 *   - The screen is the plot's WHOLE DAY: the recording just made, and the day's earlier ones newest first.
 *     One recording that named several plots became several logs; it is still ONE recording here.
 */
import { LogVerificationStatus, type DailyLog, type IrrigationEvent, type ObservationNote, type PlannedTask } from '../../../../types';
import { t } from '../../../../i18n/translations';
import { formatFarmerLogTime } from '../../../../core/navigation/helpers';
import { isCompletedIrrigationEvent } from '../../services/irrigationCompletion';
// The ring's pure parts by file, not its barrel: this model is read by the activity feed on every app load, and the
// barrel also evaluates the canvas engines (only the result screen, loaded on demand, needs those).
import { buildNodes, type CategoryId, type RingNodeData } from '../shramsathi/understandingRing/categories';
import { dayCategoryStates, type CoverageExtras } from '../shramsathi/understandingRing/dayCategoryCoverage';
import type { IconName } from '../shramsathi/understandingRing/icons';
import { productBoxesOf, withoutTaskPrefix, type ProductBox } from './productModel';
import { workTypeNameIn } from '../../../../shared/names/namesIn';
import { ruleWithheldCopy } from '../../../../i18n/ruleWithheldTranslations';

export type PartKey = 'crop' | 'labour' | 'irrigation' | 'inputs' | 'expense' | 'machinery' | 'observation' | 'planned';

export interface PartMeta {
    key: PartKey;
    label: string;
    /** Tint of the part's row and of its phrases in his words. */
    tint: string;
    /** The ring's own icon for this part: one picture for "water" everywhere. */
    icon: IconName;
}

// PROPOSED (Marathi) — the part names of the founder-approved design preview (postVoiceResult/model.ts), not yet reviewed.
export const PARTS: readonly PartMeta[] = [
    { key: 'crop', label: 'पीक काम', tint: '#dcfce7', icon: 'work' },
    { key: 'labour', label: 'मजूर', tint: '#fef3c7', icon: 'labour' },
    { key: 'irrigation', label: 'पाणी', tint: '#cffafe', icon: 'water' },
    { key: 'inputs', label: 'औषध / खत', tint: '#ede9fe', icon: 'inputs' },
    { key: 'expense', label: 'खर्च', tint: '#e0f2fe', icon: 'expenses' },
    { key: 'machinery', label: 'यंत्र', tint: '#fee2e2', icon: 'machinery' },
    { key: 'observation', label: 'निरीक्षण', tint: '#fce7f3', icon: 'observations' },
    { key: 'planned', label: 'उद्याचं काम', tint: '#ffedd5', icon: 'reminders' },
];

export const partMeta = (key: PartKey): PartMeta => PARTS.find(p => p.key === key) ?? PARTS[0];

/** spec I18 — the eight part names in English (PROPOSED (English)); `partNames.partNameIn` reads both. */
export const PART_LABEL_EN: Readonly<Record<PartKey, string>> = {
    crop: 'Crop work', // PROPOSED (English)
    labour: 'Labour', // PROPOSED (English)
    irrigation: 'Water', // PROPOSED (English)
    inputs: 'Sprays / fertiliser', // PROPOSED (English)
    expense: 'Expenses', // PROPOSED (English)
    machinery: 'Machines', // PROPOSED (English)
    observation: 'Observation', // PROPOSED (English)
    planned: 'Planned work', // PROPOSED (English)
};
const partLabelIn = (key: PartKey, language: string): string => (language === 'en' ? PART_LABEL_EN[key] : partMeta(key).label);

/** One thing Sathi understood, tied to the log (recording) it came from. */
export interface PartEntry {
    id: string;
    logId: string;
    part: PartKey;
    /** What was noted, as recorded. `null` = the part was mentioned with nothing more to show. */
    value: string | null;
    /** His own verified phrase for it, if any. */
    quote?: string;
    /** False when the server could not find the item's phrase in his words: flagged, never a plain fact. */
    verified: boolean;
    /** Lane L6b — an input's products as recorded (design ProductCard): the chip row and the spray / drip box. */
    products?: ProductBox;
}

/**
 * A stoppage he reported ("पाऊस आला, काम झालं नाही", "लाईट नव्हती, पाणी दिलं नाही", an "issue" note): not one of
 * the eight parts, but understood all the same — the ring's अडथळे / अडचणी.
 */
export interface BlockerEntry { id: string; logId: string; value: string | null; quote?: string; verified: boolean }

interface Sourced { sourceText?: string; provenanceVerified?: boolean }

/** Spacing and punctuation his words and an item's phrase may differ by — never a letter or a digit. */
const SKIP = /[\s.,!?;:।॥"'“”‘’()[\]{}\-–—…]/;

/**
 * Where an item's phrase sits in his words, comparing letters only: case, spacing and punctuation aside (lane L6b
 * fix — the parser's `sourceText` can drop a comma or a full stop, or start a sentence in lower case).
 */
export function findPhrase(transcript: string, phrase: string): { start: number; end: number } | null {
    const at: number[] = [];
    let flat = '';
    for (let i = 0; i < transcript.length; i += 1) {
        if (SKIP.test(transcript[i])) continue;
        flat += transcript[i].toLowerCase();
        at.push(i);
    }
    const needle = [...phrase].filter(ch => !SKIP.test(ch)).join('').toLowerCase();
    const hit = needle ? flat.indexOf(needle) : -1;
    return hit < 0 ? null : { start: at[hit], end: at[hit + needle.length - 1] + 1 };
}

/**
 * The item's phrase, ONLY when it is verified and found in his transcript — returned as HIS words (the transcript's
 * own stretch), so the mark lands exactly on what he said.
 */
export function verifiedPhrase(item: Sourced, transcript: string | undefined): string | undefined {
    const phrase = item.sourceText?.trim();
    if (!phrase || item.provenanceVerified === false || !transcript) return undefined;
    const hit = findPhrase(transcript, phrase);
    return hit ? transcript.slice(hit.start, hit.end) : undefined;
}

const LATIN = /[A-Za-z]/;
const DEVANAGARI = /[ऀ-ॿ]/;
const clean = (s?: string | null): string => (s ?? '').trim();
/** A number exactly as recorded (no rounding up into something he did not say). */
const asRecorded = (n: number): string => String(n);
/**
 * A label the PARSER wrote (an activity title, a reason, a product name). Kept when it is Marathi — a brand
 * name in Latin letters inside Marathi words stays, they are his words. A label with NO Marathi at all
 * ("Spraying") is NOT shown (founder rule: no English on his screens): the entry then shows his own verified
 * phrase, or only its part's name. The value itself is untouched in the record ("बदला" shows it).
 */
const marathiOnly = (text: string | undefined | null): string => {
    const s = clean(text);
    return LATIN.test(s) && !DEVANAGARI.test(s) ? '' : s;
};
/** spec I18 — English mode: a label the parser wrote, only when it has no Marathi in it (the mirror of `marathiOnly`). */
const englishOnly = (text: string | undefined | null): string => {
    const s = clean(text);
    return DEVANAGARI.test(s) ? '' : s;
};
/** A parser label in this language (Marathi mode: Marathi only; English mode: English only). */
const labelIn = (language: string) => (text: string | undefined | null): string => (language === 'en' ? englishOnly(text) : marathiOnly(text));
const firstIn = (language: string, ...texts: Array<string | undefined | null>): string => texts.map(labelIn(language)).find(Boolean) ?? '';
/**
 * His own words kept on the record (an observation's `textRaw`, a stoppage's note): Marathi mode keeps the Marathi rule
 * (`marathiOnly`); English mode shows them as he said them — they are his words, not a label (spec I18 "as entered").
 */
const saidIn = (language: string) => (text: string | undefined | null): string => (language === 'en' ? clean(text) : marathiOnly(text));
/**
 * A work type / work title in this language: the app's own work words first ("फवारणी" ↔ "Spraying", `workTypeNameIn`),
 * then the label itself when it is written in this language.
 */
const workIn = (language: string, ...texts: Array<string | undefined | null>): string =>
    texts.map(t => workTypeNameIn(t, language, { strict: true })).find(Boolean) ?? '';

// PROPOSED (Marathi) — machine names for the parser's machine types.
const MACHINE: Partial<Record<string, string>> = {
    tractor: 'ट्रॅक्टर', tiller: 'टिलर', harvester: 'हार्वेस्टर', drone: 'ड्रोन', sprayer: 'फवारणी यंत्र',
};
// PROPOSED (English) — the same machines in English mode (spec I18).
const MACHINE_EN: Partial<Record<string, string>> = {
    tractor: 'Tractor', tiller: 'Tiller', harvester: 'Harvester', drone: 'Drone', sprayer: 'Sprayer',
};
// APPROVED — the app's words for the two halves of a labour split (workSummary), for money on a machine
// (workSummary.rentalCost / fuelCost) and for a day's typed total (reflectPage.totalCost).
const MALE = t('workSummary.maleWorkers', 'mr');
const FEMALE = t('workSummary.femaleWorkers', 'mr');
const RENT = t('workSummary.rentalCost', 'mr');
const FUEL = t('workSummary.fuelCost', 'mr');
const DAY_TOTAL = t('reflectPage.totalCost', 'mr');
// PROPOSED (Marathi) — the unit words built into the values on this screen, not yet reviewed.
const PEOPLE = 'जण'; // PROPOSED (Marathi) — "4 जण"
const HOURS = 'तास'; // PROPOSED (Marathi) — "2 तास"
const LITRES = 'लिटर'; // PROPOSED (Marathi) — "600 लिटर"
const EACH = 'प्रत्येकी'; // PROPOSED (Marathi) — a wage per person, "₹400 प्रत्येकी"
const RATE = 'दर'; // PROPOSED (Marathi) — a rate he stated, "₹30 दर"

/** spec I18 — the unit words of this screen per language (English: APPROVED where the app has them, else PROPOSED (English)). */
interface Units { male: string; female: string; rent: string; fuel: string; dayTotal: string; people: string; hours: string; litres: string; each: string; rate: string; machine: Partial<Record<string, string>> }
const UNITS_MR: Units = { male: MALE, female: FEMALE, rent: RENT, fuel: FUEL, dayTotal: DAY_TOTAL, people: PEOPLE, hours: HOURS, litres: LITRES, each: EACH, rate: RATE, machine: MACHINE };
const UNITS_EN: Units = {
    male: t('workSummary.maleWorkers', 'en'), female: t('workSummary.femaleWorkers', 'en'), // APPROVED
    rent: t('workSummary.rentalCost', 'en'), fuel: t('workSummary.fuelCost', 'en'), dayTotal: t('reflectPage.totalCost', 'en'), // APPROVED
    people: 'people', hours: 'hours', litres: 'litres', each: 'each', rate: 'rate', // PROPOSED (English)
    machine: MACHINE_EN,
};
const unitsIn = (language: string): Units => (language === 'en' ? UNITS_EN : UNITS_MR);

const join = (...parts: Array<string | null | undefined>): string => parts.map(clean).filter(Boolean).join(' · ');
const positive = (n: number | undefined): n is number => typeof n === 'number' && n > 0;
/** A rupee amount exactly as stated; nothing when none was stated (never "₹0"). */
const rupees = (n: number | undefined, unit = ''): string => (positive(n) ? `₹${asRecorded(n)}${unit ? ` ${unit}` : ''}` : '');

/**
 * Labour as he said it, by the app's own headcount rule (`resolveLabourHeadcount`: a total counts only when it
 * is above 0, else the split): his total ("4 जण"), his split ("3 पुरुष · 2 महिला") — and when the split IS his
 * total ("५ बायका": count 5 AND femaleCount 5) the split, so it still says who they were. A total beside a split
 * that is not the same people is shown with it. Never a sum the app made, never a 0 for a job workers did.
 *
 * Register F23 (lane AI-1): a labour count of 0 is never shown as "0 जण". On a labour row it is the parser's "not
 * understood" (the server now removes it at the source); "nobody came" is an observation, not a labour row. So a 0
 * reads like silence: the task, else his own words (the entry's quote).
 */
const labourValue = (e: { count?: number; maleCount?: number; femaleCount?: number; activity?: string }, language = 'mr'): string => {
    const u = unitsIn(language);
    const split = join(positive(e.maleCount) ? `${asRecorded(e.maleCount)} ${u.male}` : '', positive(e.femaleCount) ? `${asRecorded(e.femaleCount)} ${u.female}` : '');
    if (positive(e.count)) {
        if (!split) return `${asRecorded(e.count)} ${u.people}`;
        // Compared, never shown: is the split the same people as his total?
        return (e.maleCount ?? 0) + (e.femaleCount ?? 0) === e.count ? split : join(`${asRecorded(e.count)} ${u.people}`, split);
    }
    return split || workIn(language, e.activity) || labelIn(language)(e.activity);
};

/**
 * The money he said on a labour row, as said: the total, the wage per person, a rate. Lane MU-3 fix 1 (F10): an amount
 * held back by rule reads "नियमानुसार दिसत नाही" (W3) where the ₹ would be — never silence that reads "not stated".
 */
const labourMoney = (
    e: { totalCost?: number; wagePerPerson?: number; rate?: number; totalCostWithheld?: true; wageWithheld?: true },
    language = 'mr',
): string =>
    join(
        e.totalCostWithheld || e.wageWithheld ? ruleWithheldCopy(language).amount : '',
        rupees(e.totalCost), rupees(e.wagePerPerson, unitsIn(language).each), e.rate !== e.wagePerPerson ? rupees(e.rate, unitsIn(language).rate) : '',
    );

/** Water actually given, by the app's own rule; a spray tank's water belongs to the spray, not to पाणी. */
const isGivenWater = (e: IrrigationEvent): boolean => e.role !== 'spray-carrier' && isCompletedIrrigationEvent(e);
/** Water he tried to give and could not ("लाईट नव्हती, पाणी दिलं नाही"): a stoppage, as the ring reads it. */
const isWaterStoppage = (e: IrrigationEvent): boolean => e.role !== 'spray-carrier' && !isCompletedIrrigationEvent(e);

// The log factories write every planned task TWICE: once as the task and once as a mirrored "reminder" note
// (voice tag 'planned_task', manual tag 'manual_task'); and a reminder note becomes a task that points back
// at it (`sourceObservationId`). Shown once each, never twice ("उद्या फवारणी" is one thing he said).
const MIRROR_TAGS = new Set(['planned_task', 'manual_task']);

/**
 * Planned work shown ONCE (the result screen, the ring, and — lane OF fix 1, M6 — the बदला screen's taps): the notes and
 * tasks that stand for themselves, and `partnersOf(id)` — what moves WITH a shown item: a task's mirrored reminder notes,
 * or the task a reminder note produced. Removing one by tap removes its partners, as the spoken rule moves planned work
 * and its reminders together (`correctionModel.mergeCorrection`).
 */
export function plannedOnce(log: DailyLog): { observations: ObservationNote[]; tasks: PlannedTask[]; partnersOf: (id: string) => string[] } {
    const notes = log.observations ?? [];
    const noteIds = new Set(notes.map(o => o.id));
    // A task made FROM one of this log's notes is that note (or that note's own task): the note stands for it.
    // A cancelled task is not something he plans to do (the ring does not count it either).
    const tasks = (log.plannedTasks ?? []).filter(task => task.status !== 'cancelled' && !(task.sourceObservationId && noteIds.has(task.sourceObservationId)));
    const titles = new Set(tasks.map(task => clean(task.title)).filter(Boolean));
    const observations = notes.filter(o => o.noteType !== 'reminder'
        || !((o.tags ?? []).some(tag => MIRROR_TAGS.has(tag)) || titles.has(clean(o.textRaw))));
    const shownNotes = new Set(observations.map(o => o.id));
    const partnersOf = (id: string): string[] => {
        const task = tasks.find(t => t.id === id);
        if (task) {
            return notes.filter(o => o.noteType === 'reminder' && !shownNotes.has(o.id) && clean(o.textRaw) === clean(task.title)).map(o => o.id);
        }
        return shownNotes.has(id) ? (log.plannedTasks ?? []).filter(t => t.sourceObservationId === id).map(t => t.id) : [];
    };
    return { observations, tasks, partnersOf };
}

/**
 * Everything understood from ONE log, part by part, in the parts' order — its words in `language` (spec I18: Marathi
 * mode Marathi only, English mode English only; his own quoted words stay as he said them).
 */
export function partEntriesOf(log: DailyLog, language: string | null | undefined = 'mr'): PartEntry[] {
    const lang = language === 'en' ? 'en' : 'mr';
    const u = unitsIn(lang);
    const inLang = labelIn(lang);
    const transcript = log.fullTranscript;
    const out: PartEntry[] = [];
    const costs: PartEntry[] = [];
    const add = (part: PartKey, index: number, item: Sourced & { id?: string }, value: string, products?: ProductBox) => {
        const quote = verifiedPhrase(item, transcript);
        out.push({
            id: item.id || `${log.id}:${part}:${index}`, logId: log.id, part, value: value || quote || null, quote,
            verified: item.provenanceVerified !== false, ...(products && { products }),
        });
    };
    // Money he said on ANOTHER part (a wage, a spray's cost, a machine's rent) is listed under खर्च too, as he said
    // it and named by what it paid for. Without its phrase: that phrase already marks the other part in his words.
    const addCost = (src: PartKey, index: number, item: Sourced & { id?: string }, what: string, money: string) => {
        if (!money) return;
        costs.push({ id: `${item.id || `${log.id}:${src}:${index}`}:cost`, logId: log.id, part: 'expense', value: join(what || partLabelIn(src, lang), money), verified: item.provenanceVerified !== false });
    };

    // The parser writes the Marathi title beside English work types ({title:'फवारणी', workTypes:['Spraying']}).
    // A free note on the work or on the water is shown with it when it reads in Marathi (the feed card's old
    // "Note:" line, I13 round 3); an English note stays in the record ("बदला").
    (log.cropActivities ?? []).forEach((a, i) => add('crop', i, a, join(
        workIn(lang, a.title, ...(a.workTypes ?? [])) || firstIn(lang, a.title, a.workTypes?.filter(Boolean).join(', ')),
        inLang(a.notes),
    )));
    (log.labour ?? []).forEach((e, i) => {
        add('labour', i, e, labourValue(e, lang));
        addCost('labour', i, e, '', labourMoney(e, lang));
    });
    (log.irrigation ?? []).forEach((e, i) => {
        if (!isGivenWater(e)) return; // not given: a stoppage (blockersOf); a spray's water: the spray's
        add('irrigation', i, e, join(
            positive(e.durationHours) ? `${asRecorded(e.durationHours)} ${u.hours}` : '',
            positive(e.waterVolumeLitres) ? `${asRecorded(e.waterVolumeLitres)} ${u.litres}` : '',
            inLang(e.notes),
        ));
    });
    const boxes = productBoxesOf(log);
    (log.inputs ?? []).forEach((e, i) => {
        // Never the sync task's "Spray …" / "Fertilizer …" wording a pulled log carries (L6b fix).
        const names = (e.mix ?? []).map(m => inLang(withoutTaskPrefix(m.productName))).filter(Boolean);
        const what = names.length > 0 ? names.join(', ') : inLang(withoutTaskPrefix(e.productName));
        add('inputs', i, e, what, boxes[i]);
        addCost('inputs', i, e, what, rupees(e.cost));
    });
    (log.activityExpenses ?? []).forEach((e, i) => add('expense', i, e, join(inLang(e.reason), rupees(e.totalAmount))));
    (log.machinery ?? []).forEach((e, i) => {
        add('machinery', i, e, join(u.machine[e.type], positive(e.hoursUsed) ? `${asRecorded(e.hoursUsed)} ${u.hours}` : ''));
        addCost('machinery', i, e, u.machine[e.type] ?? '', join(rupees(e.rentalCost) && `${u.rent} ${rupees(e.rentalCost)}`, rupees(e.fuelCost) && `${u.fuel} ${rupees(e.fuelCost)}`));
    });
    // A day total he typed on the form (no voice behind it): shown as typed, under its approved name.
    if (positive(log.manualTotalCost)) costs.push({ id: `${log.id}:manualTotal`, logId: log.id, part: 'expense', value: `${u.dayTotal} ${rupees(log.manualTotalCost)}`, verified: true });
    const { observations, tasks } = plannedOnce(log);
    // An "issue" note is a stoppage (blockersOf), as the ring reads it.
    observations.forEach((o, i) => { if (o.noteType !== 'issue') add(o.noteType === 'reminder' ? 'planned' : 'observation', i, o, saidIn(lang)(o.textRaw)); });
    tasks.forEach((task, i) => add('planned', i, task, inLang(task.title)));

    const order = new Map(PARTS.map((p, i) => [p.key, i]));
    return [...out, ...costs].sort((a, b) => (order.get(a.part) ?? 0) - (order.get(b.part) ?? 0));
}

/** The stoppage the log's day-level disturbance records, as he said it; null when there is none. */
export function blockerOf(log: DailyLog, language: string | null | undefined = 'mr'): BlockerEntry | null {
    const d = log.disturbance;
    if (!d) return null;
    const quote = verifiedPhrase(d, log.fullTranscript);
    const lang = language === 'en' ? 'en' : 'mr';
    const value = lang === 'en' ? englishOnly(d.reason) || saidIn(lang)(d.note) || englishOnly(d.impact) : firstIn(lang, d.reason, d.note, d.impact);
    return { id: `${log.id}:blocker`, logId: log.id, value: value || quote || null, quote, verified: true };
}

/** Every stoppage in a log, as the ring reads them: its disturbance, water that was not given, an "issue" note. */
export function blockersOf(log: DailyLog, language: string | null | undefined = 'mr'): BlockerEntry[] {
    const lang = language === 'en' ? 'en' : 'mr';
    const transcript = log.fullTranscript;
    const out: BlockerEntry[] = [];
    const day = blockerOf(log, lang);
    if (day) out.push(day);
    (log.irrigation ?? []).forEach((e, i) => {
        if (!isWaterStoppage(e)) return;
        const quote = verifiedPhrase(e, transcript);
        out.push({
            id: `${e.id || `${log.id}:irrigation:${i}`}:stopped`, logId: log.id, quote, verified: e.provenanceVerified !== false,
            value: join(partLabelIn('irrigation', lang), firstIn(lang, e.issue?.reason, e.issue?.note, e.notes)),
        });
    });
    (log.observations ?? []).forEach((o, i) => {
        if (o.noteType !== 'issue') return;
        const quote = verifiedPhrase(o, transcript);
        out.push({ id: `${o.id || `${log.id}:issue:${i}`}:issue`, logId: log.id, value: saidIn(lang)(o.textRaw) || quote || null, quote, verified: o.provenanceVerified !== false });
    });
    return out;
}

/** "He confirmed it": the same rule the rest of the app uses for a verified log. */
export const isConfirmed = (log: DailyLog): boolean =>
    log.verification?.status === LogVerificationStatus.VERIFIED || log.verification?.status === LogVerificationStatus.APPROVED;

/**
 * No voice behind it: filled in by hand on the form, or (lane L6b) typed to Sathi in the "लिहून सांगा" sheet. The
 * preview's "लिहिलेलं". Only a positive claim counts.
 */
export const isTyped = (log: DailyLog): boolean => log.meta?.provenance?.source === 'manual' || log.typedEntry === true;

export interface Who { name: string; you: boolean }

export interface WhoDeps {
    /** Ids that mean "the person holding this phone" (the active operator and the signed-in user). */
    youIds: ReadonlySet<string>;
    nameOf: (operatorId: string) => string | undefined;
    /** Shown for the phone holder. */
    youLabel: string;
    /** Shown when nobody was recorded as speaking it (never a guessed name). */
    unknownLabel: string;
    /** spec I18 — the language the entries' words are built in (default Marathi). */
    language?: string;
}

export const whoSpoke = (log: DailyLog, deps: WhoDeps): Who => {
    const id = log.meta?.createdByOperatorId ?? '';
    if (id && deps.youIds.has(id)) return { name: deps.youLabel, you: true };
    return { name: (id && deps.nameOf(id)) || deps.unknownLabel, you: false };
};

/**
 * Which recording a log came from. The log factories stamp every log of one save with ONE clock reading, one
 * speaker and one parse (`sourceAiJobId`), so logs sharing all three are one recording that named several
 * plots. No time = its own recording.
 */
export const recordingKeyOf = (log: DailyLog): string =>
    log.meta?.createdAtISO
        ? `${log.meta.createdAtISO}|${log.meta.createdByOperatorId ?? ''}|${log.meta.provenance?.sourceAiJobId ?? ''}`
        : `log:${log.id}`;

/** The log of a recording that carries his words (one record holds the day's facts); else the first. */
export const primaryOf = (logs: readonly DailyLog[]): DailyLog | undefined => logs.find(l => !!l.fullTranscript) ?? logs[0];

/** Logs grouped by recording, in first-seen order. */
export function groupByRecording(logs: readonly DailyLog[]): DailyLog[][] {
    const groups = new Map<string, DailyLog[]>();
    for (const l of logs) {
        const key = recordingKeyOf(l);
        groups.set(key, [...(groups.get(key) ?? []), l]);
    }
    return [...groups.values()];
}

/** One recording of the day (the logs it became, read as one). */
export interface RecordingView {
    /** The log that carries his words (its clip is linked to it). */
    log: DailyLog;
    id: string;
    /** Every log this recording became (one per plot when he named several). */
    logIds: string[];
    timeLabel: string;
    who: Who;
    confirmed: boolean;
    /** No recording behind it: filled in by hand, or (L6b) typed to Sathi. */
    typed: boolean;
    /** Filled in on the form (not told to Sathi): not a time he "said" it (L6b: what he TYPED to Sathi is). */
    byForm: boolean;
    transcript: string;
    entries: PartEntry[];
    /** The stoppages it reported. */
    blockers: BlockerEntry[];
    /** Lane F1 (review N9): rebuilt from the server's task lines only, so some of its details are not available. */
    legacyPartial: boolean;
    /**
     * Lane MU-3 fix 1 (F3, D-66): it mentions money and, by ShramSafal's rule, its words and voice are not sent to this
     * person — the card shows the rule line (W1) in their place, never an empty transcript.
     */
    wordsWithheld: boolean;
}

/** One recording from the (non-empty) list of logs it became. */
export const recordingOf = (all: readonly DailyLog[], deps: WhoDeps): RecordingView => {
    const log = primaryOf(all) as DailyLog;
    return {
        log,
        id: log.id,
        logIds: all.map(l => l.id),
        timeLabel: formatFarmerLogTime(log.meta?.createdAtISO), // '' for a typed log's placeholder: no made-up time
        who: whoSpoke(log, deps),
        confirmed: all.every(isConfirmed),
        typed: all.every(isTyped),
        legacyPartial: all.some(l => l.legacyPartial === true),
        wordsWithheld: all.some(l => l.wordsWithheldForMoney === true),
        byForm: all.every(l => l.meta?.provenance?.source === 'manual'),
        transcript: clean(log.fullTranscript),
        entries: all.flatMap(l => partEntriesOf(l, deps.language)),
        blockers: all.flatMap(l => blockersOf(l, deps.language)),
    };
};

/** The only stoppages ending this way are water this model reads as "not given" (`blockersOf`). */
const WATER_STOPPED = ':stopped';

/**
 * An older record kept only as task lines (lane F1, `legacyPartial`) carries its water as a bare "Irrigation" line:
 * no method, no hours, no reason. `blockersOf` reads such water as NOT given — a stoppage — but nothing in the
 * line says so. Here it is what the line says and no more: water was mentioned (the part, no value). Never a
 * stoppage that was not reported (P4). ONE rule for every screen that reads a recording: the result screen's
 * earlier recordings (register F63) and आढावा (`dayRecordings`).
 */
export function withoutInventedStoppage(view: RecordingView, logs: readonly DailyLog[]): RecordingView {
    const legacy = new Set(logs.filter(l => l.legacyPartial === true).map(l => l.id));
    if (legacy.size === 0) return view;
    const invented = (id: string, logId: string) => legacy.has(logId) && id.endsWith(WATER_STOPPED);
    const water: PartEntry[] = view.blockers
        .filter(b => invented(b.id, b.logId))
        .map((b): PartEntry => ({ id: `${b.id.slice(0, -WATER_STOPPED.length)}:legacy`, logId: b.logId, part: 'irrigation', value: null, verified: true }));
    if (water.length === 0) return view;
    const order = new Map(PARTS.map((p, i) => [p.key, i]));
    return {
        ...view,
        blockers: view.blockers.filter(b => !invented(b.id, b.logId)),
        entries: [...view.entries, ...water].sort((a, b) => (order.get(a.part) ?? 0) - (order.get(b.part) ?? 0)),
    };
}

/** A recording read through the shared legacy-water rule (`withoutInventedStoppage`). */
const readRecording = (logs: readonly DailyLog[], deps: WhoDeps): RecordingView => withoutInventedStoppage(recordingOf(logs, deps), logs);

const plotIdsOf = (logs: readonly DailyLog[]): Set<string> =>
    new Set(logs.flatMap(l => l.context?.selection?.flatMap(s => s.selectedPlotIds ?? []) ?? []));

/**
 * The plot's day: every log of the same day that touches one of the plots of `current` (or, for a record
 * of the whole farm, the other whole-farm records of that day). Deleted logs never count, and neither does
 * a log the phone KNOWS belongs to another farm (both farms recorded and different; no guess either way).
 */
export function sameDayLogs(current: readonly DailyLog[], history: readonly DailyLog[]): DailyLog[] {
    const date = current[0]?.date;
    if (!date) return [];
    const plots = plotIdsOf(current);
    const farm = current.find(l => l.meta?.farmId)?.meta?.farmId;
    return history.filter(l => {
        if (l.date !== date || l.deletion) return false;
        if (farm && l.meta?.farmId && l.meta.farmId !== farm) return false;
        const its = plotIdsOf([l]);
        return plots.size === 0 ? its.size === 0 : [...its].some(p => plots.has(p));
    });
}

const createdMs = (log: DailyLog): number => {
    const ms = Date.parse(log.meta?.createdAtISO ?? '');
    return Number.isFinite(ms) ? ms : 0;
};

export interface Speaker { name: string; you: boolean; times: number }

export interface DayView {
    /** The recording he just made, one view per log (one log per plot when he named several). */
    current: RecordingView[];
    /** Today's earlier recordings for the same plot(s), NEWEST FIRST — one row per recording. */
    earlier: RecordingView[];
    /** Every log id of the day → the recording it belongs to. */
    recordingByLog: ReadonlyMap<string, RecordingView>;
    /** Every part, in order, with what the whole day says about it. */
    byPart: Record<PartKey, PartEntry[]>;
    /** Parts the day does not tell and holds nothing about: shown in red as "not said", never as 0. */
    missing: PartKey[];
    /**
     * Parts the day mentions but does not TELL (by the ring's rule): only what the server could not verify. Shown
     * as "not sure" — never as "not said", for the screen lists what he said right below.
     */
    unsure: PartKey[];
    /** Parts the recording just made added to. */
    touchedNow: Set<PartKey>;
    /** Stoppages the recording just made reported. */
    blockersNow: BlockerEntry[];
    /** Who told Sathi today, each counted once per RECORDING (not per plot it named); a form entry is not "said". */
    speakers: Speaker[];
}

/** The app's own rule for water that was given (the ring's default guess is only for callers without one). */
const COVERAGE: CoverageExtras = { isCompletedIrrigation: isCompletedIrrigationEvent };

/** The parts the day TELLS, by the ring's own coverage rules: one rule for the ring's orbs and the eight parts. */
export function toldParts(logs: readonly DailyLog[], date: string | undefined): Set<PartKey> {
    const states = dayCategoryStates(logs, date, COVERAGE);
    const told = new Set<PartKey>();
    for (const [id, part] of Object.entries(PART_OF_NODE)) if (part && states[id as CategoryId] === 'told') told.add(part);
    return told;
}

export function buildDayView(current: readonly DailyLog[], history: readonly DailyLog[], deps: WhoDeps): DayView {
    const currentIds = new Set(current.map(l => l.id));
    const earlierLogs = sameDayLogs(current, history)
        .filter(l => !currentIds.has(l.id))
        .sort((a, b) => createdMs(b) - createdMs(a));
    const now = current.map(l => readRecording([l], deps));
    const earlier = groupByRecording(earlierLogs).map(g => readRecording(g, deps));

    const recordingByLog = new Map<string, RecordingView>();
    for (const r of earlier) for (const id of r.logIds) recordingByLog.set(id, r);
    for (const r of now) recordingByLog.set(r.id, r);

    const byPart = Object.fromEntries(PARTS.map(p => [p.key, [] as PartEntry[]])) as Record<PartKey, PartEntry[]>;
    for (const r of [...now, ...earlier]) for (const e of r.entries) byPart[e.part].push(e);

    const speakers: Speaker[] = [];
    const nowWho = (now.find(r => !!r.transcript) ?? now[0])?.who;
    for (const who of [...[...earlier].reverse().filter(r => !r.byForm).map(r => r.who), ...(nowWho ? [nowWho] : [])]) {
        const hit = speakers.find(s => s.name === who.name && s.you === who.you);
        if (hit) hit.times += 1; else speakers.push({ ...who, times: 1 });
    }

    const told = toldParts([...current, ...earlierLogs], current[0]?.date);
    const notTold = PARTS.map(p => p.key).filter(k => !told.has(k));
    return {
        current: now,
        earlier,
        recordingByLog,
        byPart,
        missing: notTold.filter(k => byPart[k].length === 0),
        unsure: notTold.filter(k => byPart[k].length > 0),
        touchedNow: new Set(now.flatMap(r => r.entries.map(e => e.part))),
        blockersNow: now.flatMap(r => r.blockers),
        speakers,
    };
}

/** A run of his words; `part` set when the run is a verified phrase that made Sathi understand that part. */
export interface WordRun { text: string; part?: PartKey }

/** His transcript cut into runs, each verified phrase marked with its part. Overlapping phrases keep the first. */
export function markTranscript(transcript: string, entries: readonly PartEntry[]): WordRun[] {
    if (!transcript) return [];
    const ranges: Array<{ start: number; end: number; part: PartKey }> = [];
    for (const e of entries) {
        if (!e.quote) continue;
        for (let from = 0, at = transcript.indexOf(e.quote); at >= 0; from = at + 1, at = transcript.indexOf(e.quote, from)) {
            const end = at + e.quote.length;
            if (!ranges.some(r => at < r.end && end > r.start)) { ranges.push({ start: at, end, part: e.part }); break; }
        }
    }
    ranges.sort((a, b) => a.start - b.start);
    const runs: WordRun[] = [];
    let cursor = 0;
    for (const r of ranges) {
        if (r.start > cursor) runs.push({ text: transcript.slice(cursor, r.start) });
        runs.push({ text: transcript.slice(r.start, r.end), part: r.part });
        cursor = r.end;
    }
    if (cursor < transcript.length) runs.push({ text: transcript.slice(cursor) });
    return runs;
}

/** The parts his words were marked with, in the order he first said them, each with its phrases. */
export function phrasesByPart(runs: readonly WordRun[]): Array<{ part: PartKey; phrases: string[] }> {
    const out: Array<{ part: PartKey; phrases: string[] }> = [];
    for (const r of runs) {
        if (!r.part) continue;
        const hit = out.find(o => o.part === r.part);
        if (hit) hit.phrases.push(r.text.trim()); else out.push({ part: r.part, phrases: [r.text.trim()] });
    }
    return out;
}

/**
 * The ring's orbs for the plot's day, by the ring's own coverage rules. Founder 2026-10-25: nothing on the
 * ring stays grey — a part that was not told shows as the red X (an invitation, never a 0).
 */
export function ringNodesForDay(logs: readonly DailyLog[], date: string | undefined): RingNodeData[] {
    return buildNodes(dayCategoryStates(logs, date, COVERAGE)).map(n => (n.state === 'neutral' ? { ...n, state: 'missed' as const } : n));
}

/** Which part a ring orb belongs to, so tapping a red orb opens the mic to tell it. */
export const PART_OF_NODE: Partial<Record<CategoryId, PartKey>> = {
    work: 'crop', labour: 'labour', inputs: 'inputs', water: 'irrigation', machinery: 'machinery',
    cropNote: 'observation', expenses: 'expense', observations: 'observation', reminders: 'planned',
};
