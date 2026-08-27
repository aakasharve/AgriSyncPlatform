// @vitest-environment jsdom
/**
 * §P0.4 — correction events carry no verbatim speech.
 *
 * spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.4
 *
 * The locked ruling was violated in two places at once: `rawTranscript` was a
 * REQUIRED field on the client type and landed in unencrypted IndexedDB, and
 * the whole AI draft — `fullTranscript`, per-item `sourceText` and all — was
 * POSTed into `ssf.correction_events`. Worker names live in exactly those
 * chunks. These tests pin both ends shut, and pin the structured signal open.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/transport', () => ({
    resolveApiBaseUrl: () => 'https://api.test',
}));

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'test-token', userId: 'user-1' }),
}));

const bulkPutSpy = vi.fn(async () => undefined);
vi.mock('../../storage/DexieDatabase', () => ({
    getDatabase: () => ({ aiCorrectionEvents: { bulkPut: bulkPutSpy } }),
}));

import {
    buildAiCorrectionEvents,
    persistAiCorrectionEvents,
    postAiCorrectionBlob,
} from '../CorrectionEventStore';
import { containsTranscriptText } from '../../../domain/ai/contracts/transcriptRedaction';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';

/** The words a farmer actually said, with two worker names inside. */
const SPOKEN = 'आज रामू आणि सीता यांनी चार तास काम केले';

const PROVENANCE: LogProvenance = {
    source: 'ai',
    model: 'gemini-2.5-flash',
    modelVersion: 'gemini-2.5-flash',
    promptVersion: 'v42',
    promptContentHash: 'b'.repeat(64),
    sourceAiJobId: '11111111-2222-3333-4444-555555555555',
    rawTranscript: SPOKEN,
    timestamp: new Date().toISOString(),
};

const AI_DRAFT = {
    fullTranscript: SPOKEN,
    english: 'Today Ramu and Sita worked four hours',
    labour: [{ maleCount: 2, femaleCount: 0, hoursWorked: 4, sourceText: 'रामू आणि सीता' }],
    cropActivities: [],
    irrigation: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
};

const USER_DRAFT = {
    fullTranscript: SPOKEN,
    english: 'Today Ramu and Sita worked four hours',
    labour: [{ maleCount: 1, femaleCount: 1, hoursWorked: 4, sourceText: 'रामू आणि सीता' }],
    cropActivities: [],
    irrigation: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
};

function flushMicrotasks(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('§P0.4 — built correction events', () => {
    it('built_correction_event_carries_no_raw_transcript', () => {
        const [event] = buildAiCorrectionEvents({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT,
            provenance: PROVENANCE,
        });

        expect(event).toBeDefined();
        expect(JSON.stringify(event)).not.toContain(SPOKEN);
        expect(JSON.stringify(event)).not.toContain('रामू');
        expect(containsTranscriptText(event)).toBe(false);
        expect((event as unknown as Record<string, unknown>).rawTranscript).toBeUndefined();
        expect((event as unknown as Record<string, unknown>).sourceText).toBeUndefined();
    });

    it('built_correction_event_keeps_the_structured_signal', () => {
        const [event] = buildAiCorrectionEvents({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT,
            provenance: PROVENANCE,
        });

        // The disagreement — 2 men/0 women vs 1 man/1 woman — is the whole
        // point of the row and must survive the redaction intact.
        expect(event?.fieldPath).toBe('labour');
        expect(event?.aiValue).toEqual([{ maleCount: 2, femaleCount: 0, hoursWorked: 4 }]);
        expect(event?.userValue).toEqual([{ maleCount: 1, femaleCount: 1, hoursWorked: 4 }]);
        expect(event?.correctionType).toBe('wrong_value');
        expect(event?.bucketId).toBe('labour');
    });

    it('built_correction_event_keeps_prompt_and_job_lineage', () => {
        const [event] = buildAiCorrectionEvents({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT,
            provenance: PROVENANCE,
        });

        expect(event?.promptVersion).toBe('v42');
        expect(event?.promptContentHash).toBe('b'.repeat(64));
        expect(event?.sourceAiJobId).toBe('11111111-2222-3333-4444-555555555555');
        expect(event?.modelVersion).toBe('gemini-2.5-flash');
    });

    it('a_transcript_only_difference_is_not_a_correction', () => {
        // Same structured content, different words attributed to it. Nothing
        // the farmer can see changed, so nothing should be recorded — and in
        // particular no row carrying those words.
        const events = buildAiCorrectionEvents({
            aiDraft: AI_DRAFT,
            userDraft: {
                ...AI_DRAFT,
                labour: [{ ...AI_DRAFT.labour[0], sourceText: 'completely different words' }],
            },
            provenance: PROVENANCE,
        });

        expect(events).toHaveLength(0);
    });
});

describe('§P0.4 — persisted correction events', () => {
    beforeEach(() => bulkPutSpy.mockClear());

    it('persisted_correction_row_carries_no_transcript_into_indexeddb', async () => {
        // A caller that hand-builds an event with a transcript still on it —
        // the persistence boundary must strip it, not trust its callers.
        await persistAiCorrectionEvents([{
            id: 'c1',
            extractionId: 'x',
            timestamp: new Date().toISOString(),
            fieldPath: 'labour',
            aiValue: [{ maleCount: 2, sourceText: SPOKEN }],
            userValue: [{ maleCount: 1 }],
            promptVersion: 'v42',
            correctionType: 'wrong_value',
            rawTranscript: SPOKEN,
        } as never]);

        expect(bulkPutSpy).toHaveBeenCalledTimes(1);
        const written = (bulkPutSpy.mock.calls[0] as unknown as [unknown[]])[0];
        expect(JSON.stringify(written)).not.toContain(SPOKEN);
        expect(containsTranscriptText(written)).toBe(false);
        // …and the signal is still there.
        expect(JSON.stringify(written)).toContain('"maleCount":2');
    });
});

describe('§P0.4 — the correction blob POSTed to the server', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    async function postAndReadBody(provenance = PROVENANCE): Promise<Record<string, unknown>> {
        postAiCorrectionBlob({ aiDraft: AI_DRAFT, userDraft: USER_DRAFT, provenance });
        await flushMicrotasks();
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        return JSON.parse(init.body as string) as Record<string, unknown>;
    }

    it('posted_correction_blob_carries_no_transcript_text', async () => {
        const payload = await postAndReadBody();

        // The matrix line said no server copy existed. This is what makes
        // that true: neither draft carries the utterance or the chunk.
        expect(payload.OriginalParseRaw as string).not.toContain(SPOKEN);
        expect(payload.CorrectedParse as string).not.toContain(SPOKEN);
        expect(payload.OriginalParseRaw as string).not.toContain('रामू');
        expect(payload.OriginalParseRaw as string).not.toContain('Ramu');
        expect(containsTranscriptText(JSON.parse(payload.OriginalParseRaw as string))).toBe(false);
        expect(containsTranscriptText(JSON.parse(payload.CorrectedParse as string))).toBe(false);
    });

    it('posted_correction_blob_still_carries_the_structured_drafts', async () => {
        const payload = await postAndReadBody();

        const ai = JSON.parse(payload.OriginalParseRaw as string) as Record<string, unknown>;
        const user = JSON.parse(payload.CorrectedParse as string) as Record<string, unknown>;

        expect(ai.labour).toEqual([{ maleCount: 2, femaleCount: 0, hoursWorked: 4 }]);
        expect(user.labour).toEqual([{ maleCount: 1, femaleCount: 1, hoursWorked: 4 }]);
        expect(payload.OriginalParseRaw).not.toBe(payload.CorrectedParse);
    });

    it('posted_correction_blob_carries_the_prompt_content_hash', async () => {
        const payload = await postAndReadBody();

        expect(payload.PromptContentHash).toBe('b'.repeat(64));
        expect(payload.PromptVersion).toBe('v42');
    });

    it('posted_correction_blob_sends_null_rather_than_a_fabricated_parse_id', async () => {
        // `madj_`-style and absent ids used to be replaced by a fresh random
        // UUID, which matched no AiJob — the golden-set worker skipped the
        // row while the column still looked like a real link.
        const payload = await postAndReadBody({ ...PROVENANCE, sourceAiJobId: 'not-a-uuid' });

        expect(payload.OriginalParseId).toBeNull();
    });

    it('posted_correction_blob_preserves_a_real_parse_id', async () => {
        const payload = await postAndReadBody();

        expect(payload.OriginalParseId).toBe('11111111-2222-3333-4444-555555555555');
    });
});
