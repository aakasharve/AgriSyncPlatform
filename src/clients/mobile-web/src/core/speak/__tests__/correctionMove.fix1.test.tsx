// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF fix pass 1, L8) — for when lane OF-S turns the move switch
 * on: a content change and a move saved together, where the MOVE fails, must never queue the content change twice when
 * he presses "जतन करा" again. The switch is turned on here with a stand-in move that fails once.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
const enqueue = vi.hoisted(() => vi.fn(async (_payload: unknown) => 'mut-1'));
vi.mock('../../../application/usecases/sync/ReviseLogContentCommand', () => ({ ReviseLogContentCommand: { enqueue } }));
const move = vi.hoisted(() => vi.fn());
vi.mock('../../../features/logs/components/correction/correctionCapabilities', () => ({
    canMoveSavedEntry: () => true,
    canQueueLabourCountOffline: () => false,
    queueSavedEntryMove: move,
}));
vi.mock('../../navigation/logRecorder', () => ({ renderLogRecorder: () => null, renderProcessingScreen: () => null }));
vi.mock('../../../features/logs/components/entry/LogEntryFlow', () => ({ LogEntryFlow: () => null }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));
vi.mock('../../../core/domain/services/DateKeyService', async (orig) => ({
    ...(await orig<typeof import('../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => '2026-10-31',
}));

import { LogVerificationStatus, type DailyLog, type FarmerProfile, type LogScope } from '../../../types';
import { updateLog } from '../../../application/usecases/UpdateLog';
import type { LogsRepository } from '../../../application/ports';
import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost, type CorrectionSaveDeps } from '../SpeakHost';
import { openCorrection, resetSpeakStoreForTests } from '../speakStore';

const EMPTY: LogScope = { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'x', plots: [{ id: 'g1', name: 'सोनाका' }] }];
const PROFILE = { activeOperatorId: 'me', operators: [{ id: 'me', name: 'मी', role: 'PRIMARY_OWNER' }], trust: {} } as unknown as FarmerProfile;
const ENTRY = {
    id: 'log-1', date: '2026-10-25', dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['सोनाका'] }] },
    cropActivities: [{ id: 'a', title: 'फवारणी' }], irrigation: [], labour: [], machinery: [], activityExpenses: [],
    inputs: [{ id: 'in', method: 'Spray', mix: [], productName: 'इथरेल', quantity: 300, unit: 'ml' }],
    contentVersion: 3, verification: { required: true, status: LogVerificationStatus.DRAFT },
    meta: { createdAtISO: '2026-10-25T08:00:00.000Z', createdByOperatorId: 'me' },
} as unknown as DailyLog;

const Harness: React.FC<{ save: CorrectionSaveDeps; staleHistory?: boolean }> = ({ save, staleHistory = false }) => {
    const [history, setHistoryState] = useState<DailyLog[]>([ENTRY]);
    // `staleHistory`: the screen's copy of the entry is not refreshed after the content save (a slow or racing read).
    const setHistory = staleHistory ? (() => undefined) as typeof setHistoryState : setHistoryState;
    const ctx = {
        status: 'idle', draftLog: null, lastSavedLogIds: [], logScope: EMPTY, crops: CROPS, history, farmerProfile: PROFILE, farmRole: 'PrimaryOwner',
        currentRoute: 'main', mainView: 'reflect', isContextReady: false,
        handleReset: vi.fn(), setMode: vi.fn(), setStatus: vi.fn(), setLogScope: vi.fn(), setCurrentRoute: vi.fn(), setMainView: vi.fn(),
    } as unknown as AppRouterContext;
    return <SpeakHost ctx={ctx} save={{ ...save, setHistory }} />;
};

beforeEach(() => { resetSpeakStoreForTests(); enqueue.mockClear(); move.mockReset(); });
afterEach(() => { cleanup(); resetSpeakStoreForTests(); });

describe.each([false, true])('L8 — content + move: a failed move never queues the content change twice (screen copy stale: %s)', staleHistory => {
    it('the move fails once; "जतन करा" again sends only the move — the content change was queued exactly once', async () => {
        let stored = ENTRY;
        const save: CorrectionSaveDeps = {
            updateLog: (logId, updates, profile, reason) => updateLog({ logId, updatedData: updates, actorId: 'me', reason },
                { getById: async () => stored, save: async (l: DailyLog) => { stored = l; } } as unknown as LogsRepository, profile),
            setHistory: () => undefined, profile: PROFILE, toast: vi.fn(),
        };
        move.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
        render(<Harness save={save} staleHistory={staleHistory} />);
        act(() => openCorrection('log-1'));
        // a content change by tap, and the day moved
        fireEvent.click(screen.getByTestId('corr-toggle-a'));
        fireEvent.click(screen.getByTestId('corr-change-day'));
        fireEvent.click(screen.getByTestId('day-pick-2026-10-24'));
        await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
        await act(async () => { await Promise.resolve(); });
        expect(screen.getByTestId('corr-save-failed')).toBeInTheDocument();
        expect(enqueue).toHaveBeenCalledTimes(1);
        await act(async () => { fireEvent.click(screen.getByTestId('corr-save')); });
        await act(async () => { await Promise.resolve(); });
        expect(enqueue).toHaveBeenCalledTimes(1); // never twice
        expect(move).toHaveBeenCalledTimes(2);
        expect(screen.queryByTestId('corr-screen')).toBeNull();
    });
});
