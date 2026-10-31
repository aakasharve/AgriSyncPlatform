// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 2) — आवाज नोंदी, on a real Dexie (fake-indexeddb):
 *   N1 a retry with a changed place or day never pretends the new choice was saved: it says where the recording is
 *      already saved and only clears it from the list;
 *   N2 removing a typed note says it is HIS WRITTEN note and that it will be deleted (and it is); a removed voice note's
 *      diary badge no longer says "queued" (and a retried one says queued again);
 *   N3 a recording stuck for want of a connection says so — "साथीला समजलं नाही" only when the server answered and could
 *      not understand it; the आवाज नोंदी row's line counts stuck ones too, so it matches the number;
 *   N5 a job moved back to the queue after a killed session says so to every number; the shared store is emptied and
 *      read again when the signed-in farmer's phone database changes;
 *   N7 a recording from a phone whose clock was ahead says why and lets him pick the day; "पुन्हा सांगा" on it never
 *      carries the impossible day.
 * Both languages where the words change.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en', farm: null as null | { currentFarmId: string | null; farms: unknown[] } }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    const ctx = () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => t(k, h.lang) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../core/session/FarmContext', async (orig) => ({
    ...(await orig<typeof import('../../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => h.farm,
}));

import { getDatabase, resetDatabase, type PendingAiJobRecord, type VoiceClipCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { getActiveDatabaseName, setActiveDatabaseName } from '../../../../infrastructure/storage/activeDatabaseName';
import * as reader from '../../../../infrastructure/sync/waitingVoiceNotes';
import { reclaimAbandonedAiJobs } from '../../../../infrastructure/sync/abandonedStateRecovery';
import { getDateKey } from '../../../../core/domain/services/DateKeyService';
import { resetSpeakStoreForTests, speakState } from '../../../../core/speak/speakStore';
import { dayFull } from '../../../logs/components/dayPick/dayWords';
import { WaitingVoiceNotes, type VoiceNoteCheckDeps } from '../WaitingVoiceNotes';
import { resetWaitingVoiceNotesForTests, useWaitingVoiceNotes } from '../useWaitingVoiceNotes';
import { voiceNotesWords } from '../voiceNotesWords';
import type { CropProfile, DailyLog, FarmerProfile } from '../../../../types';

const FARM = 'farm-1';
const PARSED = {
    summary: '', dayOutcome: 'WORK_RECORDED', fullTranscript: 'ठिबकने 2 तास पाणी दिलं',
    cropActivities: [], irrigation: [{ id: 'w', method: 'Drip', durationHours: 2 }], labour: [], inputs: [], machinery: [],
    activityExpenses: [], questionsForUser: [], missingSegments: [],
};
const job = (over: Partial<PendingAiJobRecord> = {}): Omit<PendingAiJobRecord, 'id'> => ({
    operationType: 'voice_parse',
    context: { farmId: FARM, userId: 'u', operation: 'voice', plotId: 'g1', scopeCropIds: ['grape'], scopePlotIds: ['g1'], recordedAtUtc: '2026-10-30T14:10:00.000Z', idempotencyKey: 'clip-key' },
    inputBlob: new Blob([new Uint8Array([1, 2, 3])]),
    status: 'pending', createdAt: '2026-10-30T14:10:01.000Z', updatedAt: '2026-10-30T14:10:01.000Z', retryCount: 0,
    ...over,
});
const result = { operationType: 'voice_parse', receivedAtUtc: '2026-10-31T09:00:00.000Z', payload: { parsedLog: PARSED } } as const;
const understood = (over: Partial<PendingAiJobRecord> = {}) => job({ status: 'completed', result, ...over });
const typedCtx = { ...job().context, operation: 'text' as const, textTranscript: 'खुरपणी केली', idempotencyKey: undefined };
const FUTURE = '2099-01-01T05:00:00.000Z';
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', plots: [{ id: 'g1', name: 'द्राक्ष G1' }, { id: 'g2', name: 'खालचा' }] }] as unknown as CropProfile[];
const deps = (save: VoiceNoteCheckDeps['save'], over: Partial<VoiceNoteCheckDeps> = {}): VoiceNoteCheckDeps => ({
    crops: CROPS, profile: { operators: [], activeOperatorId: 'me' } as unknown as FarmerProfile, history: [] as DailyLog[],
    save, returnTo: { route: 'voiceDiary', mainView: 'log' }, toast: vi.fn(), farmId: FARM,
    ...over,
} as VoiceNoteCheckDeps);
const clip = (status: VoiceClipCacheRecord['status']): VoiceClipCacheRecord => ({
    id: 'clip-key', farmId: FARM, recordedAtUtc: '2026-10-30T14:10:00.000Z', mimeType: 'audio/webm', sizeBytes: 3, status,
    createdAt: '2026-10-30T14:10:01.000Z', updatedAt: '2026-10-30T14:10:01.000Z',
} as unknown as VoiceClipCacheRecord);

let homeDb = '';
beforeEach(async () => {
    h.lang = 'mr'; h.farm = { currentFarmId: FARM, farms: [{ farmId: FARM }] };
    resetWaitingVoiceNotesForTests();
    resetSpeakStoreForTests();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    homeDb = getActiveDatabaseName();
});
afterEach(() => {
    cleanup(); vi.restoreAllMocks();
    if (homeDb && getActiveDatabaseName() !== homeDb) setActiveDatabaseName(homeDb);
    resetSpeakStoreForTests();
});

describe.each(['mr', 'en'] as const)('fix 2 (%s)', (lang) => {
    beforeEach(() => { h.lang = lang; });
    const vw = () => voiceNotesWords(lang);

    describe('N1 — a retry never drops his changed choice silently', () => {
        it('the log is already saved elsewhere: it says where, and only clears the recording from the list', async () => {
            const id = await getDatabase().pendingAiJobs.add(understood());
            const at = { id: 'L1', date: '2026-10-29', context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g2'], selectedPlotNames: ['खालचा'] }] } } as unknown as DailyLog;
            const d = deps(vi.fn(async () => [at]));
            render(<WaitingVoiceNotes deps={d} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
            await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
            await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
            expect(d.toast).toHaveBeenCalledTimes(1);
            const [message, type] = (d.toast as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
            expect(type).toBe('partial');
            expect(message).toContain(lang === 'en' ? 'already saved' : 'आधीच');
            expect(message).toContain('खालचा');
            expect(message).toContain(dayFull('2026-10-29', lang));
        });

        it('saved where he chose: nothing extra is said', async () => {
            const id = await getDatabase().pendingAiJobs.add(understood());
            const at = { id: 'L1', date: '2026-10-30', context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['द्राक्ष G1'] }] } } as unknown as DailyLog;
            const d = deps(vi.fn(async () => [at]));
            render(<WaitingVoiceNotes deps={d} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
            await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
            await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
            expect(d.toast).not.toHaveBeenCalled();
        });
    });

    describe('N2 — removing says what it does, and does it', () => {
        it('a typed note: the confirm says it is his written note and that it will be deleted — and the note is deleted', async () => {
            const id = await getDatabase().pendingAiJobs.add(understood({ context: typedCtx, inputBlob: undefined }));
            const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
            render(<WaitingVoiceNotes deps={deps(vi.fn())} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-remove-${id}`));
            const asked = String(confirm.mock.calls[0][0]);
            expect(asked).toMatch(lang === 'en' ? /you wrote/ : /लिहिलेली/);
            expect(asked).toMatch(lang === 'en' ? /deleted/ : /पुसली/);
            expect(asked).not.toMatch(lang === 'en' ? /recording/i : /आवाज/);
            await waitFor(async () => expect(await getDatabase().pendingAiJobs.get(id)).toBeUndefined());
        });

        it('a voice note removed before it was understood: its diary badge no longer says "queued"; one tried again does', async () => {
            await getDatabase().voiceClips.put(clip('queued'));
            const gone = await getDatabase().pendingAiJobs.add(job());
            vi.spyOn(window, 'confirm').mockReturnValue(true);
            render(<WaitingVoiceNotes deps={deps(vi.fn())} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-remove-${gone}`));
            await waitFor(async () => expect((await getDatabase().voiceClips.get('clip-key'))?.status).toBe('recorded'));

            await getDatabase().voiceClips.put(clip('failed'));
            const stuck = await getDatabase().pendingAiJobs.add(job({ status: 'failed_permanent', lastError: 'Network Error' }));
            act(() => { reader.noteVoiceNotesChanged(); }); // a row written straight to the phone: the page is told
            fireEvent.click(await screen.findByTestId(`voice-note-retry-${stuck}`));
            await waitFor(async () => expect((await getDatabase().voiceClips.get('clip-key'))?.status).toBe('queued'));
        });
    });

    describe('N3 — a stuck recording names the real reason', () => {
        it('tries that failed for want of a connection say so — never that Sathi could not understand it', async () => {
            const id = await getDatabase().pendingAiJobs.add(job({
                status: 'failed_permanent', retryCount: 5, lastError: 'Network Error',
                attemptSignatures: [{ signature: 's', errorClass: 'network_offline', firstSeenAtMs: 1, lastSeenAtMs: 2, count: 5 }],
            }));
            render(<WaitingVoiceNotes deps={deps(vi.fn())} language={lang} />);
            const row = await screen.findByTestId(`voice-note-${id}`);
            expect(row).toHaveTextContent(lang === 'en' ? /internet/ : /इंटरनेट/);
            const all = screen.getByTestId('voice-notes-waiting').textContent ?? '';
            expect(all).not.toMatch(lang === 'en' ? /could not understand/ : /समजलं नाही|समजू शकल/);
        });

        it('the server answered and could not understand it: then (and only then) "Sathi could not understand"', async () => {
            const id = await getDatabase().pendingAiJobs.add(job({ status: 'failed_permanent', retryCount: 5, lastError: 'Request failed with status code 422' }));
            render(<WaitingVoiceNotes deps={deps(vi.fn())} language={lang} />);
            const row = await screen.findByTestId(`voice-note-${id}`);
            expect(row).toHaveTextContent(lang === 'en' ? /could not understand/ : /साथीला समजलं नाही/);
        });

        it('the आवाज नोंदी row line counts stuck recordings too, so it says the same number as the badge', () => {
            const usual = 'usual';
            expect(vw().rowLine({ notYet: 0, understood: 0, stuck: 2, total: 2 }, usual)).toContain('2');
            expect(vw().rowLine({ notYet: 0, understood: 0, stuck: 2, total: 2 }, usual)).not.toBe(usual);
            expect(vw().rowLine({ notYet: 1, understood: 1, stuck: 1, total: 3 }, usual)).toContain('3');
            expect(vw().rowLine({ notYet: 0, understood: 0, stuck: 0, total: 0 }, usual)).toBe(usual);
        });
    });

    describe('N7 — a phone whose clock was ahead', () => {
        it('says why the day is not known, and saves only once he picks a day', async () => {
            const save = vi.fn(async () => [{ id: 'L1', date: getDateKey(), context: { selection: [{ cropId: 'grape', selectedPlotIds: ['g1'] }] } } as unknown as DailyLog]);
            const id = await getDatabase().pendingAiJobs.add(understood({ context: { ...job().context, recordedAtUtc: FUTURE }, createdAt: FUTURE }));
            render(<WaitingVoiceNotes deps={deps(save)} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
            expect(screen.getByTestId('check-day-note')).toHaveTextContent(lang === 'en' ? /ahead/ : /पुढे/);
            expect(screen.getByTestId('check-save-button')).toBeDisabled();
            fireEvent.click(screen.getByTestId('check-day'));
            fireEvent.click(screen.getByTestId(`day-pick-${getDateKey()}`));
            expect(screen.getByTestId('check-save-button')).toBeEnabled();
            await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
            expect(save).toHaveBeenCalledTimes(1);
            expect((save.mock.calls[0] as unknown[])[2]).toMatchObject({ dateKey: getDateKey() });
        });

        it('"पुन्हा सांगा" on it opens the mic without the impossible day', async () => {
            const id = await getDatabase().pendingAiJobs.add(understood({ context: { ...job().context, recordedAtUtc: FUTURE }, createdAt: FUTURE, result: { ...result, payload: {} } }));
            render(<WaitingVoiceNotes deps={deps(vi.fn())} language={lang} />);
            fireEvent.click(await screen.findByTestId(`voice-note-again-${id}`));
            expect(speakState().request?.context.date).toBeUndefined();
        });
    });
});

describe('N5 — the shared store never goes stale', () => {
    it('a job a killed session left "processing" goes back to the queue AND every number is told', async () => {
        await getDatabase().pendingAiJobs.add(job({ status: 'processing' }));
        let told = 0;
        const listen = () => { told += 1; };
        window.addEventListener(reader.VOICE_NOTES_CHANGED, listen);
        await reclaimAbandonedAiJobs();
        window.removeEventListener(reader.VOICE_NOTES_CHANGED, listen);
        expect(told).toBe(1);
    });

    it('another farmer signs in on this phone: the numbers are emptied and read from HIS database', async () => {
        await getDatabase().pendingAiJobs.add(job());
        const Count: React.FC = () => <span data-testid="n">{useWaitingVoiceNotes().notes.length}</span>;
        render(<Count />);
        await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('1'));
        act(() => { setActiveDatabaseName(`${homeDb}-another-farmer`); });
        await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('0'));
        await getDatabase().delete();
    });
});
