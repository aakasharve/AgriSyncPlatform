// @vitest-environment jsdom
/**
 * C11 W1.P4.T1 — postAiCorrectionBlob unit tests
 * spec: ai-intelligence-plan-2026-06-25
 *
 * Four assertions:
 *  T1. AI edit (provenance.source==='ai', aiDraft≠userDraft) → exactly ONE
 *      POST to /shramsafal/corrections with OriginalParseRaw !== CorrectedParse
 *      and a real PromptVersion.
 *  T2. Manual draft (provenance.source!=='ai') → NO POST.
 *  T3. No-diff AI draft (aiDraft deep-equals userDraft) → NO POST.
 *  T4. POST failure / offline → does NOT throw into the caller.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Module mocks — must be declared before any import of the module under test

vi.mock('../../api/transport', () => ({
    resolveApiBaseUrl: () => 'https://api.test',
}));

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'test-token', userId: 'user-1' }),
}));

// DexieDatabase is imported transitively by CorrectionEventStore (for
// persistAiCorrectionEvents). Mock it to avoid IndexedDB in node env.
vi.mock('../../storage/DexieDatabase', () => ({
    getDatabase: () => ({
        aiCorrectionEvents: {
            bulkPut: vi.fn(async () => undefined),
        },
    }),
}));

import { postAiCorrectionBlob } from '../CorrectionEventStore';
import type { LogProvenance } from '../../../domain/ai/LogProvenance';

// ── Shared test fixtures

const BASE_PROVENANCE: LogProvenance = {
    source: 'ai',
    promptVersion: 'v42',
    sourceAiJobId: '11111111-2222-3333-4444-555555555555',
    timestamp: new Date().toISOString(),
};

const AI_DRAFT = {
    cropActivities: [{ id: 'act-1', title: 'Spraying' }],
    irrigation: [],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
};

const USER_DRAFT_DIFFERENT = {
    cropActivities: [{ id: 'act-1', title: 'Spraying' }, { id: 'act-2', title: 'Weeding' }],
    irrigation: [],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
};

const USER_DRAFT_SAME = {
    cropActivities: [{ id: 'act-1', title: 'Spraying' }],
    irrigation: [],
    inputs: [],
    labour: [],
    machinery: [],
    activityExpenses: [],
    observations: [],
    plannedTasks: [],
};

// ── Helpers

function flushMicrotasks(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

describe('postAiCorrectionBlob', () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        fetchMock = vi.fn(async () =>
            new Response(null, { status: 201, statusText: 'Created' }),
        );
        vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // T1 — AI edit with real diff → exactly one POST with correct payload
    it('T1: AI edit triggers exactly ONE POST with OriginalParseRaw != CorrectedParse and real PromptVersion', async () => {
        postAiCorrectionBlob({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT_DIFFERENT,
            provenance: BASE_PROVENANCE,
        });

        await flushMicrotasks();

        expect(fetchMock).toHaveBeenCalledTimes(1);

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://api.test/shramsafal/corrections');
        expect(init.method).toBe('POST');

        const payload = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(payload.OriginalParseRaw).not.toBe(payload.CorrectedParse);
        expect(payload.PromptVersion).toBe('v42');
        expect(typeof payload.OriginalParseId).toBe('string');
        expect((payload.OriginalParseId as string).length).toBeGreaterThan(0);
        // Trigger 0 = CorrectionTrigger.EditUI
        expect(payload.Trigger).toBe(0);
    });

    // T2 — Manual draft → no POST
    it('T2: manual draft (source !== ai) triggers NO POST', async () => {
        const manualProvenance: LogProvenance = {
            ...BASE_PROVENANCE,
            source: 'manual',
        };

        postAiCorrectionBlob({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT_DIFFERENT,
            provenance: manualProvenance,
        });

        await flushMicrotasks();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    // T3 — No-diff AI draft → no POST
    it('T3: no-diff AI draft (aiDraft deep-equals userDraft) triggers NO POST', async () => {
        postAiCorrectionBlob({
            aiDraft: AI_DRAFT,
            userDraft: USER_DRAFT_SAME,
            provenance: BASE_PROVENANCE,
        });

        await flushMicrotasks();

        expect(fetchMock).not.toHaveBeenCalled();
    });

    // T4 — POST failure does NOT throw into caller
    it('T4: POST failure / offline does NOT throw into the caller', async () => {
        fetchMock.mockRejectedValueOnce(new Error('Network error — offline'));

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        // Must not throw synchronously
        expect(() =>
            postAiCorrectionBlob({
                aiDraft: AI_DRAFT,
                userDraft: USER_DRAFT_DIFFERENT,
                provenance: BASE_PROVENANCE,
            }),
        ).not.toThrow();

        // Must not throw asynchronously either
        await expect(flushMicrotasks()).resolves.toBeUndefined();

        // The failure should have been swallowed with a console.warn
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls[0]?.[0]).toContain('[AI corrections bridge]');
    });
});
