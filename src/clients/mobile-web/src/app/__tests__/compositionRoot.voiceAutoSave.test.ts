// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I13, round 2 — I13-V1-m12) — the voice auto-save WIRED in
 * one pass through the real `useAgriLogApp`: the recorder's `onVoiceDraft` reaches the auto-save through the
 * sink ref, the save runs on the commands' `handleAutoSave` stamped `autoSavedFromVoice`, the result lands on
 * `voice.voiceResult` (what AppRouter puts on `ctx.voiceResult`), the closure event names the current farm, and
 * leaving the screen (`handleReset`) drops it. Every piece is tested alone elsewhere; this is the seam between.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { AgriLogResponse, DailyLog } from '../../types';
import type { AutoSaveOptions } from '../hooks/useLogCommands.types';
import type { UseVoiceRecorderProps } from '../../features/voice/useVoiceRecorder.types';

const h = vi.hoisted(() => ({
    recorder: null as UseVoiceRecorderProps | null,
    setStatus: vi.fn(),
    resetVoice: vi.fn(),
    handleAutoSave: vi.fn(),
    emitted: [] as unknown[],
}));

vi.mock('../../features/voice/useVoiceRecorder', () => ({
    useVoiceRecorder: (p: UseVoiceRecorderProps) => {
        h.recorder = p;
        return { setError: vi.fn(), setDraftLog: vi.fn(), setRecordingSegment: vi.fn(), setStatus: h.setStatus, handleResetVoice: h.resetVoice, status: 'idle' };
    },
}));
vi.mock('../hooks/useLogCommands', () => ({
    useLogCommands: () => ({ handleAutoSave: h.handleAutoSave, handleManualSubmit: vi.fn(), handleFinalConfirm: vi.fn(), handleWizardSubmit: vi.fn(), handleUpdateNote: vi.fn(), service: {} }),
}));
vi.mock('../hooks/useAppNavigation', () => ({
    useAppNavigation: () => ({ setMainView: vi.fn(), logIntent: null, setCurrentRoute: vi.fn(), setLastLabourLogIds: vi.fn() }),
}));
vi.mock('../hooks/useAppData', () => ({
    useAppData: () => ({ crops: [], farmerProfile: { operators: [], activeOperatorId: 'op1' }, history: [], plannedTasks: [], isDemoMode: false, setHistory: vi.fn(), setPlannedTasks: vi.fn(), setCrops: vi.fn(), setFarmerProfile: vi.fn() }),
}));
vi.mock('../hooks/useTrustLayer', () => ({ useTrustLayer: () => ({}) }));
vi.mock('../context/LogContext', () => ({
    useLogContext: () => ({ logScope: { selectedCropIds: [], selectedPlotIds: ['p1'], mode: 'single', applyPolicy: 'broadcast' }, setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: true, activeCropId: 'c1', activePlotId: 'p1' }),
}));
vi.mock('../../features/weather/useWeatherMonitor', () => ({ useWeatherMonitor: () => ({}) }));
vi.mock('../../features/location/hooks/useLocationCapture', () => ({ useLocationCapture: () => ({ captureLocation: async () => null }) }));
vi.mock('../../infrastructure/ai/BackendAiClient', () => ({ BackendAiClient: class {} }));
vi.mock('../../infrastructure/farmGeography', () => ({ BackendFarmGeographyClient: class {} }));
vi.mock('../../infrastructure/weather/FarmAnchoredWeatherService', () => ({ FarmAnchoredWeatherService: class {} }));
vi.mock('../../infrastructure/weather/BackendWeatherClient', () => ({ BackendWeatherClient: class {} }));
vi.mock('../../infrastructure/voice/VoicePreprocessor', () => ({ VoicePreprocessor: class {} }));
vi.mock('../../infrastructure/voice/clipLogLink', () => ({
    linkClipToLog: vi.fn(async () => 'clip-1'),
    // PLR-D10 I27 — the recording's server id, named on the create.
    archiveIdForRecording: vi.fn(async () => 'a27a27a2-0000-4000-8000-000000000001'),
}));
vi.mock('../../core/telemetry/eventEmitters', () => ({ emitClosureSubmitted: (p: unknown) => { h.emitted.push(p); } }));

import { useAgriLogApp } from '../compositionRoot';

const FARM = 'a1a1a1a1-0000-4000-8000-0000000000f1';
const LOG = { id: 'LOG-1', fullTranscript: 'चार मजूर आले' } as unknown as DailyLog;
const draft = { dayOutcome: 'WORK_RECORDED', cropActivities: [], irrigation: [], inputs: [], machinery: [], labour: [{ id: 'l', count: 4 }], missingSegments: [] } as unknown as AgriLogResponse;
const recording = { recordedAtUtc: '2026-10-26T05:00:00.000Z', clipId: 'clip-1' };

beforeEach(() => {
    h.recorder = null;
    h.emitted = [];
    vi.clearAllMocks();
    h.handleAutoSave.mockImplementation(async (_d: AgriLogResponse, _p: unknown, o?: AutoSaveOptions) => { await o?.onWritten?.([LOG]); return [LOG]; });
});

describe('useAgriLogApp — the voice auto-save, wired', () => {
    it('recorder hand-off → one stamped save → voice.voiceResult → the closure event for this farm; मागे drops it', async () => {
        const { result } = renderHook(() => useAgriLogApp({ initialCrops: [], currentFarmId: FARM }));
        expect(h.recorder?.onVoiceDraft).toBeTypeOf('function');

        let took = false;
        await act(async () => { took = await h.recorder!.onVoiceDraft!(draft, undefined, recording); });
        expect(took).toBe(true); // the review form is NOT shown
        expect(h.handleAutoSave).toHaveBeenCalledTimes(1);
        expect(h.handleAutoSave.mock.calls[0][2]).toMatchObject({ autoSavedFromVoice: true, voiceClipId: 'a27a27a2-0000-4000-8000-000000000001' });
        expect(result.current.voice.voiceResult).toMatchObject({ logIds: ['LOG-1'], clipId: 'clip-1' });
        expect(h.emitted).toEqual([expect.objectContaining({ farmId: FARM, logId: 'LOG-1', method: 'voice' })]);

        // The same recording again (a re-entry): no second save.
        await act(async () => { await h.recorder!.onVoiceDraft!(draft, undefined, recording); });
        expect(h.handleAutoSave).toHaveBeenCalledTimes(1);

        act(() => result.current.handleReset());
        expect(h.resetVoice).toHaveBeenCalled();
        expect(result.current.voice.voiceResult).toBeNull();
    });

    it('a parse the auto-save declines (nothing understood) goes back to the recorder for the review form', async () => {
        renderHook(() => useAgriLogApp({ initialCrops: [], currentFarmId: FARM }));
        let took = true;
        await act(async () => { took = await h.recorder!.onVoiceDraft!({ ...draft, labour: [] } as AgriLogResponse, undefined, recording); });
        expect(took).toBe(false);
        expect(h.handleAutoSave).not.toHaveBeenCalled();
    });
});
