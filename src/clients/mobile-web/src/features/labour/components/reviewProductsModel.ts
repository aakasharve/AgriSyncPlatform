/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 2b; IT3 Task 3a; founders D-92, D-95) - the products of a record on
 * its review card. Pure. It reads and never writes (P7): the record's dose, quantity, product name and date are not touched.
 *
 *   - WHICH products and what has been answered come from the server's approval list (`ReviewItem.products`): the server decides
 *     whether this reader may hear the record's words (a reader who may not gets none, and nothing is drawn). The speaker's own
 *     answer and the check are kept apart; the speaker's stays HIS.
 *   - The doses he SAID are shown only when this phone holds the record itself (the same rows the result screen draws); otherwise
 *     the row is his word for the product and nothing more - no dose is made up (P4).
 *   - Answers made on THIS phone and not sent yet are laid over the server's, so the row changes the moment he taps, offline too. A
 *     checker's own pending answer on someone else's record is shown as the check (the server will make it the check the same
 *     way - the phone never sends "is check", D-95). It is a picture of what the server will do, not a claim about the record.
 *   - Checking is optional everywhere and never blocks मंजूर (P9): the count is a count, not a gate.
 */
import type { DailyLog, InputIdentityAnswer } from '../../../domain/types/log.types';
import type { ReviewItem, ReviewProduct, ReviewProductAnswer } from '../labour.types';
import { mergeInputIdentities } from '../../sync/pull/reconcilers/inputIdentityReconciler';
import { productBoxesOf, type ProductItem } from '../../logs/components/voiceResult/productModel';
import { answersOf } from '../../logs/components/voiceResult/inputIdentityModel';

/** One server answer as the phone's own answer shape. The assertion id is the server's place for it, not a queue id. */
function asAnswer(p: ReviewProduct, a: ReviewProductAnswer, isCheck: boolean): InputIdentityAnswer {
    return {
        assertionId: `server:${p.inputEventId}:${p.mixIndex}:${isCheck ? 'check' : 'speaker'}`,
        inputEventId: p.inputEventId,
        mixIndex: p.mixIndex,
        verdict: a.verdict,
        ...(a.catalogProductId ? { catalogProductId: a.catalogProductId } : {}),
        ...(a.attachmentId ? { attachmentId: a.attachmentId } : {}),
        catalogVersion: '',
        assertedByUserId: a.assertedByUserId,
        assertedAtUtc: a.assertedAtUtc,
        isCheck,
    };
}

/** The server's answers about every product of the card. */
export function serverAnswersOf(products: readonly ReviewProduct[]): InputIdentityAnswer[] {
    return products.flatMap(p => [
        ...(p.speakerAnswer ? [asAnswer(p, p.speakerAnswer, false)] : []),
        ...(p.check ? [asAnswer(p, p.check, true)] : []),
    ]);
}

/** One row per server product: the record's own row (with the doses he said) when this phone holds it, else his word and nothing more. */
export function reviewProductItems(products: readonly ReviewProduct[], localLog: DailyLog | undefined): ProductItem[] {
    const local = new Map<string, ProductItem>();
    for (const box of localLog ? productBoxesOf(localLog) : []) {
        for (const item of box.items) if (item.ref) local.set(`${item.ref.eventId}#${item.ref.mixIndex}`, item);
    }
    return products.map(p => local.get(`${p.inputEventId}#${p.mixIndex}`) ?? {
        id: `${p.inputEventId}:${p.mixIndex}`,
        said: p.spokenName,
        label: p.spokenName,
        matchName: p.spokenName,
        ref: { eventId: p.inputEventId, mixIndex: p.mixIndex },
    });
}

export interface HolderFacts {
    /** The signed-in person (the answers on this phone are his). */
    viewerUserId: string | null;
    /** He holds the confirm-records authority: his answer on someone else's record is the check. */
    canCheck: boolean;
}

/**
 * The answers this card shows: the server's, with this phone's not-yet-sent ones laid over. A checker's own pending answer on a
 * record another person made stands in the check slot (never his own record's: that is the speaker's answer).
 */
export function mergedAnswers(products: readonly ReviewProduct[], localLog: DailyLog | undefined, who: HolderFacts): InputIdentityAnswer[] {
    const maker = localLog?.meta?.createdByOperatorId ?? null;
    const viewerMadeIt = !!who.viewerUserId && maker === who.viewerUserId;
    const local = (localLog?.inputIdentities ?? []).map(a =>
        a.pending === true && who.canCheck && !viewerMadeIt && !!who.viewerUserId && a.assertedByUserId === who.viewerUserId
            ? { ...a, isCheck: true }
            : a);
    return mergeInputIdentities(local, serverAnswersOf(products));
}

/**
 * The record the product rows read their answers from: this phone's own record with the merged answers when it holds one, else a bare
 * holder of the answers (the rows read nothing else from it).
 */
export function answerHolderOf(item: ReviewItem, localLog: DailyLog | undefined, answers: readonly InputIdentityAnswer[]): DailyLog {
    if (localLog) return { ...localLog, inputIdentities: [...answers] };
    return { id: item.id, inputIdentities: [...answers] } as unknown as DailyLog;
}

/** How many of the card's products no checker has checked yet (a check of any kind counts; the speaker's own answer does not). */
export function uncheckedOf(items: readonly ProductItem[], holder: DailyLog): number {
    return items.filter(i => i.ref && !answersOf(holder, i.ref).check).length;
}

/** The same count straight from a card: 0 when the card carries no products (nothing to check, nothing to say). */
export function productsLeftToCheck(item: ReviewItem, localLog: DailyLog | undefined, who: HolderFacts): number {
    if (!item.products || item.products.length === 0) return 0;
    const holder = answerHolderOf(item, localLog, mergedAnswers(item.products, localLog, who));
    return uncheckedOf(reviewProductItems(item.products, localLog), holder);
}
