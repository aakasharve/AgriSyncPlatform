/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03 final design, row B4) — Sathi asks what a product was for. The phone
 * half of the server contract (branch task/plr-d10-sathi-product-q):
 *
 *   GET  /shramsafal/question-events/product-purposes?farmId=&dailyLogId=
 *        → { dailyLogId, mayAnswer, items: [{ inputEventId, mixIndex, productName, catalogProductId, statedReason,
 *            purposeStated, ask, answer }] }
 *   POST /shramsafal/question-events   (questionKey "product.purpose", one row per answer)
 *        200 { id } stored (the same answer again returns the same id) · 409 a different answer is already stored ·
 *        400 the product is not in the record · 403 he may not answer · 404 the farm is not his.
 *
 * Never throws: every way a call can end is an answer the card can act on. A let-go or a skip is NEVER sent — the server refuses it,
 * and the product must stay askable later.
 */
import { z } from 'zod';
import { apiFetch } from '../../../infrastructure/api/apiFetch';

export const PRODUCT_PURPOSE_QUESTION_KEY = 'product.purpose';
/** The server's limits on what an answer carries. */
export const PRODUCT_PURPOSE_RESPONSE_MAX = 2000;
export const PRODUCT_PURPOSE_PROMPT_MAX = 600;
/** A chip's code; "unknown" is माहीत नाही. */
export const PRODUCT_PURPOSE_CODE = /^[a-z0-9_]{1,64}$/;
export const PURPOSE_UNKNOWN_CODE = 'unknown';
/** A read that has not answered by then is given up (the card then simply does not show). */
export const PRODUCT_PURPOSE_READ_LIMIT_MS = 6_000;

const answerSchema = z.object({
    questionEventId: z.string().min(1),
    answerMode: z.string(),
    response: z.string().nullable().optional().transform(v => v ?? null),
    responseWithheld: z.boolean().optional().transform(v => v ?? false),
    answerCode: z.string().nullable().optional().transform(v => v ?? null),
    answeredByUserId: z.string().nullable().optional().transform(v => v ?? null),
    answeredAtUtc: z.string().nullable().optional().transform(v => v ?? null),
    counts: z.unknown().optional(),
});

const itemSchema = z.object({
    inputEventId: z.string().min(1),
    mixIndex: z.number().int().min(0),
    productName: z.string(),
    catalogProductId: z.string().nullable().optional().transform(v => v ?? null),
    statedReason: z.string().nullable().optional().transform(v => v ?? null),
    purposeStated: z.boolean(),
    ask: z.boolean(),
    answer: answerSchema.nullable().optional().transform(v => v ?? null),
});

const purposesSchema = z.object({
    dailyLogId: z.string().min(1),
    mayAnswer: z.boolean(),
    items: z.array(itemSchema),
});

export type ProductPurposeAnswer = z.infer<typeof answerSchema>;
export type ProductPurposeItem = z.infer<typeof itemSchema>;
export type ProductPurposes = z.infer<typeof purposesSchema>;

export type ProductPurposesRead =
    | { kind: 'ok'; data: ProductPurposes }
    /** 403: he may not answer; 404: not his farm. Either way no card. */
    | { kind: 'refused'; status: number }
    /** Anything else (offline, a slow or old server, a body we cannot read): no card, nothing claimed. */
    | { kind: 'failed' };

export async function fetchProductPurposes(farmId: string, dailyLogId: string, limitMs = PRODUCT_PURPOSE_READ_LIMIT_MS): Promise<ProductPurposesRead> {
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), limitMs);
    try {
        const path = `/shramsafal/question-events/product-purposes?farmId=${encodeURIComponent(farmId)}&dailyLogId=${encodeURIComponent(dailyLogId)}`;
        const res = await apiFetch(path, { method: 'GET', signal: timeout.signal });
        if (res.status === 403 || res.status === 404) return { kind: 'refused', status: res.status };
        if (!res.ok) return { kind: 'failed' };
        const parsed = purposesSchema.safeParse(await res.json());
        return parsed.success ? { kind: 'ok', data: parsed.data } : { kind: 'failed' };
    } catch {
        return { kind: 'failed' };
    } finally {
        clearTimeout(timer);
    }
}

/** One real answer: a tapped chip (its code and its shown words) or his own spoken words. */
export type ProductPurposeAnswerInput = {
    farmId: string;
    dailyLogId: string;
    inputEventId: string;
    mixIndex: number;
    /** The question exactly as shown. */
    promptText: string;
} & ({ mode: 'chip'; code: string; words: string } | { mode: 'voice'; words: string });

export type ProductPurposePost =
    | { kind: 'stored'; id: string }
    /** 409: a different answer was already stored — read it back and show it. */
    | { kind: 'conflict' }
    /** 400: the product is not (or no longer) in the record. */
    | { kind: 'notInRecord' }
    /** 403 / 404: he may not answer here. */
    | { kind: 'refused'; status: number }
    /** Not kept (offline, a server fault, words that cannot be sent): he may try again. */
    | { kind: 'failed' };

/** The POST body. Exported for the tests: a let-go or skip has no way to be built. */
export function productPurposeBody(input: ProductPurposeAnswerInput): Record<string, unknown> | null {
    const words = input.words.trim().slice(0, PRODUCT_PURPOSE_RESPONSE_MAX);
    if (!words) return null; // never a blank answer
    if (input.mode === 'chip' && !PRODUCT_PURPOSE_CODE.test(input.code)) return null;
    return {
        farmId: input.farmId,
        plotId: null,
        dailyLogId: input.dailyLogId,
        questionKey: PRODUCT_PURPOSE_QUESTION_KEY,
        inputEventId: input.inputEventId,
        mixIndex: input.mixIndex,
        answerMode: input.mode,
        answerCode: input.mode === 'chip' ? input.code : null,
        response: words,
        skipped: false,
        marathiApproved: true,
        promptOrigin: 'pattern',
        promptText: input.promptText.trim().slice(0, PRODUCT_PURPOSE_PROMPT_MAX),
        lookLineIds: [],
        // Everything else the endpoint knows is null for this question.
        crop: null, expectedStage: null, actualStageApplicability: null, anchorDateType: null, triggerType: null, questionType: null,
        lens: null, depthLevel: null, priority: null, cooldown: null, answerModes: null, safetyClass: null, agronomistApproved: null,
        bankVersion: null, questionEngineVersion: null, answerObservationId: null, shownAtUtc: null, triggerReason: null,
        weatherContext: null, stageConfirmed: null, photoSubmitted: null, scheduleCardRef: null, deviationReasonCode: null,
        deviationChallenge: null, photoAttachmentId: null,
    };
}

export async function postProductPurposeAnswer(input: ProductPurposeAnswerInput): Promise<ProductPurposePost> {
    const body = productPurposeBody(input);
    if (!body) return { kind: 'failed' };
    try {
        const res = await apiFetch('/shramsafal/question-events', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (res.status === 409) return { kind: 'conflict' };
        if (res.status === 400) return { kind: 'notInRecord' };
        if (res.status === 403 || res.status === 404) return { kind: 'refused', status: res.status };
        if (!res.ok) return { kind: 'failed' };
        const id = await res.json().then((b: { id?: unknown }) => (typeof b?.id === 'string' ? b.id : null), () => null);
        return id ? { kind: 'stored', id } : { kind: 'failed' };
    } catch {
        return { kind: 'failed' };
    }
}
