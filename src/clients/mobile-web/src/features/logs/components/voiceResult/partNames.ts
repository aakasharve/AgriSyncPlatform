/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lanes RF2 / E1 / MIC-1) — a part's name and one entry's text in
 * the person's language, for the screens these lanes add (आढावा's chips, the "बदला" screen, the ONE mic's band).
 * Marathi: the result screen's own part names (REUSED from `PARTS`). English: PROPOSED (English).
 *
 * The entry text keeps a spray / fertiliser's amounts ("इथरेल · 350 मिली", the result screen's own chip shape):
 * `partEntriesOf` names the products only (the amounts live in the product box the result screen draws), and a changed
 * dose must read as a change.
 *
 * Lane RF2 fix pass (D4): the RF2 surfaces show what was understood, never his quoted source words ("“इथरेल 300 मिली
 * फवारणी केली”") — `withoutQuotes` drops them before the shared result-screen rows draw an entry.
 */
import { amountText, nameIsPhrase, productName, showsProducts } from './productModel';
import { PART_LABEL_EN, partMeta, type BlockerEntry, type PartEntry, type PartKey } from './resultModel';

/** The part's name in this language (Marathi: the result screen's own word). */
export const partNameIn = (part: PartKey, language: string | null | undefined): string =>
    (language === 'en' ? PART_LABEL_EN[part] : partMeta(part).label);

/**
 * What one entry says, as recorded: a spray / fertiliser's products with their amounts when they can be shown in this
 * language, else the entry's value, else his phrase; '' when there is nothing to show (the part's name stands for it).
 */
export function entryText(e: PartEntry, language: string | null | undefined): string {
    if (e.verified && showsProducts(e.products, language)) {
        const items = e.products.items
            .map(i => [productName(i, language), nameIsPhrase(i, language) ? '' : amountText(i.amount, language)].filter(Boolean).join(' · '))
            .filter(Boolean);
        if (items.length > 0) return items.join(', ');
    }
    return e.value ?? e.quote ?? '';
}

/**
 * A crop's name in this language, strictly (founder rule: Marathi mode = Marathi only). spec I18: ONE helper for the
 * whole app — `shared/names/namesIn.cropNameIn` (the founder's crop master: the server's English "Grapes" reads
 * "द्राक्ष" in Marathi mode and "Grapes" in English mode; a name the master does not know is shown as entered).
 */
export { cropNameIn } from '../../../../shared/names/namesIn';

/** The entries without his quoted source words (the RF2 surfaces show what was understood, not the quote). */
export const withoutQuotes = <T extends PartEntry | BlockerEntry>(entries: readonly T[]): T[] => entries.map(e => (e.quote ? { ...e, quote: undefined } : e));
