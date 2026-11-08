// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-2 fix round 1, P001 P002 P007; founder TAP-1, R15) - what he said on the plan
 * form is understood by the log's own batch audio parse, driven here through the REAL `BackendAiClient.parseInput` (only the HTTP boundary,
 * axios `post`, is stubbed): one POST to `/shramsafal/ai/voice-parse` with the farm id; the first planned item fills the work and the cue;
 * offline at the call, or a net lost between the check and the call, queues NOTHING (the offline queue is closed for the call); and the gate
 * is put back afterwards so a day's-work recording can queue again.
 */
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioData, CropProfile, FarmerProfile } from '../../../types';
import { agriSyncClient } from '../../../infrastructure/api/AgriSyncClient';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SessionStore } from '../../../infrastructure/storage/SessionStore';
import { offlineVoiceQueueAllowed, setOfflineVoiceQueueGate } from '../../../infrastructure/ai/offlineVoiceQueue';
import { understandPlanSpeech } from '../data/planVoice';

const FARM = '55555555-5555-4555-8555-555555555551';
const AUDIO: AudioData = { blob: new Blob(['x']), base64: 'eA==', mimeType: 'audio/webm', recordedAtUtc: '2026-11-08T06:30:00.000Z' };
const PROFILE = { operators: [], activeOperatorId: '', motors: [], waterResources: [], machineries: [] } as unknown as FarmerProfile;
const CROPS: CropProfile[] = [];

const parsedLog = (plannedTasks?: unknown[], fullTranscript?: string) => ({
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [],
    plannedTasks, missingSegments: [], fullTranscript,
});
const answer = (log: unknown) => ({ data: { parsedLog: log, confidence: 0.9, fieldConfidences: {}, suggestedAction: 'AutoSave', modelUsed: 'm', promptVersion: 'v1', providerUsed: 'Gemini', fallbackUsed: false, latencyMs: 5, validationOutcome: 'Passed', sourceAiJobId: 'job-1' } });

const setOnline = (online: boolean) => Object.defineProperty(window.navigator, 'onLine', { value: online, configurable: true });
const keptOffline = async () => (await getDatabase().pendingAiJobs.count()) + (await getDatabase().mutationQueue.count());

let post: ReturnType<typeof vi.spyOn>;
const voicePosts = () => post.mock.calls.filter((c: unknown[]) => c[0] === '/shramsafal/ai/voice-parse');
beforeEach(async () => {
    setOnline(true);
    await resetDatabase();
    SessionStore.setCurrentFarmId(FARM);
    post = vi.spyOn(agriSyncClient.http, 'post');
});
afterEach(() => { setOnline(true); vi.restoreAllMocks(); setOfflineVoiceQueueGate(() => true); });

describe('online: the log\'s own parse', () => {
    it('one POST to /shramsafal/ai/voice-parse carrying the farm id and the audio; the first planned item fills work and cue', async () => {
        post.mockResolvedValue(answer(parsedLog([
            { title: ' युरिया टाकणे ', dueHint: 'उद्या', category: 'general', sourceText: 's', systemInterpretation: 'i' },
            { title: 'दुसरं', dueHint: null, category: 'general', sourceText: 's', systemInterpretation: 'i' },
        ], 'उद्या ऊस S1 ला युरिया टाकायचा')));
        const result = await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        expect(result).toEqual({ ok: true, speech: { transcript: 'उद्या ऊस S1 ला युरिया टाकायचा', title: 'युरिया टाकणे', dueHint: 'उद्या' } });
        const calls = voicePosts();
        expect(calls).toHaveLength(1);
        const form = calls[0][1] as FormData;
        expect(form.get('farmId')).toBe(FARM);
        expect(form.get('audio')).toBeInstanceOf(Blob);
        expect(form.get('recorded_at')).toBe('2026-11-08T06:30:00.000Z');
    });

    it('no planned item: the words the result carries fill the box; no words either: "not understood"', async () => {
        post.mockResolvedValueOnce(answer(parsedLog(undefined, 'ऊसाला पाणी द्यायचं आहे')));
        expect(await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE }))
            .toEqual({ ok: true, speech: { transcript: 'ऊसाला पाणी द्यायचं आहे', title: 'ऊसाला पाणी द्यायचं आहे', dueHint: null } });
        post.mockResolvedValueOnce(answer(parsedLog(undefined, '')));
        expect(await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE })).toEqual({ ok: false, reason: 'failed' });
    });

    it('a failing call is "failed", and keeps nothing queued', async () => {
        post.mockRejectedValue(new Error('Request failed with status code 500'));
        expect(await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE })).toEqual({ ok: false, reason: 'failed' });
        expect(await keptOffline()).toBe(0);
    });
});

describe('offline: nothing is ever kept as a pending voice job (P002)', () => {
    it('offline at the call: nothing is sent and nothing is written to the offline job store or the mutation queue', async () => {
        setOnline(false);
        expect(await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE })).toEqual({ ok: false, reason: 'offline' });
        expect(post).not.toHaveBeenCalled();
        expect(await keptOffline()).toBe(0);
    });

    it('the net lost between the online check and the call: the real parse answers "not kept", nothing is queued, the form hears "offline"', async () => {
        let reads = 0;
        Object.defineProperty(window.navigator, 'onLine', { get: () => reads++ < 1, configurable: true });
        const result = await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        expect(result).toEqual({ ok: false, reason: 'offline' });
        expect(post).not.toHaveBeenCalled();
        expect(await keptOffline()).toBe(0);
    });

    it('the gate is closed for the call and put back afterwards (a day\'s-work recording may queue again)', async () => {
        let during: boolean | null = null;
        post.mockImplementation(async () => { during = offlineVoiceQueueAllowed(); return answer(parsedLog([{ title: 'फवारणी' }])); });
        expect(offlineVoiceQueueAllowed()).toBe(true);
        await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        expect(during).toBe(false);
        expect(offlineVoiceQueueAllowed()).toBe(true);
    });

    it('the gate is put back after a failure too, and overlapping calls open it only when the last one ends', async () => {
        post.mockRejectedValue(new Error('boom'));
        await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        expect(offlineVoiceQueueAllowed()).toBe(true);

        const seen: boolean[] = [];
        let release!: () => void;
        const hold = new Promise<void>(r => { release = r; });
        post.mockImplementation(async () => { await hold; seen.push(offlineVoiceQueueAllowed()); return answer(parsedLog([{ title: 'फवारणी' }])); });
        const a = understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        const b = understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        await new Promise(r => setTimeout(r, 20));
        release();
        await Promise.all([a, b]);
        expect(seen).toEqual([false, false]);
        expect(offlineVoiceQueueAllowed()).toBe(true);
    });
});

describe('keeps no task, log or voice reference of its own', () => {
    it('no planned work, log or queued change comes of understanding', async () => {
        post.mockResolvedValue(answer(parsedLog([{ title: 'फवारणी' }])));
        await understandPlanSpeech(AUDIO, { crops: CROPS, profile: PROFILE });
        const db = getDatabase();
        expect(await db.mutationQueue.count()).toBe(0);
        expect(await db.pendingAiJobs.count()).toBe(0);
        expect(await db.logs.count()).toBe(0);
        expect(await db.plannedWork.count()).toBe(0);
    });
});
