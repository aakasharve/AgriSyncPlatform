// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 5) — the log tab hands the plot-tap count (armSeq) from LogEntryFlow to THE log
 * recorder: with the flag on the recorder gets the mic card; with it off the recorder is today's (no flowV2 at all).
 * Unrendered element tree, as `log-view-home-reorder.test.tsx`.
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRouterContext } from '../routeContext';
import type { LogEntryFlowProps } from '../../../features/logs/components/entry/LogEntryFlow';
import type { RecorderFlowV2 } from '../../../features/voice/components/recorder/flowV2Types';

function flatten(node: React.ReactNode, acc: React.ReactElement[] = []): React.ReactElement[] {
    if (node === null || node === undefined || typeof node === 'boolean') return acc;
    if (Array.isArray(node)) { node.forEach((c) => flatten(c, acc)); return acc; }
    if (!React.isValidElement(node)) return acc;
    acc.push(node);
    flatten((node.props as { children?: React.ReactNode }).children, acc);
    return acc;
}

const ctx = {
    currentRoute: 'main', mainView: 'log', status: 'idle', mode: 'voice', recordingSegment: null, weatherData: undefined, weatherStatus: 'loading',
    boundaryUnset: false, refetchWeather: vi.fn(), setCurrentRoute: vi.fn(), ownerDisplayName: 'Owner', setMainView: vi.fn(), crops: [],
    logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' }, setLogScope: vi.fn(), setMode: vi.fn(),
    setStatus: vi.fn(), hasActiveLogContext: false, isContextReady: true, error: null, errorTranscript: undefined, handleAudioReady: vi.fn(),
    handleTextReady: vi.fn(), handleManualSubmit: vi.fn(), currentLogContext: null, ledgerDefaults: undefined, farmerProfile: { operators: [] },
    draftLog: null, setDraftLog: vi.fn(), provenance: null, voiceStreamingPhase: 'idle', liveCaption: '', getTodayCounts: vi.fn(),
    getContextColorIndicator: () => null, history: [], todayLogs: [], operatorNameById: new Map(), getLogContextSnapshot: vi.fn(),
    handleEditLog: vi.fn(), costSnapshot: { today: 0, cropSoFar: 0, unverifiedToday: 0, scopeLabel: '' }, yesterdayCost: 0,
    setRecordingSegment: vi.fn(), lastSavedLogSummary: [], lastSavedLogIds: [], mockHistory: [], handleReset: vi.fn(), logIntent: null,
    setLogIntent: vi.fn(), lastLabourLogIds: [], farmRole: 'PrimaryOwner',
    todayDayState: { closurePercent: 0, isClosed: false, hasStarted: false, completedCount: 0, plannedCount: 0, pendingCount: 0, unverifiedCount: 0 },
    plannedTasks: [],
} as unknown as AppRouterContext;

async function recorderFlowV2(flagOn: boolean, armSeq: number | undefined): Promise<RecorderFlowV2 | undefined | 'missing'> {
    vi.resetModules();
    vi.doMock('../../../app/featureFlags', async (importOriginal) => {
        const real = await importOriginal<typeof import('../../../app/featureFlags')>();
        return { ...real, FEATURE_FLAGS: { ...real.FEATURE_FLAGS, voiceFlowV2: flagOn } };
    });
    const { renderLogView } = await import('../mainView');
    const { LogEntryFlow } = await import('../../../features/logs/components/entry/LogEntryFlow');
    const flow = flatten(renderLogView(ctx)).find((el) => el.type === LogEntryFlow) as React.ReactElement<LogEntryFlowProps> | undefined;
    if (!flow) return 'missing';
    const recorder = flatten(flow.props.renderRecorder({ onRecordingChange: vi.fn(), armSeq }))
        .find((el) => (el.props as { onAudioCaptured?: unknown }).onAudioCaptured !== undefined);
    if (!recorder) return 'missing';
    return (recorder.props as { flowV2?: RecorderFlowV2 }).flowV2;
}

afterEach(() => { vi.doUnmock('../../../app/featureFlags'); vi.resetModules(); });

describe('renderLogView — voice flow v2 armSeq reaches the recorder', () => {
    it('flag on: the armSeq from the entry flow becomes the recorder\'s mic card', async () => {
        const v2 = await recorderFlowV2(true, 3);
        expect(v2).not.toBe('missing');
        expect((v2 as RecorderFlowV2).silenceHelp).toBe(true);
        expect((v2 as RecorderFlowV2).card?.armSeq).toBe(3);
    });

    it('flag off: no flowV2 at all — today\'s recorder', async () => {
        const v2 = await recorderFlowV2(false, undefined);
        expect(v2).toBeUndefined();
    });
});
