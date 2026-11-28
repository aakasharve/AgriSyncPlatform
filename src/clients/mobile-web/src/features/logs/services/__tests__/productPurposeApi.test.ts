/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (Part 03, row B4) — the product-purpose client against the server contract: what
 * is read, what is sent, how every reply ends, and that a blank answer or a let-go has no way to be sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: h.apiFetch }));

import { fetchProductPurposes, postProductPurposeAnswer, productPurposeBody, PRODUCT_PURPOSE_PROMPT_MAX, PRODUCT_PURPOSE_RESPONSE_MAX } from '../productPurposeApi';

const reply = (status: number, body?: unknown) => ({
    ok: status >= 200 && status < 300, status,
    json: async () => { if (body === undefined) throw new Error('no body'); return body; },
}) as unknown as Response;

const chip = { farmId: 'farm-1', dailyLogId: 'log-1', inputEventId: 'ev-1', mixIndex: 2, promptText: 'युथेन एम-45 कोणत्या रोगासाठी मारलं?', mode: 'chip' as const, code: 'lateblight', words: 'उशिराचा करपा' };

beforeEach(() => { h.apiFetch.mockReset(); });

describe('fetchProductPurposes', () => {
    it('reads the record\'s products and their answers', async () => {
        h.apiFetch.mockResolvedValue(reply(200, {
            dailyLogId: 'log-1', mayAnswer: true,
            items: [{ inputEventId: 'ev-1', mixIndex: 0, productName: 'Uthane M-45', catalogProductId: null, statedReason: null, purposeStated: false, ask: true,
                answer: { questionEventId: 'q', answerMode: 'voice', response: null, responseWithheld: true, answerCode: null, answeredByUserId: 'u', answeredAtUtc: '2026-11-28T06:00:00Z', counts: {} } }],
        }));
        const r = await fetchProductPurposes('farm 1', 'log/1');
        expect(h.apiFetch.mock.calls[0][0]).toBe('/shramsafal/question-events/product-purposes?farmId=farm%201&dailyLogId=log%2F1');
        expect(r.kind).toBe('ok');
        if (r.kind === 'ok') {
            expect(r.data.items[0].answer).toMatchObject({ responseWithheld: true, response: null });
        }
    });

    it.each([403, 404])('%s is a refusal (no card)', async (status) => {
        h.apiFetch.mockResolvedValue(reply(status));
        expect(await fetchProductPurposes('f', 'l')).toEqual({ kind: 'refused', status });
    });

    it('a server fault, a body it cannot read, or no network is "failed", never a throw', async () => {
        h.apiFetch.mockResolvedValueOnce(reply(500));
        expect(await fetchProductPurposes('f', 'l')).toEqual({ kind: 'failed' });
        h.apiFetch.mockResolvedValueOnce(reply(200, { items: 'nope' }));
        expect(await fetchProductPurposes('f', 'l')).toEqual({ kind: 'failed' });
        h.apiFetch.mockRejectedValueOnce(new Error('offline'));
        expect(await fetchProductPurposes('f', 'l')).toEqual({ kind: 'failed' });
    });
});

describe('postProductPurposeAnswer', () => {
    it('sends a chip answer exactly as the contract asks', async () => {
        h.apiFetch.mockResolvedValue(reply(200, { id: 'qe-9' }));
        expect(await postProductPurposeAnswer(chip)).toEqual({ kind: 'stored', id: 'qe-9' });
        const [path, init] = h.apiFetch.mock.calls[0] as [string, RequestInit];
        expect(path).toBe('/shramsafal/question-events');
        expect(init.method).toBe('POST');
        const body = JSON.parse(String(init.body));
        expect(body).toMatchObject({
            questionKey: 'product.purpose', dailyLogId: 'log-1', inputEventId: 'ev-1', mixIndex: 2, answerMode: 'chip', answerCode: 'lateblight',
            response: 'उशिराचा करपा', skipped: false, marathiApproved: true, promptOrigin: 'pattern', promptText: chip.promptText, lookLineIds: [],
        });
        // everything else is null
        for (const key of ['plotId', 'crop', 'shownAtUtc', 'bankVersion', 'questionEngineVersion', 'answerObservationId', 'photoAttachmentId', 'deviationReasonCode']) {
            expect(body[key], key).toBeNull();
        }
    });

    it('a spoken answer carries his words and no code; the limits are kept', async () => {
        h.apiFetch.mockResolvedValue(reply(200, { id: 'qe-1' }));
        await postProductPurposeAnswer({ ...chip, mode: 'voice', words: `  ${'क'.repeat(PRODUCT_PURPOSE_RESPONSE_MAX + 50)}  `, promptText: 'प'.repeat(PRODUCT_PURPOSE_PROMPT_MAX + 9) });
        const body = JSON.parse(String((h.apiFetch.mock.calls[0][1] as RequestInit).body));
        expect(body.answerMode).toBe('voice');
        expect(body.answerCode).toBeNull();
        expect(body.response).toHaveLength(PRODUCT_PURPOSE_RESPONSE_MAX);
        expect(body.promptText).toHaveLength(PRODUCT_PURPOSE_PROMPT_MAX);
    });

    it('a blank answer or a bad code is never sent (a let-go has no way to be built)', async () => {
        expect(productPurposeBody({ ...chip, words: '   ' })).toBeNull();
        expect(productPurposeBody({ ...chip, code: 'Late Blight' })).toBeNull();
        expect(productPurposeBody({ ...chip, mode: 'voice', words: '' })).toBeNull();
        expect(await postProductPurposeAnswer({ ...chip, words: '' })).toEqual({ kind: 'failed' });
        expect(h.apiFetch).not.toHaveBeenCalled();
    });

    it.each([
        [409, { kind: 'conflict' }],
        [400, { kind: 'notInRecord' }],
        [403, { kind: 'refused', status: 403 }],
        [404, { kind: 'refused', status: 404 }],
        [500, { kind: 'failed' }],
    ])('a %s ends as %j', async (status, outcome) => {
        h.apiFetch.mockResolvedValue(reply(status));
        expect(await postProductPurposeAnswer(chip)).toEqual(outcome);
    });

    it('no network is "failed", never a throw', async () => {
        h.apiFetch.mockRejectedValue(new Error('offline'));
        expect(await postProductPurposeAnswer(chip)).toEqual({ kind: 'failed' });
    });
});
