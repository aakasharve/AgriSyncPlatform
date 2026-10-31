// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1, with MIC-1) — "बदला" by speaking, end to end on a stand-in
 * app: the entry's current parts → the big mic (THE ONE mic) → his words understood, NOT saved → back on the screen,
 * before → after (the changed part outlined and tagged, the old value struck through) → "जतन करा" saves a new content
 * version through lane F1's `revise_log_content` (the REAL `UpdateLog` use case; only its queue is a spy) with the merged
 * buckets — every part he did not mention exactly as it was. Nothing is saved on "पुन्हा सांगा" or on back. A record
 * the हजेरी door saved is refused politely. In Marathi and in English.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
const enqueue = vi.hoisted(() => vi.fn(async (_payload: unknown) => 'mut-1'));
vi.mock('../../../application/usecases/sync/ReviseLogContentCommand', () => ({ ReviseLogContentCommand: { enqueue } }));
const postLabourCorrection = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock('../../../features/labour/data/labourCorrectionsClient', () => ({ postLabourCorrection }));
vi.mock('../../navigation/logRecorder', () => ({
    renderLogRecorder: () => <div data-testid="the-recorder" />,
    renderProcessingScreen: () => <div data-testid="the-waiting-screen" />,
}));
vi.mock('../../../features/logs/components/entry/LogEntryFlow', () => ({ LogEntryFlow: () => null }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));
vi.mock('../../../features/logs/services/pendingQuestionAnswer', () => ({ abandonPendingQuestionAnswer: vi.fn() }));

import { LogVerificationStatus, type AgriLogResponse, type AppStatus, type DailyLog, type FarmerProfile, type LogScope } from '../../../types';
import { updateLog } from '../../../application/usecases/UpdateLog';
import type { LogsRepository } from '../../../application/ports';
import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost, type CorrectionSaveDeps } from '../SpeakHost';
import { withSpeakPurpose } from '../speakFlow';
import { openCorrection, resetSpeakStoreForTests, speakState } from '../speakStore';

const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'x', supportedTasks: [], workflow: [], plots: [{ id: 'g1', name: 'सोनाका', baseline: {}, schedule: {} }] }];
const PROFILE = { activeOperatorId: 'me', operators: [{ id: 'me', name: 'मी', role: 'PRIMARY_OWNER' }], trust: {} } as unknown as FarmerProfile;

const ENTRY: DailyLog = {
    id: 'log-1',
    date: '2026-10-25',
    context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['सोनाका'] }] },
    dayOutcome: 'WORK_RECORDED',
    fullTranscript: 'इथरेल 300 मिली फवारलं, ठिबक दोन तास',
    cropActivities: [{ id: 'a', title: 'फवारणी' }],
    irrigation: [{ id: 'w', method: 'drip', source: 'Well', durationHours: 2 }],
    labour: [],
    inputs: [{ id: 'in', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 300, unit: 'ml' }],
    machinery: [],
    activityExpenses: [],
    contentVersion: 3,
    verification: { required: true, status: LogVerificationStatus.VERIFIED },
    meta: { createdAtISO: '2026-10-25T08:00:00.000Z', createdByOperatorId: 'me' },
} as DailyLog;

const SAID: AgriLogResponse = {
    summary: '', dayOutcome: 'WORK_RECORDED', fullTranscript: 'इथरेल 300 नाही, 350 मिली',
    cropActivities: [], irrigation: [], labour: [], machinery: [], activityExpenses: [], missingSegments: [],
    inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml' }],
};

let drive: { set: (st: AppStatus) => void; history: () => DailyLog[] } = { set: () => undefined, history: () => [] };
const Harness: React.FC<{ start: DailyLog[]; save: CorrectionSaveDeps; refused?: boolean }> = ({ start, save, refused = false }) => {
    const [history, setHistory] = useState<DailyLog[]>(start);
    const [status, setStatus] = useState<AppStatus>('idle');
    const [logScope, setLogScope] = useState<LogScope>(EMPTY);
    drive = { set: setStatus, history: () => history };
    const ctx = {
        status, draftLog: null, lastSavedLogIds: [], logScope, crops: CROPS, history, farmerProfile: PROFILE, farmRole: 'PrimaryOwner',
        currentRoute: 'main', mainView: 'reflect', isContextReady: logScope.selectedCropIds.length > 0,
        handleReset: vi.fn(), setMode: vi.fn(), setStatus, setLogScope, setCurrentRoute: vi.fn(), setMainView: vi.fn(),
    } as unknown as AppRouterContext;
    return <SpeakHost ctx={ctx} save={{ ...save, setHistory }} readRefused={async () => refused} />;
};

/** The real F1 path: `UpdateLog` with a phone store that holds the entry. */
const realSave = () => {
    const saved: DailyLog[] = [];
    const repo = {
        getById: async (id: string) => (id === ENTRY.id ? ENTRY : undefined),
        save: async (log: DailyLog) => { saved.push(log); },
    } as unknown as LogsRepository;
    const deps: CorrectionSaveDeps = {
        updateLog: (logId, updates, profile, reason) => updateLog({ logId, updatedData: updates, actorId: 'me', reason }, repo, profile),
        setHistory: () => undefined,
        profile: PROFILE,
        toast: vi.fn(),
    };
    return { deps, saved };
};

/** He speaks the change: the waiting screen, then the recorder's purpose-aware hand-off (never the auto-save). */
const speak = async (words: AgriLogResponse) => {
    fireEvent.click(screen.getByTestId(screen.queryByTestId('corr-mic') ? 'corr-mic' : 'corr-again'));
    expect(speakState().request?.purpose).toBe('correctEntry');
    expect(screen.getByTestId('the-recorder')).toBeInTheDocument();
    act(() => drive.set('processing'));
    const autoSave = vi.fn(async () => true);
    const sink = withSpeakPurpose(autoSave, { setStatus: st => drive.set(st) });
    await act(async () => { await sink(words, undefined, { recordedAtUtc: 'T', clipId: null } as never); });
    expect(autoSave).not.toHaveBeenCalled();
};

beforeEach(() => { resetSpeakStoreForTests(); enqueue.mockClear(); postLabourCorrection.mockClear(); });
afterEach(() => { cleanup(); resetSpeakStoreForTests(); lang.value = 'mr'; });

describe.each(['mr', 'en'] as const)('"बदला" → speak → before / after → save (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const ml = language === 'en' ? 'ml' : 'मिली';

    it('the screen: the entry as it is now, one big mic and the example lines; no pencil, no form', () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        // spec I18: the work in his language ("फवारणी" is "Spraying" in English mode).
        expect(screen.getByTestId('corr-now')).toHaveTextContent(language === 'en' ? 'Spraying' : 'फवारणी');
        expect(screen.getByTestId('corr-mic')).toBeInTheDocument();
        expect(screen.getByTestId('corr-prompt')).toHaveTextContent(language === 'en' ? 'Say what should change' : 'जे बदलायचं ते बोलून सांगा');
        expect(screen.getByTestId('corr-examples')).toHaveTextContent('350');
        expect(screen.getByTestId('corr-state')).toHaveTextContent(language === 'en' ? 'Confirmed' : 'पक्कं केलं');
        expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('after speaking: the changed part outlined + tagged, the old value struck through; untouched parts unchanged; saves a new version with the merged buckets', async () => {
        const { deps, saved } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak(SAID);
        expect(speakState().request).toBeNull();
        expect(screen.getByTestId('corr-said')).toHaveTextContent('इथरेल 300 नाही, 350 मिली');
        const inputs = screen.getByTestId('corr-part-inputs');
        expect(inputs).toHaveAttribute('data-changed', 'yes');
        expect(within(inputs).getByTestId('corr-changed-inputs')).toHaveTextContent(language === 'en' ? 'Changed' : 'बदललं');
        expect(within(inputs).getByTestId('corr-old-inputs')).toHaveTextContent(`इथरेल · 300 ${ml}`);
        expect(within(inputs).getByTestId('corr-old-inputs').className).toContain('line-through');
        expect(within(inputs).getByTestId('corr-new-inputs')).toHaveTextContent(`इथरेल · 350 ${ml}`);
        expect(screen.getByTestId('corr-part-irrigation')).toHaveAttribute('data-changed', 'no');
        expect(screen.getByTestId('corr-part-crop')).toHaveAttribute('data-changed', 'no');
        // it was confirmed: the new version's true status is said before he saves
        expect(screen.getByTestId('corr-reconfirm')).toBeInTheDocument();
        expect(enqueue).not.toHaveBeenCalled(); // nothing saved by speaking

        await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
        await act(async () => { await Promise.resolve(); });
        expect(enqueue).toHaveBeenCalledTimes(1);
        const payload = enqueue.mock.calls[0][0] as { dailyLogId: string; baseVersion: number; content: Record<string, unknown> };
        expect(payload).toMatchObject({ dailyLogId: 'log-1', baseVersion: 3 });
        expect(payload.content.inputs).toEqual([expect.objectContaining({ productName: 'इथरेल', quantity: 350, unit: 'ml' })]);
        // every bucket he did not mention, exactly as it was
        expect(payload.content.irrigation).toEqual(ENTRY.irrigation);
        expect(payload.content.cropActivities).toEqual(ENTRY.cropActivities);
        expect(payload.content.fullTranscript).toBe(ENTRY.fullTranscript);
        // the phone's copy: the new version, not confirmed (the confirmation was for the old one)
        expect(saved[0]).toMatchObject({ contentVersion: 4, verification: { status: LogVerificationStatus.DRAFT } });
        expect(postLabourCorrection).not.toHaveBeenCalled();
        expect(screen.queryByTestId('corr-screen')).toBeNull();
    });

    it('"पुन्हा सांगा" forgets what he said (nothing saved) and opens the mic again', async () => {
        const { deps, saved } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak(SAID);
        expect(screen.getByTestId('corr-after')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('corr-again'));
        expect(speakState().correction?.proposal).toBeNull();
        expect(speakState().request?.purpose).toBe('correctEntry');
        // he goes back from the mic without speaking: the screen is as it was before he spoke
        fireEvent.click(screen.getByTestId('speak-back'));
        expect(screen.getByTestId('corr-mic')).toBeInTheDocument();
        expect(enqueue).not.toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });

    it('back after speaking: nothing is saved, the screen closes', async () => {
        const { deps, saved } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak(SAID);
        fireEvent.click(screen.getByTestId('corr-back'));
        expect(screen.queryByTestId('corr-screen')).toBeNull();
        expect(enqueue).not.toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });

    it('nothing to change understood: says so; no save button', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak({ ...SAID, inputs: [] });
        expect(screen.getByTestId('corr-nothing')).toBeInTheDocument();
        expect(screen.queryByTestId('corr-save')).toBeNull();
    });

    it('D3 + D4: "आत्ता जे आहे" reads as the result screen ("इथरेल · 300 मिली"), never his quoted words', () => {
        const { deps } = realSave();
        const quoted = { ...ENTRY, inputs: [{ ...ENTRY.inputs[0], sourceText: 'इथरेल 300 मिली फवारलं' }] } as DailyLog;
        render(<Harness start={[quoted]} save={deps} />);
        act(() => openCorrection('log-1'));
        expect(screen.getByTestId('corr-now')).toHaveTextContent(`इथरेल · 300 ${ml}`);
        expect(screen.getByTestId('corr-now').textContent).not.toContain('“');
    });

    it('B004: offline, the mic does not record — it says a change needs the internet, and nothing is asked of the recorder', () => {
        const { deps } = realSave();
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        fireEvent.click(screen.getByTestId('corr-mic'));
        expect(speakState().request).toBeNull();
        expect(screen.getByTestId('corr-offline')).toHaveTextContent(language === 'en' ? 'needs the internet' : 'इंटरनेट लागतं');
        online.mockRestore();
        fireEvent.click(screen.getByTestId('corr-mic'));
        expect(speakState().request?.purpose).toBe('correctEntry');
    });

    it('B001: workers named without numbers change nothing; he is told worker changes for this entry are made in हजेरी', async () => {
        const { deps, saved } = realSave();
        render(<Harness start={[{ ...ENTRY, labour: [{ id: 'lb', type: 'HIRED', count: 5, labourAssignmentId: 'asg-1' }] } as DailyLog]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak({ ...SAID, inputs: [], labour: [{ id: 'x', type: 'HIRED', workerNames: ['गणेश'] }] });
        expect(screen.getByTestId('corr-labour-hajeri')).toHaveTextContent(language === 'en' ? 'attendance' : 'हजेरी');
        expect(screen.queryByTestId('corr-nothing')).toBeNull();
        expect(screen.queryByTestId('corr-save')).toBeNull();
        expect(postLabourCorrection).not.toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });

    it('offline labour save: says plainly what was and was not saved, and keeps the before / after on screen to retry', async () => {
        const { deps } = realSave();
        postLabourCorrection.mockRejectedValueOnce(new Error('Network Error'));
        const withLabour = { ...ENTRY, labour: [{ id: 'lb', type: 'HIRED', count: 5, labourAssignmentId: 'asg-1' }] } as DailyLog;
        const repoSave: DailyLog[] = [];
        const save: CorrectionSaveDeps = {
            ...deps,
            updateLog: (logId, updates, profile, reason) => updateLog({ logId, updatedData: updates, actorId: 'me', reason },
                { getById: async () => withLabour, save: async (l: DailyLog) => { repoSave.push(l); } } as unknown as LogsRepository, profile),
        };
        render(<Harness start={[withLabour]} save={save} />);
        act(() => openCorrection('log-1'));
        await speak({ ...SAID, inputs: [], labour: [{ id: 'x', type: 'HIRED', count: 8 }] });
        await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('corr-save-failed')).toHaveTextContent(language === 'en' ? 'Nothing changed on this phone' : 'या फोनवर काहीही बदललं नाही');
        expect(screen.getByTestId('corr-after')).toBeInTheDocument(); // still there: he can press again
        expect(repoSave).toHaveLength(0);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('B002: a change saved earlier that the server refused is said plainly — only on this phone, never "sent"', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} refused />);
        act(() => openCorrection('log-1'));
        expect(await screen.findByTestId('corr-server-refused')).toHaveTextContent(language === 'en' ? 'only on this phone' : 'फक्त या फोनवर');
    });

    it('a हजेरी-door record is refused politely (lane F1): no mic, no save', () => {
        const { deps } = realSave();
        render(<Harness start={[{ ...ENTRY, captureScope: 'labour' }]} save={deps} />);
        act(() => openCorrection('log-1'));
        expect(screen.getByTestId('corr-refused')).toHaveTextContent(language === 'en' ? 'attendance page' : 'हजेरी');
        expect(screen.queryByTestId('corr-mic')).toBeNull();
        expect(screen.queryByTestId('corr-save')).toBeNull();
    });
});
