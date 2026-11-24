/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT4 Task 2; founders D-92, D-93, D-95) - what the result screen says
 * about ONE product of a saved record: which library product it is, what has been answered about it, and who may check it.
 * Pure. It reads the record and never changes it (P7).
 *
 *   - Identity comes from the library by EXACT match (`matchProduct`): a near spelling is not found, a shared name is
 *     ambiguous. A name that is not found may be offered the library names that SOUND like it (`nearProducts`, lane FACTS-2); it is
 *     only a suggestion - the product counts as found only when HE taps one (his "हो, हेच" answer names it), and then it says so.
 *     Without a tap an unknown or ambiguous product can only get a photo or "माहीत नाही".
 *   - An answer (हो / नाही / फोटो) is an overlay on the record (`DailyLog.inputIdentities`). The speaker's own answer is kept as
 *     HIS ("सुनीलने सांगितलं"); only a holder of the confirm-records authority gives the CHECK, and that is the SERVER's word
 *     (`isCheck`), never the phone's (D-95). Nothing here blocks saving or confirming (P9).
 *   - A photo reads "फोटो ठेवला" and counts half (D-93); nothing here says the packet will be read (P5).
 */
import type { DailyLog, InputIdentityAnswer } from '../../../../domain/types/log.types';
import {
    getProduct,
    matchProduct, normaliseNpkGrade,
    type CatalogBenefit,
    type CatalogProduct,
    type ProductCategory,
} from '../../../../domain/inputs/inputCatalog';
import type { ProductItem } from './productModel';

export type ItemIdentity =
    /** `byPick`: the library did not know his word exactly; he tapped this product from the names that sound like it (lane FACTS-2). */
    | { state: 'found'; product: CatalogProduct; byPick?: true }
    | { state: 'ambiguous' }
    | { state: 'notFound' };

/** The name the library is asked about: the record's `mix[]` name, else his word, else the parser's label. */
export const nameForMatching = (item: ProductItem): string => (item.matchName ?? item.said ?? item.label ?? '').trim();

/**
 * The library product he PICKED for this item when his word did not match exactly (lane FACTS-2, "did you mean"): the newest answer that
 * counts - the check when there is one, else his own - when it is a "हो, हेच" naming a product the library holds. A "नाही" or a photo
 * is no pick. Null when there is none. It reads the answers and never changes the record (P7).
 */
export function pickedProductOf(answers: ItemAnswers | undefined): CatalogProduct | null {
    const counting = answers?.check ?? answers?.speaker;
    if (!counting || counting.verdict !== 'confirmed' || !counting.catalogProductId) return null;
    return getProduct(counting.catalogProductId) ?? null;
}

/**
 * Which library product this item is: by exact match first. Only when his word is not known exactly (or is shared by several products)
 * does his own tap on a "did you mean" name stand in - and then it says so (`byPick`), so the screen never claims the library matched.
 */
export function identityOf(item: ProductItem, answers?: ItemAnswers): ItemIdentity {
    const name = nameForMatching(item);
    const m = name ? matchProduct(name, item.npkGrade ?? null) : { state: 'notFound' as const, productId: null };
    if (m.state === 'found' && m.productId) {
        const product = getProduct(m.productId);
        if (product) return { state: 'found', product };
    }
    const picked = pickedProductOf(answers);
    if (picked) return { state: 'found', product: picked, byPick: true };
    return m.state === 'ambiguous' ? { state: 'ambiguous' } : { state: 'notFound' };
}

export type TypeKey = ProductCategory | 'unknown';

export const typeKeyOf = (identity: ItemIdentity): TypeKey => (identity.state === 'found' ? identity.product.category : 'unknown');

/** A name that is nothing but an N-P-K grade ("0-52-34", "12:61:00", "००:५२:३४"), read with the phone's own grade reader. */
const isGradeName = (name: string): boolean => /^[0-9०-९\s:.\-–/]+$/.test(name) && normaliseNpkGrade(name) !== null;

/**
 * The product's type for the screen: the library's category when it is found; else "fertiliser" when the name is an N-P-K grade
 * (a grade is only ever a fertiliser); else 'unknown' - and an unknown type shows NO chip at all (no claim either way).
 */
export const typeKeyOfItem = (item: ProductItem, identity: ItemIdentity): TypeKey => {
    const key = typeKeyOf(identity);
    return key === 'unknown' && (isGradeName(nameForMatching(item)) || isGradeName((item.npkGrade ?? '').trim())) ? 'fertilizer' : key;
};

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
