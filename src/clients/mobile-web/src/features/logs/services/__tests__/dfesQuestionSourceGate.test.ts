/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q; founder D-B) - the phone's half of the source gate.
 *
 * The server decides for itself (RecordQuestionEventHandlerTests.SourceGate.cs); these pin that the phone uses the SAME key table,
 * never chooses a question the server would refuse, keeps today's bank behaviour, and sends the words shown, their origin and the
 * look-line ids (never a source) with each event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../../infrastructure/storage/AuthTokenStore', () => ({
    getAuthSession: () => null,
}));

import { questionKindForKey, statesAgronomy } from '../dfesQuestionKinds';
import { isAllowed, type SelectedQuestion } from '../dfesQuestionEngine';
import { DFES_QUESTION_BANK, type DfesQuestion } from '../dfesQuestionBank';
import { recordQuestionEvent } from '../dfesQuestionApi';

describe('lane DFES-Q - question kinds (same table as the server)', () => {
    it.each([
        ['gap.dose', 'gap', false],
        ['gap.scope', 'gap', false],
        ['stage.confirm_current', 'stage_confirm', false],
        ['stage.open', 'stage_open', false],
        ['followup.observation_outcome', 'followup', false],
        ['learning.next_experiment', 'learning', false],
        ['schedule.why_not', 'why_not', false],
        ['weather.severe_care_check', 'weather_check_in', false],
        ['stage.look', 'stage_look', true],
        ['safety.spray_wind_high', 'safety', true],
        ['weather.rain_before_spray', 'weather', true],
        ['advice.something_new', 'unknown', true],
    ] as const)('%s is %s (states agronomy: %s)', (key, kind, agronomy) => {
        expect(questionKindForKey(key)).toBe(kind);
        expect(statesAgronomy(questionKindForKey(key))).toBe(agronomy);
    });
});

describe('lane DFES-Q - the phone gate', () => {
    const stageLook: DfesQuestion = {
        ...(DFES_QUESTION_BANK.find(q => q.questionKey === 'followup.observation_outcome') as DfesQuestion),
        questionKey: 'stage.look', agronomistApproved: false, marathiApproved: true,
    };

    it('a question that states agronomy needs the look lines it came from; the agronomist flag no longer matters', () => {
        expect(isAllowed(stageLook)).toBe(false);
        expect(isAllowed(stageLook, ['grapes-fp-d12-buds'])).toBe(true);
    });

    it('copy that is not Marathi-approved is never allowed, sourced or not', () => {
        expect(isAllowed({ ...stageLook, marathiApproved: false }, ['grapes-fp-d12-buds'])).toBe(false);
    });

    it("today's bank keeps its behaviour: the reviewed entries pass, the four inert ones stay off", () => {
        const allowed = DFES_QUESTION_BANK.filter(q => isAllowed(q)).map(q => q.questionKey).sort();
        const blocked = DFES_QUESTION_BANK.filter(q => !isAllowed(q)).map(q => q.questionKey).sort();

        expect(blocked).toEqual([
            'safety.spray_wind_high', 'schedule.category_planned_not_done', 'weather.rain_before_spray', 'weather.severe_care_check',
        ]);
        expect(allowed).toContain('gap.dose');
        expect(allowed).toContain('followup.observation_outcome');
    });
});

describe('lane DFES-Q - what the phone sends with each event', () => {
    beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const selected = (over: Partial<SelectedQuestion> = {}): SelectedQuestion => ({
        question: DFES_QUESTION_BANK.find(q => q.questionKey === 'gap.dose') as DfesQuestion,
        resolvedPromptMr: 'किती मात्रा (डोस) वापरली?',
        triggerReason: 'gap DOSE', weatherContext: null, expectedStage: null, actualStageApplicability: null,
        ...over,
    });

    it('sends the words shown, their origin, the look-line ids and the why-not fields; never a source', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'e1' }), { status: 200 }));

        await recordQuestionEvent('farm-1', null,
            selected({ promptOrigin: 'pattern', lookLineIds: ['grapes-fp-d12-buds'], scheduleCardRef: 'grapes-fp:card-d10' }),
            { skipped: false, response: 'पाऊस आला', deviationReasonCode: 'rain', deviationChallenge: 'दोन दिवस पाऊस', photoAttachmentId: 'att-1' },
            '2026-11-21T05:00:00Z');

        const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
        expect(body.promptText).toBe('किती मात्रा (डोस) वापरली?');
        expect(body.promptOrigin).toBe('pattern');
        expect(body.lookLineIds).toEqual(['grapes-fp-d12-buds']);
        expect(body.scheduleCardRef).toBe('grapes-fp:card-d10');
        expect(body.deviationReasonCode).toBe('rain');
        expect(body.deviationChallenge).toBe('दोन दिवस पाऊस');
        expect(body.photoAttachmentId).toBe('att-1');
        expect(body).not.toHaveProperty('sourceRefs');
        expect(body).not.toHaveProperty('questionKind');
    });

    it('an event from today\'s bank sends origin "bank", no lines and the same old fields as before', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'e2' }), { status: 200 }));

        await recordQuestionEvent('farm-1', null, selected(), { skipped: false, response: '10 ml' }, '2026-11-21T05:00:00Z');

        const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body));
        expect(body.promptOrigin).toBe('bank');
        expect(body.lookLineIds).toEqual([]);
        expect(body.agronomistApproved).toBe(true);
        expect(body.marathiApproved).toBe(true);
        expect(body.questionKey).toBe('gap.dose');
    });
});
