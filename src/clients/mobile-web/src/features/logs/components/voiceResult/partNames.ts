/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF2 / E1 / MIC-1) — a part's name and one entry's text in
 * the person's language, for the screens these lanes add (आढावा's chips, the "बदला" screen, the ONE mic's band).
 * Marathi: the result screen's own part names (REUSED from `PARTS`). English: PROPOSED (English).
 *
 * The entry text keeps a spray / fertiliser's amounts ("इथरेल · 350 मिली"): `partEntriesOf` names the products only
 * (the amounts live in the product box the result screen draws), and a changed dose must read as a change.
 */
import { cropWordMr } from '../../../scheduler/schedulePage/scheduleNames';
import { amountText, nameIsPhrase, productName, showsProducts } from './productModel';
import { partMeta, type PartEntry, type PartKey } from './resultModel';

const EN: Record<PartKey, string> = {
    crop: 'Crop work', // PROPOSED (English)
    labour: 'Labour', // PROPOSED (English)
    irrigation: 'Water', // PROPOSED (English)
    inputs: 'Sprays / fertiliser', // PROPOSED (English)
    expense: 'Expenses', // PROPOSED (English)
    machinery: 'Machines', // PROPOSED (English)
    observation: 'Observation', // PROPOSED (English)
    planned: 'Planned work', // PROPOSED (English)
};

/** The part's name in this language (Marathi: the result screen's own word). */
export const partNameIn = (part: PartKey, language: string | null | undefined): string =>
    (language === 'en' ? EN[part] : partMeta(part).label);

/**
 * What one entry says, as recorded: a spray / fertiliser's products with their amounts when they can be shown in this
 * language, else the entry's value, else his phrase; '' when there is nothing to show (the part's name stands for it).
 */
export function entryText(e: PartEntry, language: string | null | undefined): string {
    if (e.verified && showsProducts(e.products, language)) {
        const items = e.products.items
            .map(i => [productName(i, language), nameIsPhrase(i, language) ? '' : amountText(i.amount, language)].filter(Boolean).join(' '))
            .filter(Boolean);
        if (items.length > 0) return items.join(', ');
    }
    return e.value ?? e.quote ?? '';
}

const LATIN = /[A-Za-z]/;
const DEVANAGARI = /[ऀ-ॿ]/;

/**
 * A crop's name in this language, strictly (founder rule: Marathi mode = Marathi only). The server keeps crop names in
 * English: Marathi mode shows the app's Marathi word for a crop it ships ("Grapes" → "द्राक्ष"), a name already in
 * Marathi as written, and otherwise nothing (the plot's own name says where). English mode shows a name in English
 * letters, and nothing for one in Marathi only.
 */
export function cropNameIn(name: string | undefined, language: string | null | undefined): string {
    const n = (name ?? '').trim();
    if (!n) return '';
    if (language === 'en') return LATIN.test(n) ? n : '';
    return cropWordMr(n) ?? (DEVANAGARI.test(n) ? n : '');
}
