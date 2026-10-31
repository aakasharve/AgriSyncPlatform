/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I18) — the ONE language-aware display helper for the names
 * the app shows but did not write in his language: crops, crop stages, schedules and their tasks, work types and
 * error messages. Founder rule (2026-10-26): "in English only show English and in Marathi it must show Marathi
 * strictly every where".
 *
 * Every screen asks here; the word lists stay where they already lived and are not copied:
 *   - crops: the founder's crop master (`domain/crops/cropMaster`, 310 crops, EN + MR + alternate names);
 *   - stages: `shared/utils/stageNameMr` (one table for the whole app);
 *   - schedules and their tasks: `features/scheduler/schedulePage/scheduleNames`;
 *   - work types: the table below;
 *   - errors: `readableError` (the recorder's messages) and `errorWords` (any other failure, read by its code).
 *
 * What is NEVER translated or rewritten: text a person typed or said (a plot's name, a crop he typed that the
 * list does not know, an expert's own schedule) — it is shown as entered, in both languages. A stored value is
 * never changed: these functions only decide what is SHOWN.
 */
import { cropLabel, resolveCrop } from '../../domain/crops/cropMaster';
import { stageNameEn, stageNameMr } from '../utils/stageNameMr';
import { scheduleNameMr, taskNameMr } from '../../features/scheduler/schedulePage/scheduleNames';
import { readableError } from '../../features/voice/components/recorder/recorderWords';
import { farmerErrorText } from './errorWords';

type Lang = string | null | undefined;
const isEn = (language: Lang): boolean => language === 'en';
const clean = (s: string | null | undefined): string => (s ?? '').trim();
const LATIN = /[A-Za-z]/;
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A crop's name in this language. The crop is read by its MHCR id where known, else by its stored name (any of
 * the master's names, either language); its canonical name in this language is shown. A name the master does
 * not know (or that two different crops share) is the farmer's own text: shown as entered.
 */
export function cropNameIn(name: string | null | undefined, language: Lang, masterId?: string | null): string {
    const n = clean(name);
    const row = resolveCrop({ masterId, name: n });
    const shown = row ? cropLabel(row, isEn(language) ? 'en' : 'mr') : '';
    return shown || n;
}

/**
 * A crop stage's name in this language, or '' when there is nothing true to show (a sentinel such as
 * "unstated", or a name neither table knows in a language it is not written in). A stage written by a person in
 * Marathi is his schedule's own word: shown as written in Marathi mode, and in English mode only when no English
 * name is known for it.
 */
export function stageNameIn(name: string | null | undefined, language: Lang, code?: string | null): string {
    if (isEn(language)) {
        const en = stageNameEn(name, code);
        if (en) return en;
        const raw = clean(name);
        return raw && DEVANAGARI.test(raw) ? raw : '';
    }
    return stageNameMr(name, code) ?? '';
}

/** A schedule's own name: the ones the app ships are said in Marathi in Marathi mode; any other is shown as written. */
export const scheduleNameIn = (name: string | null | undefined, language: Lang): string =>
    (isEn(language) ? clean(name) : scheduleNameMr(clean(name)));

/** A schedule task's name: the shipped catalog's words in Marathi in Marathi mode; any other as written. */
export const taskNameIn = (name: string | null | undefined, language: Lang): string =>
    (isEn(language) ? clean(name) : taskNameMr(clean(name)));

/**
 * The work types the parser, the schedules and the farm's own work list store (in English), with their Marathi.
 * PROPOSED (Marathi) unless marked; the English is the app's own value, title-cased. Keys are compared without case,
 * spaces or underscores ("leaf_removal" = "Leaf Removal").
 */
const WORK_TYPES: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    // [English shown, Marathi shown, other stored spellings]
    ['Spraying', 'फवारणी', ['spray', 'foliar spray', 'pesticide spray']], // app word (CATEGORY_LABEL_MR.FOLIAR_SPRAY)
    ['Weeding', 'खुरपणी', ['manual weeding', 'hoeing', 'निंदणी']],
    ['Pruning', 'छाटणी', ['prune']],
    ['Leaf removal', 'पाने काढणे', ['leaf removal', 'defoliation']],
    ['Tillage', 'नांगरणी', ['ploughing', 'plowing', 'tilling']],
    ['Irrigation', 'पाणी देणे', ['watering']],
    ['Fertigation', 'ठिबकमधून खत', []],
    ['Fertilizer application', 'खत देणे', ['fertilizing', 'fertiliser application', 'fertilizer', 'manuring']],
    ['Harvesting', 'काढणी', ['harvest']],
    ['Planting', 'लागवड', ['plantation']],
    ['Sowing', 'पेरणी', []],
    ['Transplanting', 'पुनर्लागवड', []],
    ['Mulching', 'आच्छादन', ['mulch']],
    ['Thinning', 'विरळणी', []],
    ['Tying', 'बांधणी', ['tying up']],
    ['Earthing up', 'भर देणे', ['earthing']],
    ['Inspection', 'पाहणी', ['monitoring', 'scouting', 'field inspection']],
    ['Cleaning', 'साफसफाई', ['cleanup', 'clean up']],
    ['Bahar treatment', 'बहार धरणे', []],
    ['Grafting', 'कलम करणे', []],
    ['Gap filling', 'नांगे भरणे', ['gap fill']],
    ['Soil work', 'मातीची कामे', ['soil work', 'soil preparation']],
    ['Other', 'इतर', []],
];
const keyOf = (value: string): string => value.normalize('NFC').toLowerCase().replace(/[_\s]+/g, ' ').trim();
const WORK_BY_KEY = new Map<string, readonly [string, string]>();
for (const [en, mr, others] of WORK_TYPES) {
    for (const k of [en, mr, ...others]) if (!WORK_BY_KEY.has(keyOf(k))) WORK_BY_KEY.set(keyOf(k), [en, mr]);
}

/**
 * A work type in this language ("Spraying" ↔ "फवारणी"). A work type the table does not know is someone's own
 * word: shown as entered when it is written in this language's script, else '' with `strict` (the caller then
 * shows his phrase or the part's name), else as entered.
 */
export function workTypeNameIn(value: string | null | undefined, language: Lang, opts: { strict?: boolean } = {}): string {
    const v = clean(value);
    if (!v) return '';
    const hit = WORK_BY_KEY.get(keyOf(v));
    if (hit) return isEn(language) ? hit[0] : hit[1];
    if (!opts.strict) return v;
    const ownScript = isEn(language) ? !DEVANAGARI.test(v) : DEVANAGARI.test(v) || !LATIN.test(v);
    return ownScript ? v : '';
}

/**
 * An error the farmer can read, in his language: never a server's English sentence in Marathi mode. The recorder's
 * own messages (a string from the voice path) go through `readableError`; any other failure (a thrown error, an HTTP
 * refusal with its `{ error: code }`, no network) is read by its code / status into one plain sentence.
 */
export const errorTextIn = (error: unknown, language: Lang): string =>
    (typeof error === 'string' ? readableError(clean(error), language) : farmerErrorText(error, language));
