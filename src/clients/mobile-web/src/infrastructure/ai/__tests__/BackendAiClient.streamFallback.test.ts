// @vitest-environment jsdom
/**
 * BackendAiClient.parseInputStream — bulletproof streaming→batch fallback
 * ───────────────────────────────────────────────────────────────────────
 * spec: voice-sarvam-live-captions-2026-06-11
 *
 * Locks the adapter-level safety net: the streaming parse-voice-stream call
 * is only a "success" when it delivers a terminal `complete` event. EVERY
 * other terminus — terminal `error` event, a stream that breaks mid-flight,
 * or a stream that ends WITHOUT a `complete` (no terminal event) — MUST fall
 * back to the proven batch /voice-parse path so a log is ALWAYS created.
 *
 * This is the deepest layer of the "voice can NEVER break" guarantee. The
 * useVoiceRecorder integration test covers the orchestration layer above it;
 * this test pins the BackendAiClient.streamOrFallback contract directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Module mocks for the heavy I/O dependencies ──────────────────────
const mockParseTextLog = vi.fn();
const mockParseVoiceLog = vi.fn();
vi.mock('../../api/AgriSyncClient', () => ({
    agriSyncClient: {
        parseTextLog: (...args: unknown[]) => mockParseTextLog(...args),
        parseVoiceLog: (...args: unknown[]) => mockParseVoiceLog(...args),
    },
}));

vi.mock('../../api/transport', () => ({
    resolveApiBaseUrl: () => 'https://api.test',
}));

vi.mock('../../storage/AuthTokenStore', () => ({
    getAuthSession: () => ({ accessToken: 'tok', userId: 'user-1' }),
}));

// Make resolveFarmIdFromCache resolve to a farm so the stream path is reached.
vi.mock('../../storage/SessionStore', () => ({
    SessionStore: { getCurrentFarmId: () => 'farm-1' },
}));
vi.mock('../../../core/session/MeContextService', () => ({
    getLastCachedMeContext: () => ({ farms: [{ farmId: 'farm-1' }] }),
}));
vi.mock('../../storage/DexieDatabase', () => ({
    getDatabase: () => ({
        appMeta: { get: vi.fn(async () => undefined) },
        dayLedgers: { toCollection: () => ({ first: vi.fn(async () => undefined) }) },
    }),
}));

import { BackendAiClient } from '../BackendAiClient';
import type { VoiceInput } from '../../../application/ports';
import type { AgriLogResponse, CropProfile, FarmerProfile } from '../../../types';
import type { LogScope } from '../../../domain/types/log.types';
import type { ParseStreamEvent } from '../../../domain/ai/contracts/ParseStreamEvent';

const FAKE_AGRI_LOG = {
    cropActivities: [],
    irrigation: [],
    labour: [],
    inputs: [],
    machinery: [],
    activityExpenses: [],
    fullTranscript: 'काल पाणी दिले',
    summary: 'Watered yesterday',
    questionsForUser: [],
    missingSegments: [],
    dayOutcome: 'WORK_RECORDED',
} as unknown as AgriLogResponse;

const SCOPE = {
    selectedCropIds: ['grapes'],
    selectedPlotIds: ['plot-1'],
    mode: 'single',
    applyPolicy: 'broadcast',
} as unknown as LogScope;
const PROFILE = { motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;
const CROPS: CropProfile[] = [];
const TEXT_INPUT: VoiceInput = { type: 'text', content: 'काल पाणी दिले' };

/** Build a streaming Response whose body emits the given SSE event lines. */
function sseResponse(events: ReadonlyArray<Record<string, unknown>>): Response {
    const body = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('');
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(new TextEncoder().encode(body));
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
    });
}

/** Batch parseTextLog stub shaped like the real /voice-parse response. */
function batchOkResult() {
    return {
        parsedLog: FAKE_AGRI_LOG,
        confidence: 0.9,
        fieldConfidences: {},
        suggestedAction: 'manual_review',
        modelUsed: 'gemini',
        promptVersion: 'v3.2',
        latencyMs: 700,
    };
}

async function collect(stream: AsyncIterable<ParseStreamEvent>): Promise<ParseStreamEvent[]> {
    const out: ParseStreamEvent[] = [];
    for await (const e of stream) out.push(e);
    return out;
}

describe('BackendAiClient.parseInputStream bulletproof fallback (voice-sarvam-live-captions-2026-06-11)', () => {
    beforeEach(() => {
        mockParseTextLog.mockReset();
        mockParseVoiceLog.mockReset();
        Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });
    });

    it('happy path: stream delivers terminal complete → events flushed, NO batch fallback', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            sseResponse([
                { type: 'field_complete', fieldPath: 'irrigation' },
                { type: 'complete', payload: FAKE_AGRI_LOG, promptVersion: 'v3.2', modelMs: 800 },
            ]),
        );

        const client = new BackendAiClient();
        const events = await collect(client.parseInputStream(TEXT_INPUT, SCOPE, CROPS, PROFILE));

        // The terminal complete is delivered; batch path never called.
        expect(events.some((e) => e.type === 'complete')).toBe(true);
        expect(mockParseTextLog).not.toHaveBeenCalled();
        expect(mockParseVoiceLog).not.toHaveBeenCalled();
    });

    it('terminal error (no complete) → discards partial events, falls back to batch /voice-parse', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            sseResponse([
                { type: 'text', content: '{"irriga' },
                { type: 'error', error: 'parse-voice-stream 503' },
            ]),
        );
        mockParseTextLog.mockResolvedValue(batchOkResult());

        const client = new BackendAiClient();
        const events = await collect(client.parseInputStream(TEXT_INPUT, SCOPE, CROPS, PROFILE));

        // Batch fallback ran (a log is created from the same transcript).
        expect(mockParseTextLog).toHaveBeenCalledTimes(1);
        // The consumer sees the batch path's synthesized terminal complete,
        // NOT the partial text chunk nor the streaming error.
        const terminal = events[events.length - 1];
        expect(terminal.type).toBe('complete');
        expect(events.some((e) => e.type === 'error')).toBe(false);
    });

    it('stream ends WITHOUT any terminal event → falls back to batch /voice-parse', async () => {
        // No `complete`, no `error` — just a text chunk then EOF. Previously
        // this would leave the consumer with a silently-truncated stream and
        // no committed draft. Must fall back to batch.
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            sseResponse([{ type: 'text', content: '{"partial":true}' }]),
        );
        mockParseTextLog.mockResolvedValue(batchOkResult());

        const client = new BackendAiClient();
        const events = await collect(client.parseInputStream(TEXT_INPUT, SCOPE, CROPS, PROFILE));

        expect(mockParseTextLog).toHaveBeenCalledTimes(1);
        expect(events[events.length - 1].type).toBe('complete');
    });

    it('fetch throws (network) → falls back to batch /voice-parse', async () => {
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
        mockParseTextLog.mockResolvedValue(batchOkResult());

        const client = new BackendAiClient();
        const events = await collect(client.parseInputStream(TEXT_INPUT, SCOPE, CROPS, PROFILE));

        expect(mockParseTextLog).toHaveBeenCalledTimes(1);
        expect(events[events.length - 1].type).toBe('complete');
    });

    it('non-200 response → falls back to batch /voice-parse', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response('boom', { status: 503, headers: { 'content-type': 'text/plain' } }),
        );
        mockParseTextLog.mockResolvedValue(batchOkResult());

        const client = new BackendAiClient();
        const events = await collect(client.parseInputStream(TEXT_INPUT, SCOPE, CROPS, PROFILE));

        expect(mockParseTextLog).toHaveBeenCalledTimes(1);
        expect(events[events.length - 1].type).toBe('complete');
    });
});
