// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, phone half; doctrine P8, P11) - the timer the server read from his own words rides inside the
 * ONE planned-work item of the voice-parse result, through the REAL `BackendAiClient.parseInput` (only axios `post` is faked; no provider is ever called).
 * It is read defensively: anything malformed is no timer.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, FarmerProfile } from '../../../types';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { setOfflineVoiceQueueGate } from '../../../infrastructure/ai/offlineVoiceQueue';
import { understandPlanSpeech } from '../data/planVoice';

const AUDIO: AudioData = { blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm', recordedAtUtc: '2026-11-25T06:30:00.000Z' };
const PROFILE = { operators: [], activeOperatorId: '', motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;
const item = (extra: Record<string, unknown>) => ({ title: 'फवारणी', dueHint: null, category: 'general', sourceText: 's', systemInterpretation: 'i', ...extra });
const answer = (plannedTasks: unknown[]) => ({
    data: {
        parsedLog: { cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [], plannedTasks, missingSegments: [], fullTranscript: 'पेस्टनंतर ८ दिवसांनी' },
        confidence: 0.9, fieldConfidences: {}, suggestedAction: 'AutoSave', modelUsed: 'm', promptVersion: 'v1', providerUsed: 'Sarvam', fallbackUsed: false, latencyMs: 5, validationOutcome: 'Passed', sourceAiJobId: 'job-1',
    },
});
let post: ReturnType<typeof vi.spyOn>;
const hear = async (extra: Record<string, unknown>) => {
    post.mockResolvedValue(answer([item(extra)]));
    const r = await understandPlanSpeech(AUDIO, { crops: [], profile: PROFILE });
    if (!r.ok) throw new Error('not ok');
    return r.speech;
};

beforeEach(async () => {
    Object.defineProperty(window.navigator, 'onLine', { value: true, configurable: true });
    await resetDatabase();
    SessionStore.setCurrentFarmId('55555555-5555-4555-8555-555555555551');
    post = vi.spyOn(agriSyncClient.http, 'post');
});
afterEach(() => { vi.restoreAllMocks(); setOfflineVoiceQueueGate(() => true); });

describe('the spoken timer in the planning speech (slice 16)', () => {
    it('day: read through the nested item, as it came', async () => {
        const s = await hear({ spokenTimer: { kind: 'day', fromDay: 9, heardWords: 'दहाव्या दिवशी', provenance: 'spoken' } });
        expect(s.spokenTimer).toEqual({ kind: 'day', fromDay: 9, heardWords: 'दहाव्या दिवशी' });
    });
    it('after: the work words and the days', async () => {
        const s = await hear({ spokenTimer: { kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 8, heardWords: 'पेस्टनंतर आठ दिवसांनी', provenance: 'spoken' } });
        expect(s.spokenTimer).toEqual({ kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 8, heardWords: 'पेस्टनंतर आठ दिवसांनी' });
    });
    it('sign: the sign words', async () => {
        const s = await hear({ spokenTimer: { kind: 'sign', signWords: 'फूट दिसली', heardWords: 'फूट दिसली की', provenance: 'spoken' } });
        expect(s.spokenTimer).toEqual({ kind: 'sign', signWords: 'फूट दिसली', heardWords: 'फूट दिसली की' });
    });
    it('absent: no timer, and the result is exactly what it was before', async () => {
        const s = await hear({});
        expect('spokenTimer' in s).toBe(false);
    });
    it.each([
        ['not an object', 'दहा दिवस'],
        ['unknown kind', { kind: 'weekly', heardWords: 'x' }],
        ['day without a whole day', { kind: 'day', fromDay: 'नऊ', heardWords: 'x' }],
        ['day with a negative day', { kind: 'day', fromDay: -3, heardWords: 'x' }],
        ['after without days', { kind: 'after', afterWorkWords: 'पेस्ट', heardWords: 'x' }],
        ['after with a fractional day count', { kind: 'after', afterWorkWords: 'पेस्ट', usualDays: 2.5, heardWords: 'x' }],
        ['sign with empty words', { kind: 'sign', signWords: '  ', heardWords: 'x' }],
        ['no heard words', { kind: 'sign', signWords: 'फूट दिसली' }],
    ])('malformed (%s): ignored, no timer', async (_n, bad) => {
        const s = await hear({ spokenTimer: bad });
        expect(s.spokenTimer).toBeUndefined();
        expect(s.title).toBe('फवारणी');
    });
});
