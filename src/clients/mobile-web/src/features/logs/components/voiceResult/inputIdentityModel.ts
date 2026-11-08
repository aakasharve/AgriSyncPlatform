/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92, D-93, D-95) - what the result screen says
 * about ONE product of a saved record: which library product it is, what has been answered about it, and who may check it.
 * Pure. It reads the record and never changes it (P7).
 *
 *   - Identity comes from the library by EXACT match only (`matchProduct`): a near spelling is not found, a shared name is
 *     ambiguous. There is no pick-from-list yet, so an unknown or ambiguous product can only get a photo or "माहीत नाही".
 *   - An answer (हो / नाही / फोटो) is an overlay on the record (`DailyLog.inputIdentities`). The speaker's own answer is kept as
 *     HIS ("सुनीलने सांगितलं"); only a holder of the confirm-records authority gives the CHECK, and that is the SERVER's word
 *     (`isCheck`), never the phone's (D-95). Nothing here blocks saving or confirming (P9).
 *   - A photo reads "फोटो ठेवला" and counts half (D-93); nothing here says the packet will be read (P5).
 */
import type { DailyLog, InputIdentityAnswer } from '../../../../domain/types/log.types';
import {
    getProduct,
    matchProduct,
    type CatalogBenefit,
    type CatalogProduct,
    type ProductCategory,
} from '../../../../domain/inputs/inputCatalog';
import type { ProductItem } from './productModel';

export type ItemIdentity =
    | { state: 'found'; product: CatalogProduct }
    | { state: 'ambiguous' }
    | { state: 'notFound' };

/** The name the library is asked about: the record's `mix[]` name, else his word, else the parser's label. */
const nameForMatching = (item: ProductItem): string => (item.matchName ?? item.said ?? item.label ?? '').trim();

/** Which library product this item is, by exact match. */
export function identityOf(item: ProductItem): ItemIdentity {
    const name = nameForMatching(item);
    if (!name) return { state: 'notFound' };
    const m = matchProduct(name, item.npkGrade ?? null);
    if (m.state === 'found' && m.productId) {
        const product = getProduct(m.productId);
        if (product) return { state: 'found', product };
    }
    return m.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'notFound' };
}

export type TypeKey = ProductCategory | 'unknown';

export const typeKeyOf = (identity: ItemIdentity): TypeKey => (identity.state === 'found' ? identity.product.category : 'unknown');

/** The founder's colours (Option 3): बुरशीनाशक sky, कीटकनाशक pink, तणनाशक orange, वाढ नियंत्रक emerald, खत violet, unknown dashed stone. */
export const TYPE_STYLE: Readonly<Record<TypeKey, { pill: string; edge: string; soft: string }>> = {
    fungicide: { pill: 'bg-sky-100 text-sky-900 ring-sky-300', edge: 'border-l-sky-500', soft: 'bg-sky-50' },
    insecticide: { pill: 'bg-pink-100 text-pink-900 ring-pink-300', edge: 'border-l-pink-500', soft: 'bg-pink-50' },
    herbicide: { pill: 'bg-orange-100 text-orange-900 ring-orange-300', edge: 'border-l-orange-500', soft: 'bg-orange-50' },
    pgr: { pill: 'bg-emerald-100 text-emerald-900 ring-emerald-300', edge: 'border-l-emerald-500', soft: 'bg-emerald-50' },
    fertilizer: { pill: 'bg-violet-100 text-violet-900 ring-violet-300', edge: 'border-l-violet-500', soft: 'bg-violet-50' },
    unknown: { pill: 'bg-stone-100 text-stone-700 ring-stone-300', edge: 'border-l-stone-400', soft: 'bg-stone-50' },
};

export interface ItemAnswers {
    /** The speaker's own answer (kept as his). */
    speaker?: InputIdentityAnswer;
    /** The check, given by a holder of the confirm-records authority (the server's word). */
    check?: InputIdentityAnswer;
}

const at = (a: InputIdentityAnswer): number => {
    const t = Date.parse(a.assertedAtUtc);
    return Number.isFinite(t) ? t : 0;
};

/** The newest answer of each kind about this product of this record. */
export function answersOf(log: DailyLog | undefined, ref: ProductItem['ref']): ItemAnswers {
    if (!log || !ref) return {};
    const mine = (log.inputIdentities ?? []).filter(a => a.inputEventId === ref.eventId && a.mixIndex === ref.mixIndex);
    const newest = (isCheck: boolean, keep: (a: InputIdentityAnswer) => boolean = () => true): InputIdentityAnswer | undefined =>
        mine.filter(a => a.isCheck === isCheck && keep(a)).sort((x, y) => at(y) - at(x))[0];
    const speaker = newest(false);
    const check = newest(true);
    // The check is the SERVER's word. Until it answers, a NEWER answer made on this phone by the person who gave that check stands
    // in the check slot (the server will make it the check the same way) - his old check must not outvote his new word.
    if (check && speaker?.pending && speaker.assertedByUserId && speaker.assertedByUserId === check.assertedByUserId && at(speaker) > at(check)) {
        return { speaker: newest(false, a => !a.pending), check: speaker };
    }
    return { speaker, check };
}

export type ItemStatus =
    /** No place in the record to answer about (a one-line input): shown, never asked. */
    | { kind: 'plain' }
    | { kind: 'notFound' | 'ambiguous'; photo: boolean }
    /** A checker with nothing answered yet: "हेच का? तपासा". */
    | { kind: 'ask' }
    /** Someone who is not a checker, nothing answered yet: "मालक तपासतील". */
    | { kind: 'ownerWillCheck' }
    | { kind: 'checked'; verdict: InputIdentityAnswer['verdict']; byUserId: string | null }
    | { kind: 'said'; verdict: InputIdentityAnswer['verdict']; byUserId: string | null };

/** What a row says about its product, for a viewer who is (or is not) a checker. */
export function statusOf(identity: ItemIdentity, item: ProductItem, answers: ItemAnswers, canCheck: boolean): ItemStatus {
    if (identity.state !== 'found') {
        return { kind: identity.state, photo: !!(answers.check?.verdict === 'photo' || answers.speaker?.verdict === 'photo') };
    }
    if (!item.ref) return { kind: 'plain' };
    if (answers.check) return { kind: 'checked', verdict: answers.check.verdict, byUserId: answers.check.assertedByUserId ?? null };
    if (answers.speaker) return { kind: 'said', verdict: answers.speaker.verdict, byUserId: answers.speaker.assertedByUserId ?? null };
    return canCheck ? { kind: 'ask' } : { kind: 'ownerWillCheck' };
}

/** May this item be answered about at all (it has a place in the record the server can read)? */
export const isAnswerable = (item: ProductItem): boolean => !!item.ref;

/**
 * The sourced benefit line for the crop, shown ONLY when (1) a person has ticked it (`checkedBy`, doctrine P4: nothing
 * invented) and (2) he said "हो, हेच" about this product. It carries the "इंटरनेटवरून" mark wherever it is shown.
 */
export function benefitFor(
    product: CatalogProduct,
    cropNames: readonly string[],
    answers: ItemAnswers,
): CatalogBenefit | undefined {
    const yes = answers.check?.verdict === 'confirmed' || answers.speaker?.verdict === 'confirmed';
    if (!yes) return undefined;
    const crops = cropNames.map(c => c.trim().toLowerCase()).filter(Boolean);
    return (product.benefits ?? []).find(b =>
        typeof b.checkedBy === 'string' && b.checkedBy.trim().length > 0
        && crops.some(c => c.includes(b.crop.trim().toLowerCase())));
}
