/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-136, D-137 Q10 = 1; register F224) - "यासाठी बनवलं": what a schedule was MADE FOR.
 *
 *   - variety: the app's own `varietyCatalog` (English names, shown as they are), without "Other" (the server stores only values from a short list);
 *   - soil type, region, climate: short OPTIONAL pick lists. Their codes and their Marathi / English labels are DATA in the contract's one list file
 *     (`sync-contract/schemas/schedule-made-for.json`, PROPOSED, unchecked by an agronomist): the server embeds the same file and checks the code.
 * Tags only: the phone never refuses a plot because of them (Q10 = 1) and the server never does.
 */
import lists from '../../../../../../../sync-contract/schemas/schedule-made-for.json';
import { getVarietiesForCrop, varietyCatalog } from '../../context/data/varietyCatalog';
import { UNKNOWN_CROP, scheduleCropCode } from '../../../infrastructure/reference/TemplateCatalog';
import type { MadeForKey } from './ownScheduleModel';

export type PickKey = Exclude<MadeForKey, 'variety'>;
export type MadeForLanguage = 'mr' | 'en';

export interface PickOption { code: string; label: string }

const CODES: Readonly<Record<PickKey, readonly string[]>> = { soilType: lists.soilType, region: lists.region, climate: lists.climate };
const LABELS: Readonly<Record<MadeForLanguage, Readonly<Record<PickKey, Readonly<Record<string, string>>>>>> = {
    mr: lists.labelsMr as Record<PickKey, Record<string, string>>,
    en: lists.labelsEn as Record<PickKey, Record<string, string>>,
};

/** The short list of one of the three pick items, in the file's order, with the label of the language shown. */
export function madeForOptions(key: PickKey, language: MadeForLanguage): PickOption[] {
    return CODES[key].map(code => ({ code, label: LABELS[language][key][code] ?? code }));
}

/** A code's label; a code the file does not list is shown as it is - never dropped, never guessed. */
export function tagLabel(key: MadeForKey, code: string, language: MadeForLanguage): string {
    if (key === 'variety') return code;
    return LABELS[language][key][code] ?? code;
}

/**
 * The varieties of a crop: the app's own catalog (read by THE crop rule, so "द्राक्ष" finds the grape list), without "Other"; any crop the catalog
 * does not list has the fallback (Local, Hybrid).
 */
export function varietiesFor(cropName: string): string[] {
    const code = scheduleCropCode(cropName);
    const key = code === UNKNOWN_CROP ? undefined : Object.keys(varietyCatalog).find(name => scheduleCropCode(name) === code);
    return getVarietiesForCrop(key ?? cropName).filter(v => v !== 'Other');
}
