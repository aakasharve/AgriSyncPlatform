// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-59 = 3A, register F77) — recordings not saved
 * yet, on a real Dexie (fake-indexeddb):
 *   - THE one reader counts pending + processing (+ a job waiting for its retry) + understood-not-saved, voice only;
 *     a bill photo, a reviewed one and one the queue gave up on are not counted;
 *   - the gear's number, the आवाज नोंदी page's rows and the top line agree (one reader);
 *   - a weak or no internet changes nothing; saving one lowers the number by one;
 *   - an understood one opens "तपासा आणि जतन करा" (never the old form) and saves on the place and day he meant.
 * Both languages for the new words.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { getDatabase, resetDatabase, type PendingAiJobRecord } from '../../../../infrastructure/storage/DexieDatabase';
import { listWaitingVoiceNotes, waitingCounts } from '../../../../infrastructure/sync/waitingVoiceNotes';
import { WaitingVoiceNotes, type VoiceNoteCheckDeps } from '../WaitingVoiceNotes';
import { resetWaitingVoiceNotesForTests } from '../useWaitingVoiceNotes';
import { SetupHubIcon } from '../../../context/components/SetupHubIcon';
import { voiceNotesWords } from '../voiceNotesWords';
import { checkSaveWords } from '../../../logs/components/checkSave/checkSaveWords';
import type { CropProfile, DailyLog, FarmerProfile } from '../../../../types';

const PARSED = {
    summary: '', dayOutcome: 'WORK_RECORDED', fullTranscript: 'ठिबकने 2 तास पाणी दिलं',
    cropActivities: [], irrigation: [{ id: 'w', method: 'Drip', durationHours: 2 }], labour: [], inputs: [], machinery: [],
    activityExpenses: [], questionsForUser: [], missingSegments: [],
};
const job = (over: Partial<PendingAiJobRecord>): Omit<PendingAiJobRecord, 'id'> => ({
    operationType: 'voice_parse',
    context: { farmId: 'farm-1', userId: 'u', operation: 'voice', plotId: 'g1', scopeCropIds: ['grape'], scopePlotIds: ['g1'], recordedAtUtc: '2026-10-30T14:10:00.000Z', idempotencyKey: 'clip-key' },
    status: 'pending', createdAt: '2026-10-30T14:10:01.000Z', updatedAt: '2026-10-30T14:10:01.000Z', retryCount: 0,
    ...over,
});
const understood = (over: Partial<PendingAiJobRecord> = {}) => job({ status: 'completed', result: { operationType: 'voice_parse', receivedAtUtc: '2026-10-31T09:00:00.000Z', payload: { parsedLog: PARSED } }, ...over });

const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', plots: [{ id: 'g1', name: 'वरचा' }] }] as unknown as CropProfile[];
const deps = (save: VoiceNoteCheckDeps['save']): VoiceNoteCheckDeps => ({
    crops: CROPS, profile: { operators: [], activeOperatorId: 'me' } as unknown as FarmerProfile, history: [] as DailyLog[],
    save, returnTo: { route: 'voiceDiary', mainView: 'log' }, toast: vi.fn(),
});

beforeEach(async () => {
    resetWaitingVoiceNotesForTests(); // fix 1 (L5): one shared store — fresh for each test
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});
afterEach(() => { cleanup(); lang.value = 'mr'; vi.restoreAllMocks(); });

describe('THE one reader (D-59)', () => {
    it('counts pending + processing + a retrying one + understood-not-saved (+ fix 1 M4: a given-up one stays, "lost" when its sound is gone); never a bill photo or a reviewed one', async () => {
        const db = getDatabase();
        await db.pendingAiJobs.add(job({ status: 'pending' }));
        await db.pendingAiJobs.add(job({ status: 'processing' }));
        await db.pendingAiJobs.add(job({ status: 'failed' })); // waiting for its next try
        await db.pendingAiJobs.add(understood());
        await db.pendingAiJobs.add(job({ operationType: 'receipt_extract', status: 'pending' })); // a bill photo
        await db.pendingAiJobs.add(understood({ result: { operationType: 'voice_parse', receivedAtUtc: 'x', payload: {}, reviewedAtUtc: 'y' } }));
        await db.pendingAiJobs.add(job({ status: 'failed_permanent' }));
        const notes = await listWaitingVoiceNotes();
        expect(notes.map(n => n.state).sort()).toEqual(['lost', 'pending', 'pending', 'understood', 'working']);
        expect(waitingCounts(notes)).toEqual({ notYet: 3, working: 1, understood: 1, stuck: 1, total: 5 });
    });

    it('a weak or no internet changes nothing: the count is what is on the phone', async () => {
        await getDatabase().pendingAiJobs.add(job({ status: 'pending' }));
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        expect((await listWaitingVoiceNotes()).length).toBe(1);
        online.mockReturnValue(true);
        expect((await listWaitingVoiceNotes()).length).toBe(1);
    });
});

describe.each(['mr', 'en'] as const)('आवाज नोंदी — the recordings not saved yet (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const vw = voiceNotesWords(language);

    it('the gear and the page show the SAME number; the top line says it is safe on the phone and will be understood', async () => {
        const db = getDatabase();
        await db.pendingAiJobs.add(job({ status: 'pending' }));
        await db.pendingAiJobs.add(job({ status: 'pending', context: { ...job({}).context, recordedAtUtc: '2026-10-30T14:20:00.000Z' } }));
        const notes = await listWaitingVoiceNotes();
        render(<><SetupHubIcon tap={0} count={notes.length} /><WaitingVoiceNotes language={language} /></>);
        expect(screen.getByTestId('setup-hub-count')).toHaveTextContent('2');
        const top = await screen.findByTestId('voice-notes-top');
        expect(top).toHaveTextContent(vw.topNotYet(2));
        expect(top).toHaveTextContent(vw.topNotYetBody);
        expect(screen.getAllByTestId(/^voice-note-state-/)).toHaveLength(2);
        screen.getAllByTestId(/^voice-note-state-/).forEach(el => expect(el).toHaveTextContent(vw.chipPending));
    });

    it('understood → tap → "तपासा आणि जतन करा" (no old form) → save on the place and day he meant → put down, the number goes down', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(understood({ context: { ...job({}).context, dateKey: '2026-10-29' } }));
        await db.pendingAiJobs.add(job({ status: 'pending' }));
        const save = vi.fn(async () => [{ id: 'L1' } as DailyLog]);
        render(<WaitingVoiceNotes deps={deps(save)} language={language} />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row).toHaveTextContent(vw.chipUnderstood);
        fireEvent.click(row);
        expect(screen.getByTestId('voice-note-check')).toBeInTheDocument();
        expect(screen.getByTestId('check-title')).toHaveTextContent(checkSaveWords(language).titleCheck);
        expect(screen.getByTestId('check-said')).toHaveTextContent('ठिबकने 2 तास पाणी दिलं');
        expect(screen.getByTestId('check-place')).toHaveTextContent('वरचा');
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ fullTranscript: 'ठिबकने 2 तास पाणी दिलं' }), expect.objectContaining({ source: 'ai' }), expect.objectContaining({
            scope: expect.objectContaining({ selectedPlotIds: ['g1'] }), dateKey: '2026-10-29', stayOnScreen: true,
            recording: { recordedAtUtc: '2026-10-30T14:10:00.000Z', clipId: 'clip-key' },
        }));
        await waitFor(() => expect(screen.queryByTestId(`voice-note-${id}`)).toBeNull());
        expect((await db.pendingAiJobs.get(id))?.result?.reviewedAtUtc).toBeDefined();
        expect((await listWaitingVoiceNotes()).length).toBe(1);
    });

    it('a save that wrote nothing keeps the recording waiting (counted) and says so', async () => {
        const db = getDatabase();
        const id = await db.pendingAiJobs.add(understood());
        render(<WaitingVoiceNotes deps={deps(vi.fn(async () => null))} language={language} />);
        fireEvent.click(await screen.findByTestId(`voice-note-${id}`));
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(screen.getByTestId('check-save-failed')).toBeInTheDocument();
        expect((await db.pendingAiJobs.get(id))?.result?.reviewedAtUtc).toBeUndefined();
        expect((await listWaitingVoiceNotes()).length).toBe(1);
    });

    it('without the save wired (a bare page), an understood row is listed but not offered as a button (P5)', async () => {
        const id = await getDatabase().pendingAiJobs.add(understood());
        render(<WaitingVoiceNotes language={language} />);
        const row = await screen.findByTestId(`voice-note-${id}`);
        expect(row.tagName).toBe('DIV');
    });

    it('the words never say "AI" or "draft", in either language', () => {
        const all = [vw.topNotYet(2), vw.topNotYetBody, vw.topWorking, vw.topWorkingBody, vw.topUnderstood(1), vw.topUnderstoodBody,
            vw.chipPending, vw.chipWorking, vw.chipUnderstood, vw.syncLine(3), vw.badge(2), vw.rowLine({ notYet: 1, understood: 0, stuck: 0, total: 1 }, ''),
            // lane OF fix 2: the new words too
            vw.rowLine({ notYet: 1, understood: 1, stuck: 1, total: 3 }, ''), vw.chipStuck, vw.chipNotSent, vw.chipNotUnderstood, vw.topStuck(2),
            vw.topStuckBody, vw.removeConfirmTyped, vw.alreadySavedAt('', ''), vw.phoneAhead, vw.chooseDay].join(' ');
        expect(all).not.toMatch(/\bAI\b|draft|ड्राफ्ट/i);
        if (language === 'en') expect(all).not.toMatch(/[ऀ-ॿ]/);
        else expect(all).not.toMatch(/[A-Za-z]/);
    });
});
