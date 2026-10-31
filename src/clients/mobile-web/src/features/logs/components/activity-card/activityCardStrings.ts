/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13; inventory LP-27, round 3) — the words of the activity
 * card inside the review / edit form (ActivityCard, BucketItem, the stoppage sheet, the "work done" list).
 *
 * The form opens for typed entries, labour entries, a parse that was not auto-saved, and "बदला" on the result
 * screen, so the farmer meets this card often. Founder 2026-10-26 (language-strict): Marathi mode shows Marathi
 * only, English mode English only. So every line exists in both:
 *   - English: the card's own English, word for word as it was (an English user sees no change);
 *   - Marathi: APPROVED where read from the app's translations (`t(key, 'mr')`), FOUNDER where it is the label of
 *     the founder's "मला किती समजलं" ring (understandingRing/categories.ts), else PROPOSED (Marathi), marked below.
 *     "नोंद" is not used (PLR-D5 :65). A total the app adds up itself says so: "आपोआप मोजलं" (PLR-D1).
 * What is NOT translated here: values the farmer or the parser wrote (a product, a work type, a motor's name, a
 * reason). Those are his record; a language-aware name helper for them is spec I18.
 */
import { t } from '../../../../i18n/translations';
import { useOptionalLanguage } from '../../../../i18n/LanguageContext';
import type { Language } from '../../../../i18n/language';
// The ring's labels by file, not its barrel: the review form loads with the log tab, the canvas engines need not.
import { CATEGORY_META, type CategoryId } from '../shramsathi/understandingRing/categories';
import { ENGLISH_WORK_DONE_LABELS, type WorkDoneLabels } from '../../services/workDoneProjection';
import { workTypeNameIn } from '../../../../shared/names/namesIn';

/** FOUNDER — a label of the founder's ring, on one line. */
const ring = (id: CategoryId): string => CATEGORY_META[id].label.replace(/<br\s*\/?>/g, ' ');
const AUTO = 'आपोआप मोजलं'; // FOUNDER — PLR-D1: a total the app worked out itself is labelled so.
const LATIN = /[A-Za-z]/;
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * Marathi for the fixed values the app and the parser store in English (methods, units, labour kinds, machine
 * kinds, ownership, a step's status, the app's own "Well" default). PROPOSED (Marathi) unless marked. A value
 * not in this list is his own (a name he typed) and is shown as it is. '' = nothing worth showing ("unknown").
 */
const MR_VALUES: Record<string, string> = {
    // methods and carriers
    spray: 'फवारणी', blower: 'ब्लोअर', tank: 'टाकी', both: 'दोन्ही', soil: 'जमिनीतून', drenching: 'आळवणी',
    fertigation: 'ठिबकमधून खत', paste_manual: 'हाताने लेप', hours: 'तास', pati: 'पाटी', bag: 'पोते', kg: 'किलो', liters: 'लिटर',
    drip: t('profile.drip', 'mr'), flood: t('profile.flood', 'mr'), sprinkler: t('profile.sprinkler', 'mr'), // APPROVED
    // labour kinds, and a contract's units (acre: APPROVED profile.acre)
    hired: 'रोजंदारी', contract: 'उक्ते', self: 'स्वतः',
    tree: 'झाड', acre: t('profile.acre', 'mr'), row: 'ओळ', 'lump sum': 'एकरकमी',
    // ownership — APPROVED (profile.owned / profile.rented)
    owned: t('profile.owned', 'mr'), rented: t('profile.rented', 'mr'),
    // machines
    tractor: 'ट्रॅक्टर', tiller: 'टिलर', harvester: 'हार्वेस्टर', drone: 'ड्रोन', sprayer: 'फवारणी यंत्र', rotavator: 'रोटाव्हेटर',
    // a step's status
    completed: 'पूर्ण', partial: 'अर्धवट', pending: 'बाकी', gap_recorded: 'राहिलं',
    // input reasons
    preventive: 'प्रतिबंधक', disease: 'रोग', pest: 'कीड', growth: 'वाढीसाठी', deficiency: 'कमतरता', 'seller advice': 'दुकानदाराचा सल्ला', other: 'इतर',
    // the app's own defaults
    well: 'विहीर', unknown: '',
};

/**
 * A stored value in his language: Marathi for the app's fixed English values; a work type through the one name helper
 * (spec I18: "Spraying" ↔ "फवारणी" both ways, `workTypeNameIn`); anything else (a name he typed) as it is.
 */
export const valueIn = (language: Language) => (value: string | number | undefined | null): string => {
    const v = value == null ? '' : String(value);
    if (language === 'en') return workTypeNameIn(v, 'en');
    const hit = MR_VALUES[v.trim().toLowerCase()];
    return hit ?? workTypeNameIn(v, 'mr');
};

/** Machine explanations ("systemInterpretation") are shown only when they read in his language. */
const inLanguage = (language: Language) => (text: string | undefined): string | undefined => {
    if (!text || language === 'en') return text;
    return LATIN.test(text) && !DEVANAGARI.test(text) ? undefined : text;
};

export interface ActivityCardStrings {
    language: Language;
    work: string; labour: string; inputs: string; irrigation: string; machinery: string;
    expenses: string; observations: string; blockers: string; reminders: string;
    completed: string; tapToAdd: string; youSaid: string; unsure: string;
    /** The card's title when the stored one is the form's own default ("Crop Activity"). */
    genericTitle: (stored: string) => string;
    listening: string; speakToRefine: string; editName: string;
    selfFamily: string; contract: string;
    male: (n: number) => string; female: (n: number) => string; workers: (n: number) => string;
    todayStaffUnknown: string; todayStaff: (n: number) => string;
    items: (n: number | undefined) => string; todayItems: (n: number) => string;
    todayRun: (h: number) => string; issueLogged: string;
    irrigationLine: (hours: number | undefined, method: string | undefined, source: string | undefined) => string;
    machineLine: (type: string | undefined, hours: number | undefined) => string; todayMachine: (h: number) => string;
    expenseTotal: (n: number) => string; todayExpenses: (n: number) => string;
    notes: (n: number) => string; reminderItems: (n: number) => string;
    plannedReminders: string; outcomePlaceholder: string; expenseAlt: string;
    /** A stoppage's sublabel when it gave no reason (`${group} Issue`). */
    issueOf: (group: string | undefined) => string;
    /** The stoppage sheet's subtitle: its kind. */
    disturbanceKind: (group: string | undefined) => string;
    scope: (scope: string | undefined) => string;
    reason: string; notSpecified: string; details: string; affectedAreas: string;
    segment: (seg: string) => string;
    youSaidSheet: string; interpretation: string;
    value: (v: string | number | undefined | null) => string;
    shown: (text: string | undefined) => string | undefined;
    workDone: WorkDoneLabels;
}

const titleCase = (seg: string): string => seg.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
/** Hours as the English card wrote them ("2h"), or '—' when none were stated. */
const enHours = (h: number | undefined): string => (typeof h === 'number' && Number.isFinite(h) ? `${h}h` : '—');

const EN: ActivityCardStrings = {
    language: 'en',
    work: 'Work Done', labour: 'Labour & Wages', inputs: 'Inputs & Protection', irrigation: 'Irrigation', machinery: 'Machinery',
    expenses: 'Expenses', observations: 'Observations / Notes', blockers: 'Issues & Blockers', reminders: 'Reminders',
    completed: 'Completed', tapToAdd: 'Tap to add details', youSaid: 'YOU SAID:', unsure: t('voice.unverifiedSourceLabel', 'en'),
    genericTitle: stored => stored,
    listening: 'Listening...', speakToRefine: 'Speak to refine', editName: 'Edit name',
    selfFamily: 'Self • Family Labour', contract: 'Contract',
    male: n => `${n}M`, female: n => `${n}F`, workers: n => `${n} Workers`,
    todayStaffUnknown: 'Today: — Staff (Logged)', todayStaff: n => `Today: ${n} Staff (Logged)`,
    // lane F1 (review S7): a value he did not state is left out or shown as '—', never "undefined".
    items: n => `${n ?? '—'} Items`, todayItems: n => `Today: ${n} Item(s) applied`,
    todayRun: h => `Today: ${h}h Total Run`, issueLogged: 'Issue Logged',
    irrigationLine: (h, m, s) => [enHours(h), m].filter(Boolean).join(' ') + (s ? ` • ${s}` : ''),
    machineLine: (type, h) => `${type || 'Machinery'} • ${enHours(h)}`, todayMachine: h => `Today: ${h}h Machine Work`,
    expenseTotal: n => `₹${n} Total`, todayExpenses: n => `Today: ₹${n} Total Expenses`,
    notes: n => `${n} Note(s)`, reminderItems: n => `${n} ITEM(S)`,
    plannedReminders: 'PLANNED REMINDERS', outcomePlaceholder: 'Outcome (e.g. 5 rows done)', expenseAlt: 'Expense',
    issueOf: group => `${group} Issue`,
    disturbanceKind: group => group || 'Disturbance',
    scope: s => (s === 'FULL_DAY' ? '🛑 Full Day Blocked' : s === 'PARTIAL' ? '⚠️ Partial Disruption' : '⏳ Delayed'),
    reason: 'Reason', notSpecified: 'Not specified', details: 'Details', affectedAreas: 'Affected Areas',
    segment: titleCase,
    youSaidSheet: '🎤 You Said', interpretation: 'Interpretation:',
    value: valueIn('en'), shown: inLanguage('en'),
    workDone: ENGLISH_WORK_DONE_LABELS,
};

const mrValue = valueIn('mr');
const PEOPLE = 'जण'; // PROPOSED (Marathi)
const HRS = 'तास'; // PROPOSED (Marathi)
const dash = (n: number | undefined): string => (typeof n === 'number' && Number.isFinite(n) ? String(n) : '—');
/** A stoppage's kind from its free-text group, in the APPROVED no-work-reason words (dfes.noWorkReason.*). */
const kindMr = (group: string | undefined): string => {
    const g = (group ?? '').toLowerCase();
    const key = g.includes('machin') ? 'machinery' : g.includes('electric') || g.includes('power') ? 'electricity'
        : g.includes('weather') || g.includes('rain') ? 'weather' : g.includes('water') ? 'water'
            : g.includes('labo') ? 'labour' : 'other';
    return t(`dfes.noWorkReason.${key}`, 'mr');
};
const SEGMENT_MR: Record<string, string> = {
    crop_activity: ring('work'), irrigation: ring('water'), labour: t('workSummary.labour', 'mr'), input: ring('inputs'), machinery: ring('machinery'),
};

const MR: ActivityCardStrings = {
    language: 'mr',
    // FOUNDER — the ring's labels; labour is APPROVED workSummary.labour ("मजुरी": the bucket is people and their wages).
    work: ring('work'), labour: t('workSummary.labour', 'mr'), inputs: ring('inputs'), irrigation: ring('water'), machinery: ring('machinery'),
    expenses: ring('expenses'), observations: ring('observations'), blockers: ring('blockers'), reminders: ring('reminders'),
    completed: 'झालं', // PROPOSED (Marathi) — the part was told, with no figures to show
    tapToAdd: 'दाबून माहिती भरा', // PROPOSED (Marathi)
    youSaid: 'तुम्ही म्हणालात:', // PROPOSED (Marathi)
    unsure: t('voice.unverifiedSourceLabel', 'mr'), // APPROVED
    genericTitle: () => 'आजचं काम', // PROPOSED (Marathi)
    listening: 'ऐकतोय...', // PROPOSED (Marathi)
    speakToRefine: 'बोलून बदला', // PROPOSED (Marathi)
    editName: 'नाव बदला', // PROPOSED (Marathi)
    selfFamily: 'स्वतः • घरचे', // PROPOSED (Marathi)
    contract: 'उक्ते', // PROPOSED (Marathi)
    male: n => `${n} ${t('workSummary.maleWorkers', 'mr')}`, // APPROVED word
    female: n => `${n} ${t('workSummary.femaleWorkers', 'mr')}`, // APPROVED word
    workers: n => `${n} ${PEOPLE}`,
    todayStaffUnknown: `आज: — ${PEOPLE}`, // PROPOSED (Marathi) — "—": nobody said how many (never a 0)
    todayStaff: n => `आज: ${n} ${PEOPLE} · ${AUTO}`, // PROPOSED (Marathi)
    items: n => `${dash(n)} वस्तू`, // PROPOSED (Marathi)
    todayItems: n => `आज: ${n} औषध / खत · ${AUTO}`, // PROPOSED (Marathi)
    todayRun: h => `आज: ${h} ${HRS} पाणी · ${AUTO}`, // PROPOSED (Marathi)
    issueLogged: 'अडचण सांगितली', // PROPOSED (Marathi)
    irrigationLine: (h, m, s) => [`${dash(h)} ${HRS}`, mrValue(m)].filter(Boolean).join(' ') + (mrValue(s) ? ` • ${mrValue(s)}` : ''),
    machineLine: (type, h) => `${mrValue(type) || ring('machinery')} • ${dash(h)} ${HRS}`,
    todayMachine: h => `आज: ${h} ${HRS} यंत्र · ${AUTO}`, // PROPOSED (Marathi)
    expenseTotal: n => `₹${n} · ${AUTO}`,
    todayExpenses: n => `आज: ₹${n} · ${AUTO}`, // PROPOSED (Marathi)
    notes: n => `${n} निरीक्षणं`, // PROPOSED (Marathi)
    reminderItems: n => `${n} कामं`, // PROPOSED (Marathi)
    plannedReminders: ring('reminders'),
    outcomePlaceholder: 'काय झालं (उदा. ५ ओळी पूर्ण)', // PROPOSED (Marathi)
    expenseAlt: ring('expenses'),
    issueOf: kindMr,
    disturbanceKind: kindMr,
    // PROPOSED (Marathi) — the three kinds of stoppage.
    scope: s => (s === 'FULL_DAY' ? '🛑 पूर्ण दिवस काम बंद' : s === 'PARTIAL' ? '⚠️ काही काम थांबलं' : '⏳ उशीर झाला'),
    reason: 'कारण', // PROPOSED (Marathi)
    notSpecified: '—', // P4: nothing was said
    details: 'तपशील', // PROPOSED (Marathi)
    affectedAreas: 'कशावर परिणाम झाला', // PROPOSED (Marathi)
    segment: seg => SEGMENT_MR[seg] ?? mrValue(seg),
    youSaidSheet: '🎤 तुम्ही म्हणालात', // PROPOSED (Marathi)
    interpretation: 'साथीला समजलं:', // PROPOSED (Marathi)
    value: mrValue, shown: inLanguage('mr'),
    // PROPOSED (Marathi) — the "work done" list under the card.
    workDone: {
        irrigationDone: 'पाणी दिलं',
        hours: n => `${n} ${HRS}`,
        litres: n => `${n} लिटर`,
        application: product => `${product} वापरलं`,
        input: ring('inputs'),
        waterLitres: n => `${n} लिटर पाणी`,
        labourDone: 'मजुरांचं काम',
        workers: n => `${n} ${PEOPLE}`,
        rupees: n => `₹${n}`,
        fuel: n => `इंधन ₹${n}`,
        machineUsed: type => `${mrValue(type) || ring('machinery')} वापरलं`,
        expenseRecorded: ring('expenses'),
        value: mrValue,
    },
};

export const activityCardStrings = (language: Language): ActivityCardStrings => (language === 'en' ? EN : MR);

/** The card's words in the chosen language. Outside the provider (tests, previews): the app's default, Marathi. */
export function useActivityCardStrings(): ActivityCardStrings {
    return activityCardStrings(useOptionalLanguage()?.language ?? 'mr');
}
