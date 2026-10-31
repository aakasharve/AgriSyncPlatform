// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 1) — आवाज नोंदी, on a real Dexie (fake-indexeddb):
 *   M1 one recording never makes two logs (a failure after the write never says "not saved"; मागे is blocked while saving;
 *      a second save of the same recording carries the same once-key, so the save finds the log already written);
 *   M2 the page never says "जतन झालं" itself (the save says what reached where);
 *   M3 every row can be removed; a finished job with no usable answer says so, with "पुन्हा सांगा" and "काढून टाका";
 *   M4 a recording the queue gave up on stays (counted), says it plainly, can be tried again or removed; with its sound
 *      gone it says that and never promises "काही हरवत नाही";
 *   M5 only THIS farm's recordings are counted and saved here (a row with no farm: only for a one-farm login);
 *   L3 English mode is English on remove and its confirm;  L5 no polling: read on the change event, nothing redrawn when
 *   nothing changed;  10 a plot named after its crop is said alone.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ lang: 'mr' as 'mr' | 'en', failMark: false, farm: null as null | { currentFarmId: string | null; farms: unknown[] } }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    const ctx = () => ({ language: h.lang, setLanguage: () => undefined, t: (k: string) => t(k, h.lang) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../infrastructure/sync/PendingAiResultsReader', async (orig) => {
    const actual = await orig<typeof import('../../../../infrastructure/sync/PendingAiResultsReader')>();
    return { ...actual, markAiResultReviewed: (id: number) => (h.failMark ? Promise.reject(new Error('disk full')) : actual.markAiResultReviewed(id)) };
});
vi.mock('../../../../core/session/FarmContext', async (orig) => ({
    ...(await orig<typeof import('../../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => h.farm,
}));

import { getDatabase, resetDatabase, type PendingAiJobRecord } from '../../../../infrastructure/storage/DexieDatabase';
import * as reader from '../../../../infrastructure/sync/waitingVoiceNotes';
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
const understood = (over: Partial<PendingAiJobRecord> = {}) => job({ status: 'completed', result: { operationType: 'voice_parse', receivedAtUtc: '2026-10-31T09:00:00.000Z', payload: { parsedLog: PARSED } }, ...over });
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', plots: [{ id: 'g1', name: 'द्राक्ष G1' }] }] as unknown as CropProfile[];
const deps = (save: VoiceNoteCheckDeps['save'], over: Partial<VoiceNoteCheckDeps> = {}): VoiceNoteCheckDeps => ({
    crops: CROPS, profile: { operators: [], activeOperatorId: 'me' } as unknown as FarmerProfile, history: [] as DailyLog[],
    save, returnTo: { route: 'voiceDiary', mainView: 'log' }, toast: vi.fn(), farmId: FARM,
    ...over,
} as VoiceNoteCheckDeps);

beforeEach(async () => {
    h.lang = 'mr'; h.failMark = false; h.farm = { currentFarmId: FARM, farms: [{ farmId: FARM }] };
    resetWaitingVoiceNotesForTests();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('M1 — one recording, one log', () => {
    it('a failure AFTER the log is written never says "not saved"; pressing again saves with the SAME once-key; मागे is blocked while saving', async () => {
        const id = await getDatabase().pendingAiJobs.add(understood());
        let finish!: (logs: DailyLog[]) => void;
        const save = vi.fn<VoiceNoteCheckDeps['save']>()
            .mockImplementationOnce(() => new Promise(r => { finish = r; }))
            .mockResolvedValue([{ id: 'L1' } as DailyLog]);
        h.failMark = true;
        render(<WaitingVoiceNotes deps={deps(save)} language="mr" />);
        fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
        act(() => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(screen.getByTestId('voice-note-check-back')).toBeDisabled();
        await act(async () => { finish([{ id: 'L1' } as DailyLog]); });
        expect(await screen.findByTestId('voice-note-saved-not-cleared')).toBeInTheDocument();
        expect(screen.queryByTestId('check-save-failed')).toBeNull();
        h.failMark = false;
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        const keys = save.mock.calls.map(c => c[2].onceKey);
        expect(keys[0]).toBeTruthy();
        expect(keys[1]).toBe(keys[0]);
        await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
    });
});

describe('M2 — the page never says "जतन झालं" for itself', () => {
    it('after a save, the page adds no "saved" toast of its own (the save says what reached where)', async () => {
        const id = await getDatabase().pendingAiJobs.add(understood());
        const d = deps(vi.fn(async () => [{ id: 'L1' } as DailyLog]));
        render(<WaitingVoiceNotes deps={d} language="mr" />);
        fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
        expect(d.toast).not.toHaveBeenCalledWith('जतन झालं');
    });
});

describe('M3 / M4 — every row can be cleared; nothing vanishes', () => {
    it('a recording not understood yet can be removed (with a confirm), and the number goes down', async () => {
        const id = await getDatabase().pendingAiJobs.add(job());
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="mr" />);
        await screen.findByTestId(`voice-note-${id}`);
        fireEvent.click(screen.getByTestId(`voice-note-remove-${id}`));
        expect(confirm).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
        expect((await reader.listWaitingVoiceNotes()).length).toBe(0);
    });

    it('a finished job with no usable answer says it cannot be opened, and offers "पुन्हा सांगा" and "काढून टाका"', async () => {
        const id = await getDatabase().pendingAiJobs.add(understood({ result: { operationType: 'voice_parse', receivedAtUtc: 'x', payload: {} } }));
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="mr" />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row).toHaveTextContent(voiceNotesWords('mr').cannotOpen);
        expect(screen.getByTestId(`voice-note-again-${id}`)).toBeInTheDocument();
        expect(screen.getByTestId(`voice-note-remove-${id}`)).toBeInTheDocument();
    });

    it('a recording the queue gave up on stays counted, says so, and "पुन्हा प्रयत्न करा" puts it back in the queue', async () => {
        const id = await getDatabase().pendingAiJobs.add(job({ status: 'failed_permanent', retryCount: 5, lastError: 'boom' }));
        expect((await reader.listWaitingVoiceNotes()).map(n => n.state)).toEqual(['stuck']);
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="mr" />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row).toHaveTextContent(voiceNotesWords('mr').chipStuck);
        fireEvent.click(screen.getByTestId(`voice-note-retry-${id}`));
        await waitFor(async () => expect((await getDatabase().pendingAiJobs.get(id))?.status).toBe('pending'));
        expect((await getDatabase().pendingAiJobs.get(id))?.retryCount).toBe(0);
    });

    it('a given-up recording whose sound is gone says so, and the page never promises "काही हरवत नाही" for it', async () => {
        const id = await getDatabase().pendingAiJobs.add(job({ status: 'failed_permanent', inputBlob: undefined }));
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="mr" />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row).toHaveTextContent(voiceNotesWords('mr').chipLost);
        expect(screen.getByTestId('voice-notes-waiting')).not.toHaveTextContent('काही हरवत नाही');
        expect(screen.getByTestId(`voice-note-remove-${id}`)).toBeInTheDocument();
    });
});

describe('M5 — only this farm', () => {
    it('another farm\'s recordings are not counted or shown here', async () => {
        await getDatabase().pendingAiJobs.add(job());
        await getDatabase().pendingAiJobs.add(job({ context: { ...job().context, farmId: 'farm-2' } }));
        expect((await reader.listWaitingVoiceNotes({ farmId: FARM, oneFarm: false })).length).toBe(1);
    });

    it('a row with no farm on it is shown only to a one-farm login', async () => {
        await getDatabase().pendingAiJobs.add(job({ context: { ...job().context, farmId: undefined } }));
        expect((await reader.listWaitingVoiceNotes({ farmId: FARM, oneFarm: true })).length).toBe(1);
        expect((await reader.listWaitingVoiceNotes({ farmId: FARM, oneFarm: false })).length).toBe(0);
    });

    it('the hook (the gear, the row, the page) counts this farm only', async () => {
        await getDatabase().pendingAiJobs.add(job());
        await getDatabase().pendingAiJobs.add(job({ context: { ...job().context, farmId: 'farm-2' } }));
        h.farm = { currentFarmId: FARM, farms: [{ farmId: FARM }, { farmId: 'farm-2' }] };
        const Count: React.FC = () => <span data-testid="n">{useWaitingVoiceNotes().notes.length}</span>;
        render(<Count />);
        await waitFor(() => expect(screen.getByTestId('n')).toHaveTextContent('1'));
    });
});

describe('L3 — English mode is English', () => {
    it('remove button and its confirm', async () => {
        h.lang = 'en';
        const id = await getDatabase().pendingAiJobs.add(job());
        const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="en" />);
        await screen.findByTestId(`voice-note-${id}`);
        expect(screen.getByTestId(`voice-note-remove-${id}`).textContent ?? '').not.toMatch(/[ऀ-ॿ]/);
        fireEvent.click(screen.getByTestId(`voice-note-remove-${id}`));
        expect(String(confirm.mock.calls[0][0])).not.toMatch(/[ऀ-ॿ]/);
    });
});

describe('L5 — no polling', () => {
    it('reads once, then only on the change event; nothing is read on a timer', async () => {
        // Only intervals are faked: the phone database (fake-indexeddb) still answers on its own clock.
        vi.useFakeTimers({ toFake: ['setInterval'] });
        await getDatabase().pendingAiJobs.add(job());
        const table = getDatabase().pendingAiJobs;
        const spy = vi.spyOn(table, 'toArray');
        const Count: React.FC = () => <span data-testid="n">{useWaitingVoiceNotes().notes.length}</span>;
        render(<><Count /><Count /><Count /></>);
        await waitFor(() => expect(screen.getAllByTestId('n').map(n => n.textContent)).toEqual(['1', '1', '1']));
        const first = spy.mock.calls.length;
        expect(first).toBe(1); // three readers, one read
        await act(async () => { vi.advanceTimersByTime(30_000); await Promise.resolve(); });
        expect(spy.mock.calls.length).toBe(first); // no timer reads
        await act(async () => { reader.noteVoiceNotesChanged(); });
        await waitFor(() => expect(spy.mock.calls.length).toBe(first + 1)); // the change event reads once
    });
});

describe('10 — place words', () => {
    it('a row says a plot named after its crop alone, never "द्राक्ष · द्राक्ष G1"', async () => {
        const id = await getDatabase().pendingAiJobs.add(understood());
        render(<WaitingVoiceNotes deps={deps(vi.fn())} language="mr" />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row.textContent).toContain('द्राक्ष G1');
        expect(row.textContent).not.toContain('द्राक्ष · द्राक्ष');
    });
});
