// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane E1, with MIC-1) — "बदला" by speaking, end to end on a stand-in
 * app: the entry's current parts → the big mic (THE ONE mic) → his words understood, NOT saved → back on the screen,
 * before → after (the changed part outlined and tagged, the old value struck through) → "जतन करा" saves a new content
 * version through lane F1's `revise_log_content` (the REAL `UpdateLog` use case; only its queue is a spy) with the merged
 * buckets — every part he did not mention exactly as it was. Nothing is saved by speaking or on back. A record
 * the हजेरी door saved is refused politely (and, for someone who may open हजेरी, opens that day in the हजेरी वही).
 * In Marathi and in English.
 *
 * Lane OF (founder D-61 = 5A + rule TAP-1): voice first, then typing right under the mic, then "किंवा दाबून बदला" — a
 * tap change, a typed change, remove + undo, add, the plot and the day (read-only until the server can move a saved
 * entry), an offline tap change queued, and the last part that cannot be removed.
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
// Lane OF-S — the two queued routes (a move, a worker count) are spies; the entry's current copy is read from the phone.
const moveEnqueue = vi.hoisted(() => vi.fn(async (_payload: unknown) => 'move-1'));
vi.mock('../../../application/usecases/sync/MoveDailyLogCommand', () => ({ MoveDailyLogCommand: { enqueue: moveEnqueue } }));
const labourEnqueue = vi.hoisted(() => vi.fn(async (_payload: unknown, _seenVersion: number) => 'labour-1'));
vi.mock('../../../application/usecases/sync/CorrectLabourAssignmentCommand', () => ({ CorrectLabourAssignmentCommand: { enqueue: labourEnqueue } }));
vi.mock('../../../features/logs/services/logSyncMutationService', async (orig) => ({
    ...(await orig<typeof import('../../../features/logs/services/logSyncMutationService')>()),
    resolveLogFarmId: async () => 'farm-1',
}));
vi.mock('../../../infrastructure/storage/DexieDatabase', async (orig) => ({
    ...(await orig<typeof import('../../../infrastructure/storage/DexieDatabase')>()),
    getDatabase: () => ({ logs: { get: async () => undefined } }),
}));
vi.mock('../../navigation/logRecorder', () => ({
    renderLogRecorder: () => <div data-testid="the-recorder" />,
    renderProcessingScreen: () => <div data-testid="the-waiting-screen" />,
}));
vi.mock('../../../features/logs/components/entry/LogEntryFlow', () => ({ LogEntryFlow: () => null }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));
vi.mock('../../../features/logs/services/pendingQuestionAnswer', () => ({ abandonPendingQuestionAnswer: vi.fn() }));
const labourOpening = vi.hoisted(() => vi.fn());
vi.mock('../../../features/labour/labourOpening', () => ({ requestLabourOpening: labourOpening }));

import { LogVerificationStatus, type AgriLogResponse, type AppStatus, type DailyLog, type FarmerProfile, type LogScope } from '../../../types';
import { updateLog } from '../../../application/usecases/UpdateLog';
import type { LogsRepository } from '../../../application/ports';
import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost, type CorrectionSaveDeps } from '../SpeakHost';
import type { RefusedChange } from '../../../features/logs/components/correction/refusedRevision';
import { correctionEntryNow, withSpeakPurpose } from '../speakFlow';
import { openCorrection, resetSpeakStoreForTests, speakState } from '../speakStore';
import { getRootStore } from '../../../app/state/RootStore';

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

let drive: { set: (st: AppStatus) => void; history: () => DailyLog[]; text: (t: string) => void } = { set: () => undefined, history: () => [], text: () => undefined };
const openPlace = vi.fn();
const Harness: React.FC<{
    start: DailyLog[]; save: CorrectionSaveDeps; refused?: boolean | RefusedChange; hajeri?: boolean; moneyNotFollowed?: string[];
    readMoney?: (logId: string) => Promise<string[]>;
    // Lane OF-M fix pass 3: the seat (its server-told role, and whether it may check money).
    farmRole?: string; mayReviewMoney?: boolean;
}> = ({ start, save, refused = false, hajeri = false, moneyNotFollowed = [], readMoney, farmRole = 'PrimaryOwner', mayReviewMoney }) => {
    const [history, setHistory] = useState<DailyLog[]>(start);
    const [status, setStatus] = useState<AppStatus>('idle');
    const [logScope, setLogScope] = useState<LogScope>(EMPTY);
    const handleTextReady = vi.fn(async (t: string) => { drive.text(t); });
    drive = { set: setStatus, history: () => history, text: drive.text };
    const ctx = {
        status, draftLog: null, lastSavedLogIds: [], logScope, crops: CROPS, history, farmerProfile: PROFILE, farmRole, mayReviewMoney,
        currentRoute: 'main', mainView: 'reflect', isContextReady: logScope.selectedCropIds.length > 0,
        handleReset: vi.fn(), setMode: vi.fn(), setStatus, setLogScope, setCurrentRoute: vi.fn(), setMainView: vi.fn(),
        handleTextReady, canOpenAttendanceFromHome: hajeri, openPlace,
    } as unknown as AppRouterContext;
    const refusal: RefusedChange | null = refused === true ? { kind: 'revision', reason: 'other' } : refused || null;
    return <SpeakHost ctx={ctx} save={{ ...save, setHistory }} readRefused={async () => refusal} readMoneyNotFollowed={readMoney ?? (async () => moneyNotFollowed)} />;
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
    fireEvent.click(screen.getByTestId('corr-mic'));
    expect(speakState().request?.purpose).toBe('correctEntry');
    expect(screen.getByTestId('the-recorder')).toBeInTheDocument();
    act(() => drive.set('processing'));
    const autoSave = vi.fn(async () => true);
    const sink = withSpeakPurpose(autoSave, { setStatus: st => drive.set(st) });
    await act(async () => { await sink(words, undefined, { recordedAtUtc: 'T', clipId: null } as never); });
    expect(autoSave).not.toHaveBeenCalled();
};

beforeEach(() => { resetSpeakStoreForTests(); enqueue.mockClear(); postLabourCorrection.mockClear(); moveEnqueue.mockClear(); labourEnqueue.mockClear(); labourOpening.mockClear(); openPlace.mockClear(); });

/** The row of one part (by its part key; the first, or the one that is not struck through). */
const rowOf = (part: string): HTMLElement => {
    const rows = screen.getAllByTestId(/^corr-row-/).filter(el => el.getAttribute('data-part') === part);
    return rows.find(el => !el.className.includes('opacity-80')) ?? rows[0];
};
const idOf = (row: HTMLElement): string => row.getAttribute('data-testid')!.replace('corr-row-', '');
afterEach(() => { cleanup(); resetSpeakStoreForTests(); lang.value = 'mr'; });

describe.each(['mr', 'en'] as const)('"बदला" → speak → before / after → save (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const ml = language === 'en' ? 'ml' : 'मिली';

    it('the screen: voice first (one big mic and the example lines), typing right under it, then the parts to tap', () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        // spec I18: the work in his language ("फवारणी" is "Spraying" in English mode).
        expect(screen.getByTestId('corr-rows')).toHaveTextContent(language === 'en' ? 'Spraying' : 'फवारणी');
        // TAP-1 order: the mic, then typing, then "किंवा दाबून बदला"
        const order = ['corr-mic', 'corr-type', 'corr-or-tap', 'corr-plot-row', 'corr-day-row', 'corr-rows', 'corr-add', 'corr-save'].map(id => screen.getByTestId(id));
        order.reduce((a, b) => { expect(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); return b; });
        expect(screen.getByTestId('corr-type')).toHaveTextContent(language === 'en' ? 'If you cannot speak, type here' : 'बोलता येत नसेल तर इथे लिहा');
        expect(screen.getByTestId('corr-or-tap')).toHaveTextContent(language === 'en' ? 'Or change by tapping' : 'किंवा दाबून बदला');
        expect(screen.getByTestId('corr-save')).toBeDisabled(); // nothing changed yet
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
        const inputs = rowOf('inputs');
        const id = idOf(inputs);
        expect(inputs).toHaveAttribute('data-changed', 'yes');
        expect(within(inputs).getByTestId(`corr-tag-${id}`)).toHaveTextContent(language === 'en' ? 'Changed' : 'बदललं');
        expect(within(inputs).getByTestId(`corr-old-${id}`)).toHaveTextContent(`इथरेल · 300 ${ml}`);
        expect(within(inputs).getByTestId(`corr-old-${id}`).className).toContain('line-through');
        expect(within(inputs).getByTestId(`corr-value-${id}`)).toHaveTextContent(`इथरेल · 350 ${ml}`);
        expect(rowOf('irrigation')).toHaveAttribute('data-changed', 'no');
        expect(rowOf('crop')).toHaveAttribute('data-changed', 'no');
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

    it('the mic again after speaking: going back from it changes nothing; nothing is saved by speaking', async () => {
        const { deps, saved } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak(SAID);
        expect(rowOf('inputs')).toHaveAttribute('data-changed', 'yes');
        fireEvent.click(screen.getByTestId('corr-mic'));
        expect(speakState().request?.purpose).toBe('correctEntry');
        // he goes back from the mic without speaking: the screen is as it was (his change still shown, not saved)
        fireEvent.click(screen.getByTestId('speak-back'));
        expect(screen.getByTestId('corr-mic')).toBeInTheDocument();
        expect(rowOf('inputs')).toHaveAttribute('data-changed', 'yes');
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
        expect(screen.getByTestId('corr-save')).toBeDisabled();
    });

    it('D3 + D4: "आत्ता जे आहे" reads as the result screen ("इथरेल · 300 मिली"), never his quoted words', () => {
        const { deps } = realSave();
        const quoted = { ...ENTRY, inputs: [{ ...ENTRY.inputs[0], sourceText: 'इथरेल 300 मिली फवारलं' }] } as DailyLog;
        render(<Harness start={[quoted]} save={deps} />);
        act(() => openCorrection('log-1'));
        expect(screen.getByTestId('corr-rows')).toHaveTextContent(`इथरेल · 300 ${ml}`);
        expect(screen.getByTestId('corr-rows').textContent).not.toContain('“');
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
        expect(screen.getByTestId('corr-save')).toBeDisabled();
        expect(postLabourCorrection).not.toHaveBeenCalled();
        expect(saved).toHaveLength(0);
    });

    it('lane OF-S: a spoken worker count is QUEUED (sent later), never posted — even when posting would fail; saved on this phone', async () => {
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
        expect(postLabourCorrection).not.toHaveBeenCalled();
        expect(labourEnqueue).toHaveBeenCalledTimes(1);
        expect(labourEnqueue.mock.calls[0][0]).toMatchObject({ labourAssignmentId: 'asg-1', dailyLogId: 'log-1', quantity: { workerCount: 8 }, seen: { workerCount: 5 } });
        expect(repoSave).toHaveLength(1);
        expect(repoSave[0].labour[0].count).toBe(8);
        expect(screen.queryByTestId('corr-save-failed')).toBeNull();
        expect(screen.queryByTestId('corr-screen')).toBeNull();
    });

    it('B002: a change saved earlier that the server refused is said plainly — only on this phone, never "sent"', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} refused />);
        act(() => openCorrection('log-1'));
        expect(await screen.findByTestId('corr-server-refused')).toHaveTextContent(language === 'en' ? 'only on this phone' : 'फक्त या फोनवर');
    });

    it('lane OF-M fix pass 1 (review 10): the बदला screen reads the money words again when a sync lands', async () => {
        const { deps } = realSave();
        const reasons: string[] = [];
        render(<Harness start={[ENTRY]} save={deps} readMoney={async () => [...reasons]} />);
        act(() => openCorrection('log-1'));
        await act(async () => { await Promise.resolve(); });
        expect(screen.queryByTestId('corr-money-not-followed')).toBeNull();

        reasons.push('shared'); // the edit's answer arrives while the screen is open
        await act(async () => {
            getRootStore().sync.send({ type: 'TRIGGER' });
            getRootStore().sync.send({ type: 'SYNC_DONE' });
            await Promise.resolve();
        });
        expect(await screen.findByTestId('corr-money-not-followed')).toHaveTextContent(language === 'en' ? 'shared out across plots' : 'प्लॉटमध्ये वाटले');
    });

    it('lane OF-M: money an edit could not change is said plainly on the बदला screen, in his language only', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} moneyNotFollowed={['shared', 'notFound']} />);
        act(() => openCorrection('log-1'));
        const said = await screen.findByTestId('corr-money-not-followed');
        expect(said).toHaveTextContent(language === 'en' ? 'shared out across plots' : 'प्लॉटमध्ये वाटले');
        expect(said).toHaveTextContent(language === 'en' ? 'saved the old way' : 'जुन्या पद्धतीने');
        expect(said.textContent ?? '').not.toMatch(language === 'en' ? /[ऀ-ॿ]/ : /[A-Za-z]/);
    });

    it('a हजेरी-door record, for someone who may not open हजेरी, is refused politely (lane F1): no mic, no save', () => {
        const { deps } = realSave();
        render(<Harness start={[{ ...ENTRY, captureScope: 'labour' }]} save={deps} />);
        act(() => openCorrection('log-1'));
        expect(screen.getByTestId('corr-refused')).toHaveTextContent(language === 'en' ? 'attendance page' : 'हजेरी');
        expect(screen.queryByTestId('corr-mic')).toBeNull();
        expect(screen.queryByTestId('corr-save')).toBeNull();
    });
});

describe.each(['mr', 'en'] as const)('lane OF — "किंवा दाबून बदला" and typing on the बदला screen (%s)', language => {
    beforeEach(() => { lang.value = language; });
    const open = () => {
        const { deps, saved } = realSave();
        render(<Harness start={[ENTRY]} save={deps} />);
        act(() => openCorrection('log-1'));
        return saved;
    };
    const saveNow = async () => {
        await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
        await act(async () => { await Promise.resolve(); });
    };

    it('a tap change: the amount of a product, before → after, saved as a new version with only that change', async () => {
        open();
        fireEvent.click(screen.getByTestId('corr-edit-in'));
        fireEvent.change(screen.getByTestId('tap-product-qty'), { target: { value: '350' } });
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        expect(screen.getByTestId('corr-row-in')).toHaveAttribute('data-changed', 'yes');
        expect(screen.getByTestId('corr-tag-in')).toHaveTextContent(language === 'en' ? 'Changed' : 'बदललं');
        expect(screen.getByTestId('corr-old-in')).toHaveTextContent('इथरेल · 300');
        expect(screen.getByTestId('corr-value-in')).toHaveTextContent('इथरेल · 350');
        await saveNow();
        expect(enqueue).toHaveBeenCalledTimes(1);
        const payload = enqueue.mock.calls[0][0] as { content: Record<string, unknown> };
        expect(payload.content.inputs).toEqual([expect.objectContaining({ productName: 'इथरेल', quantity: 350 })]);
        expect(payload.content.irrigation).toEqual(ENTRY.irrigation);
        expect(screen.queryByTestId('corr-screen')).toBeNull();
    });

    it('a typed change goes to the same understanding as speech (the ONE mic, with what he typed)', async () => {
        const sent: string[] = [];
        drive.text = t => { sent.push(t); };
        open();
        fireEvent.click(screen.getByTestId('corr-type'));
        fireEvent.change(screen.getByTestId('tap-type-input'), { target: { value: 'इथरेल 300 नाही, 350 मिली' } });
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        expect(speakState().request?.purpose).toBe('correctEntry');
        expect(speakState().request?.context.typed).toBe('इथरेल 300 नाही, 350 मिली');
        await act(async () => { await Promise.resolve(); });
        expect(sent).toEqual(['इथरेल 300 नाही, 350 मिली']);
        drive.text = () => undefined;
    });

    it('remove + undo: "काढा" strikes the part through, "परत आणा" brings it back; nothing to save once it is back', () => {
        open();
        fireEvent.click(screen.getByTestId('corr-toggle-a'));
        expect(screen.getByTestId('corr-tag-a')).toHaveTextContent(language === 'en' ? 'Removed' : 'काढलं');
        expect(screen.getByTestId('corr-save')).toBeEnabled();
        fireEvent.click(screen.getByTestId('corr-toggle-a'));
        expect(screen.queryByTestId('corr-tag-a')).toBeNull();
        expect(screen.getByTestId('corr-save')).toBeDisabled();
    });

    it('the last part cannot be removed ("एक तरी भाग राहू द्या")', () => {
        const { deps } = realSave();
        const one = { ...ENTRY, cropActivities: [], irrigation: [] } as DailyLog;
        render(<Harness start={[one]} save={deps} />);
        act(() => openCorrection('log-1'));
        fireEvent.click(screen.getByTestId('corr-toggle-in'));
        expect(screen.getByTestId('corr-keep-one')).toHaveTextContent(language === 'en' ? 'Keep at least one part' : 'एक तरी भाग राहू द्या');
        expect(screen.queryByTestId('corr-tag-in')).toBeNull();
        expect(screen.getByTestId('corr-save')).toBeDisabled();
    });

    it('"+ आणखी जोडा": water added by tapping (method and hours), shown "नवीन", saved with the rest', async () => {
        open();
        fireEvent.click(screen.getByTestId('corr-add'));
        expect(screen.queryByTestId('tap-add-labour')).toBeNull(); // no route can add an engagement: not offered
        fireEvent.click(screen.getByTestId('tap-add-irrigation'));
        fireEvent.click(screen.getByTestId('tap-method-Flood'));
        fireEvent.click(screen.getByTestId('tap-hours-plus'));
        fireEvent.click(screen.getByTestId('tap-hours-plus'));
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        const added = screen.getAllByTestId(/^corr-tag-/).find(el => el.textContent === (language === 'en' ? 'New' : 'नवीन'));
        expect(added).toBeTruthy();
        await saveNow();
        const payload = enqueue.mock.calls[0][0] as { content: { irrigation: Array<{ method?: string; durationHours?: number }> } };
        expect(payload.content.irrigation).toHaveLength(2);
        expect(payload.content.irrigation[1]).toMatchObject({ method: 'Flood', durationHours: 1 });
    });

    it('a part he started to add and cancelled is not kept', () => {
        open();
        fireEvent.click(screen.getByTestId('corr-add'));
        fireEvent.click(screen.getByTestId('tap-add-inputs'));
        fireEvent.click(screen.getByTestId('tap-sheet-cancel'));
        expect(screen.queryAllByTestId(/^corr-tag-/)).toHaveLength(0);
        expect(screen.getByTestId('corr-save')).toBeDisabled();
    });

    it('lane OF-S: the plot and the day of a SAVED entry are offered; a new day is queued as a move and shows on the entry', async () => {
        const saved = open();
        expect(screen.getByTestId('corr-plot-row')).toHaveTextContent('सोनाका');
        expect(screen.getByTestId('corr-day-row')).toHaveTextContent(language === 'en' ? '25 Oct' : '25 ऑक्टो');
        expect(screen.getByTestId('corr-change-plot')).toHaveTextContent(language === 'en' ? 'Change plot' : 'प्लॉट बदला');
        expect(screen.queryByTestId('corr-move-not-yet')).toBeNull();
        fireEvent.click(screen.getByTestId('corr-change-day'));
        fireEvent.click(screen.getByTestId('day-pick-2026-10-24'));
        expect(screen.getByTestId('corr-day-row')).toHaveTextContent(language === 'en' ? '24 Oct' : '24 ऑक्टो');
        await saveNow();
        expect(moveEnqueue).toHaveBeenCalledTimes(1);
        expect(moveEnqueue.mock.calls[0][0]).toMatchObject({ dailyLogId: 'log-1', baseVersion: 3, newLogDate: '2026-10-24' });
        expect(enqueue).not.toHaveBeenCalled(); // nothing else changed: no content version
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ date: '2026-10-24', contentVersion: 4 });
        expect(screen.queryByTestId('corr-screen')).toBeNull();
    });

    it('lane OF-S: offline, "दिवस बदला" still saves — the move is queued like any other change (P10)', async () => {
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        try {
            open();
            fireEvent.click(screen.getByTestId('corr-change-day'));
            fireEvent.click(screen.getByTestId('day-pick-2026-10-23'));
            await saveNow();
            expect(moveEnqueue).toHaveBeenCalledTimes(1);
            expect(screen.queryByTestId('corr-screen')).toBeNull();
        } finally { online.mockRestore(); }
    });

    it('lane OF-S: a refused move is said in plain words on that entry — put back as the server has it, and why', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} refused={{ kind: 'move', reason: 'jobCard' }} />);
        act(() => openCorrection('log-1'));
        const banner = await screen.findByTestId('corr-server-refused');
        expect(banner).toHaveTextContent(language === 'en' ? 'The plot / day was not changed — it is kept as the server has it.' : 'प्लॉट / दिवस बदलला नाही — सर्व्हरवर आहे तसंच ठेवलं.');
        expect(banner).toHaveTextContent(language === 'en' ? 'A job card is linked to this work, so it cannot be moved.' : 'या कामाला काम कार्ड जोडलेलं आहे, त्यामुळे हे काम हलवता येत नाही.');
        expect(banner).not.toHaveTextContent(language === 'en' ? 'only on this phone' : 'फक्त या फोनवर');
    });

    it('lane OF-S: a refused worker count (someone changed it meanwhile) is said the same way', async () => {
        const { deps } = realSave();
        render(<Harness start={[ENTRY]} save={deps} refused={{ kind: 'workers', reason: 'stale' }} />);
        act(() => openCorrection('log-1'));
        const banner = await screen.findByTestId('corr-server-refused');
        expect(banner).toHaveTextContent(language === 'en' ? 'The workers change was not made' : 'मजुरांचा बदल झाला नाही');
        expect(banner).toHaveTextContent(language === 'en' ? 'Someone changed this after you saw it.' : 'तुम्ही पाहिल्यानंतर दुसऱ्या कोणी हे बदललं.');
    });

    it('offline, a tap change still saves: it is queued like any other change (P10)', async () => {
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        open();
        fireEvent.click(screen.getByTestId('corr-edit-a'));
        fireEvent.click(screen.getByTestId('tap-work-Weeding'));
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        expect(screen.getByTestId('corr-value-a')).toHaveTextContent(language === 'en' ? 'Weeding' : 'खुरपणी');
        await saveNow();
        expect(enqueue).toHaveBeenCalledTimes(1);
        const payload = enqueue.mock.calls[0][0] as { content: { cropActivities: Array<{ title: string; workTypes: string[] }> } };
        expect(payload.content.cropActivities[0]).toMatchObject({ title: 'खुरपणी', workTypes: ['Weeding'] });
        expect(screen.queryByTestId('corr-screen')).toBeNull();
        online.mockRestore();
    });

    it('lane OF-S: offline, a worker count is queued like any other change (P10) — no "needs the internet"', async () => {
        const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
        const withLabour = { ...ENTRY, labour: [{ id: 'lb', type: 'HIRED', count: 5, labourAssignmentId: 'asg-1' }] } as DailyLog;
        const saved: DailyLog[] = [];
        const deps: CorrectionSaveDeps = {
            ...realSave().deps,
            updateLog: (logId, updates, profile, reason) => updateLog({ logId, updatedData: updates, actorId: 'me', reason },
                { getById: async () => withLabour, save: async (l: DailyLog) => { saved.push(l); } } as unknown as LogsRepository, profile),
        };
        try {
        render(<Harness start={[withLabour]} save={deps} />);
        act(() => openCorrection('log-1'));
        expect(screen.queryByTestId('corr-toggle-lb')).toBeNull(); // an engagement is never removed here
        fireEvent.click(screen.getByTestId('corr-edit-lb'));
        expect(screen.queryByTestId('tap-labour-needs-net')).toBeNull();
        fireEvent.click(screen.getByTestId('tap-count-plus'));
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        expect(screen.getByTestId('corr-value-lb')).toHaveTextContent('6');
        await saveNow();
        expect(screen.queryByTestId('corr-save-failed')).toBeNull();
        expect(postLabourCorrection).not.toHaveBeenCalled();
        expect(labourEnqueue).toHaveBeenCalledTimes(1);
        expect(labourEnqueue.mock.calls[0][0]).toMatchObject({ quantity: { workerCount: 6 }, seen: { workerCount: 5 } });
        expect(enqueue).not.toHaveBeenCalled();
        expect(saved).toHaveLength(1);
        expect(saved[0].labour[0].count).toBe(6);
        } finally { online.mockRestore(); }
    });

    it('D-57: "बदला" on a हजेरी-door record, for someone who may open हजेरी, opens THAT DAY in the हजेरी वही', () => {
        const { deps } = realSave();
        render(<Harness start={[{ ...ENTRY, captureScope: 'labour' }]} save={deps} hajeri />);
        act(() => openCorrection('log-1'));
        expect(screen.queryByTestId('corr-screen')).toBeNull();
        expect(labourOpening).toHaveBeenCalledWith({ screen: 'day', date: '2026-10-25' });
        expect(openPlace).toHaveBeenCalledWith('labour');
        expect(speakState().correction).toBeNull();
    });
});

// ─── Lane OF fix pass 1 ───────────────────────────────────────────────────────────────────────────────────────
/** The real F1 path over THIS entry (the store holds it). */
const saveFor = (entry: DailyLog) => {
    const saved: DailyLog[] = [];
    const deps: CorrectionSaveDeps = {
        updateLog: (logId, updates, profile, reason) => updateLog({ logId, updatedData: updates, actorId: 'me', reason },
            { getById: async (id: string) => (id === entry.id ? entry : undefined), save: async (l: DailyLog) => { saved.push(l); } } as unknown as LogsRepository, profile),
        setHistory: () => undefined, profile: PROFILE, toast: vi.fn(),
    };
    return { deps, saved };
};
const openWith = (entry: DailyLog) => {
    const { deps, saved } = saveFor(entry);
    render(<Harness start={[entry]} save={deps} />);
    act(() => openCorrection(entry.id));
    return saved;
};
const pressSave = async () => {
    await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
    await act(async () => { await Promise.resolve(); });
};

describe.each(['mr', 'en'] as const)('lane OF fix 1 — the बदला screen (%s)', language => {
    beforeEach(() => { lang.value = language; });

    it('H2: an amount is kept as he types it ("1." stays "1."), turned into a number only on ठीक; 1.5 is saved as 1.5', async () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-edit-in'));
        const qty = screen.getByTestId('tap-product-qty') as HTMLInputElement;
        fireEvent.change(qty, { target: { value: '1.' } });
        expect(qty.value).toBe('1.');
        fireEvent.change(qty, { target: { value: '1.5' } });
        fireEvent.click(screen.getByTestId('tap-unit-L'));
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as { content: { inputs: Array<{ quantity?: number }> } };
        expect(payload.content.inputs[0].quantity).toBe(1.5);
    });

    it('H2: a value that is not a number is refused on ठीक with a plain line, and nothing changes', () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-edit-in'));
        fireEvent.change(screen.getByTestId('tap-product-qty'), { target: { value: '3..5' } });
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        expect(screen.getByTestId('tap-number-bad')).toHaveTextContent(language === 'en' ? 'number' : 'आकडा');
        expect(screen.getByTestId('tap-sheet-inputs')).toBeInTheDocument(); // still open: nothing applied
        fireEvent.click(screen.getByTestId('tap-sheet-cancel'));
        expect(screen.getByTestId('corr-save')).toBeDisabled();
    });

    it('fix 2 (H2 leftover): an amount of 0 is refused with what is wrong with 0 — never "that is not a number"', () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-edit-in'));
        fireEvent.change(screen.getByTestId('tap-product-qty'), { target: { value: '0' } });
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        const line = screen.getByTestId('tap-number-bad');
        expect(line).toHaveTextContent(language === 'en' ? 'An amount of 0' : '0 मात्रा');
        expect(line).not.toHaveTextContent(language === 'en' ? 'not a number' : 'हा आकडा नाही');
        expect(screen.getByTestId('tap-sheet-inputs')).toBeInTheDocument(); // still open: nothing applied
    });

    it('L1: "+ आणखी जोडा" starts with nothing chosen: ठीक stays off until he picks the work', () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-add'));
        fireEvent.click(screen.getByTestId('tap-add-cropActivities'));
        expect(screen.queryAllByRole('button', { pressed: true })).toHaveLength(0);
        expect(screen.getByTestId('tap-sheet-ok')).toBeDisabled();
        fireEvent.click(screen.getByTestId('tap-work-Pruning'));
        expect(screen.getByTestId('tap-sheet-ok')).toBeEnabled();
    });

    it('L1: new water starts with no method and no hours: ठीक stays off until one is chosen', () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-add'));
        fireEvent.click(screen.getByTestId('tap-add-irrigation'));
        expect(screen.getByTestId('tap-method-Drip')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('tap-sheet-ok')).toBeDisabled();
    });

    it('M6: planned work and the reminder the factory mirrored from it are ONE row; removing it removes both', async () => {
        const planned = {
            ...ENTRY, cropActivities: [], irrigation: [],
            plannedTasks: [{ id: 't1', title: 'उद्या फवारणी', status: 'pending', plotId: 'g1' }],
            observations: [{ id: 'n1', textRaw: 'उद्या फवारणी', noteType: 'reminder', tags: ['planned_task'], dateKey: '2026-10-25' }],
        } as unknown as DailyLog;
        openWith(planned);
        expect(screen.getAllByTestId(/^corr-row-/).filter(el => el.getAttribute('data-part') === 'planned')).toHaveLength(1);
        fireEvent.click(screen.getByTestId('corr-toggle-t1'));
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as { content: { plannedTasks?: unknown[]; observations?: unknown[] } };
        expect(payload.content.plannedTasks ?? []).toEqual([]);
        expect(payload.content.observations ?? []).toEqual([]);
    });

    it('M6: a reminder note that produced its own task is one row; removing it removes the note AND its task', async () => {
        const fromNote = {
            ...ENTRY, cropActivities: [], irrigation: [],
            observations: [{ id: 'n2', textRaw: 'परवा छाटणी', noteType: 'reminder', dateKey: '2026-10-25' }],
            plannedTasks: [{ id: 't2', title: 'परवा छाटणी', status: 'pending', sourceObservationId: 'n2' }],
        } as unknown as DailyLog;
        openWith(fromNote);
        const plannedRows = screen.getAllByTestId(/^corr-row-/).filter(el => el.textContent?.includes('परवा छाटणी'));
        expect(plannedRows).toHaveLength(1);
        fireEvent.click(within(plannedRows[0]).getByRole('button', { name: language === 'en' ? /Remove/ : /काढा/ }));
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as { content: { plannedTasks?: unknown[]; observations?: unknown[] } };
        expect(payload.content.plannedTasks ?? []).toEqual([]);
        expect(payload.content.observations ?? []).toEqual([]);
    });

    it('L7: what he says is understood against his TAPPED version (the parse is given the working copy)', () => {
        openWith(ENTRY);
        fireEvent.click(screen.getByTestId('corr-edit-in'));
        fireEvent.change(screen.getByTestId('tap-product-qty'), { target: { value: '350' } });
        fireEvent.click(screen.getByTestId('tap-sheet-ok'));
        fireEvent.click(screen.getByTestId('corr-mic'));
        const entry = correctionEntryNow([ENTRY]) as { inputs?: Array<{ quantity?: number }> } | null;
        expect(entry?.inputs?.[0]?.quantity).toBe(350);
    });

    it('L7: a part his words left out is struck through with "परत आणा", like a tapped removal, and comes back on tap', async () => {
        const two = { ...ENTRY, inputs: [ENTRY.inputs[0], { id: 'in2', method: 'Spray', mix: [], productName: 'गंधक', quantity: 2, unit: 'kg' }] } as DailyLog;
        const { deps } = saveFor(two);
        render(<Harness start={[two]} save={deps} />);
        act(() => openCorrection('log-1'));
        await speak(SAID); // one product said: the other is left out
        const gone = screen.getAllByTestId(/^corr-row-/).find(el => el.textContent?.includes('गंधक'))!;
        expect(gone).toHaveAttribute('data-changed', 'yes');
        fireEvent.click(within(gone).getByRole('button', { name: language === 'en' ? /Bring back/ : /परत आणा/ }));
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as { content: { inputs: Array<{ productName?: string }> } };
        expect(payload.content.inputs.map(i => i.productName)).toEqual(expect.arrayContaining(['इथरेल', 'गंधक']));
    });

    it('10: a plot named after its crop is said alone — never "द्राक्ष · द्राक्ष G1" on the title or the place row', () => {
        const named = { ...ENTRY, context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: [language === 'en' ? 'Grapes G1' : 'द्राक्ष G1'] }] } } as DailyLog;
        openWith(named);
        const crop = language === 'en' ? 'Grapes' : 'द्राक्ष';
        expect(screen.getByTestId('corr-title').textContent).not.toContain(`${crop} · ${crop}`);
        // Lane OF-S: the row now also carries "प्लॉट बदला" — the PLACE words are what this checks.
        expect(screen.getByTestId('corr-plot-row').querySelector('span')?.textContent).toBe(`${crop} G1`);
    });
});

// ── lane OF-M fix pass 3 (call 1) — only the entry's maker, or someone who checks money, changes its prices ────────────
const PRICED = {
    ...ENTRY,
    inputs: [{ ...ENTRY.inputs[0], cost: 500 }],
    activityExpenses: [{ id: 'exp', reason: 'डिझेल', category: 'Fuel', totalAmount: 500 }],
    meta: { ...ENTRY.meta, createdByOperatorId: 'owner-1' }, // made by someone else (this phone's person is 'me')
} as DailyLog;
const SAID_PRICES = {
    ...SAID, fullTranscript: 'इथरेल 350 मिली, 900 रुपये; डिझेल 800',
    inputs: [{ id: 'x', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 350, unit: 'ml', cost: 900 }],
    activityExpenses: [{ id: 'y', reason: 'डिझेल', category: 'Fuel', totalAmount: 800 }],
} as unknown as AgriLogResponse;
const openAs = (entry: DailyLog, seat: { farmRole: string; mayReviewMoney: boolean }) => {
    const { deps } = saveFor(entry);
    render(<Harness start={[entry]} save={deps} farmRole={seat.farmRole} mayReviewMoney={seat.mayReviewMoney} />);
    act(() => openCorrection(entry.id));
};
type PricedPayload = { content: { inputs: Array<Record<string, unknown>>; activityExpenses: Array<Record<string, unknown>>; irrigation?: unknown[] } };

describe.each(['mr', 'en'] as const)('lane OF-M fix pass 3 — prices on the बदला screen (%s)', language => {
    beforeEach(() => { lang.value = language; });

    it('someone who did not make the entry and may not check money: its prices stay as saved, said in one plain line; every other part still changes', async () => {
        openAs(PRICED, { farmRole: 'Mukadam', mayReviewMoney: false });
        const line = screen.getByTestId('corr-prices-locked');
        expect(line).toHaveTextContent(language === 'en' ? 'Prices stay as they are' : 'किंमती आहेत तशाच राहतील');
        expect(line.textContent ?? '').not.toMatch(language === 'en' ? /[ऀ-ॿ]/ : /[A-Za-z]/);
        expect(line.textContent ?? '').not.toMatch(/policy|permission|role|access|परवानगी|भूमिका|धोरण|प्रवेश/i);
        // a priced part cannot be removed; a part with no price still can (TAP-1 for what he may change)
        expect(screen.queryByTestId('corr-toggle-in')).toBeNull();
        expect(screen.queryByTestId('corr-toggle-exp')).toBeNull();
        expect(screen.getByTestId('corr-toggle-w')).toBeInTheDocument();

        await speak(SAID_PRICES);
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as PricedPayload;
        // what he said that is not a price lands (350 ml), on the saved line, at its saved price; the ₹800 is not taken
        expect(payload.content.inputs).toEqual([expect.objectContaining({ id: 'in', productName: 'इथरेल', quantity: 350, cost: 500 })]);
        expect(payload.content.activityExpenses).toEqual([expect.objectContaining({ id: 'exp', totalAmount: 500 })]);
    });

    it('his removal of a part with no price saves; the priced parts stay', async () => {
        openAs(PRICED, { farmRole: 'Mukadam', mayReviewMoney: false });
        fireEvent.click(screen.getByTestId('corr-toggle-w'));
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as PricedPayload;
        expect(payload.content.irrigation ?? []).toEqual([]);
        expect(payload.content.inputs).toEqual([expect.objectContaining({ id: 'in', cost: 500 })]);
        expect(payload.content.activityExpenses).toEqual([expect.objectContaining({ id: 'exp', totalAmount: 500 })]);
    });

    it.each([
        ['the entry\'s maker', { ...PRICED, meta: { ...PRICED.meta, createdByOperatorId: 'me' } } as DailyLog, { farmRole: 'Worker', mayReviewMoney: false }],
        ['someone who checks money', PRICED, { farmRole: 'PrimaryOwner', mayReviewMoney: true }],
    ])('%s changes its prices as before', async (_who, entry, seat) => {
        openAs(entry, seat);
        expect(screen.queryByTestId('corr-prices-locked')).toBeNull();
        expect(screen.getByTestId('corr-toggle-in')).toBeInTheDocument();
        await speak(SAID_PRICES);
        await pressSave();
        const payload = enqueue.mock.calls[0][0] as PricedPayload;
        expect(payload.content.inputs).toEqual([expect.objectContaining({ productName: 'इथरेल', quantity: 350, cost: 900 })]);
        expect(payload.content.activityExpenses).toEqual([expect.objectContaining({ reason: 'डिझेल', totalAmount: 800 })]);
    });

    it('a price change the server refused is said plainly: who may change prices', async () => {
        const { deps } = saveFor(PRICED);
        render(<Harness start={[PRICED]} save={deps} refused={{ kind: 'revision', reason: 'pricesNotYours' } as RefusedChange} />);
        act(() => openCorrection('log-1'));
        const said = await screen.findByTestId('corr-server-refused');
        expect(said).toHaveTextContent(language === 'en' ? 'only on this phone' : 'फक्त या फोनवर');
        expect(said).toHaveTextContent(language === 'en' ? 'can change its prices' : 'किंमती फक्त');
    });
});
