// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repair FIX-2 - what the voice understanding is given about crops and plots is the OPEN farm's only: the recorder (whose parse
 * context `BackendAiClient.buildContext` lists every crop and plot it is handed) and the log commands take `useAppData().crops`,
 * the open-farm read layer's list, never the phone's whole crop list. Data, not the prompt: the AI call's shape is unchanged.
 * Here the data seam holds farm B's list (the FIX-1 drive's owner of B, 1 plot); the recorder is handed exactly that list.
 */
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UseVoiceRecorderProps } from '../../features/voice/useVoiceRecorder.types';

const B_CROPS = [{ id: 'crop_tomato', name: 'टोमॅटो', plots: [{ id: 'b1', name: 'B1' }] }];
const h = vi.hoisted(() => ({ recorder: null as UseVoiceRecorderProps | null, commandsCrops: null as unknown }));

vi.mock('../../features/voice/useVoiceRecorder', () => ({
    useVoiceRecorder: (p: UseVoiceRecorderProps) => {
        h.recorder = p;
        return { setError: vi.fn(), setDraftLog: vi.fn(), setRecordingSegment: vi.fn(), setStatus: vi.fn(), handleResetVoice: vi.fn(), status: 'idle' };
    },
}));
vi.mock('../hooks/useLogCommands', () => ({
    useLogCommands: (p: { crops: unknown }) => {
        h.commandsCrops = p.crops;
        return { handleAutoSave: vi.fn(), handleManualSubmit: vi.fn(), handleFinalConfirm: vi.fn(), handleWizardSubmit: vi.fn(), handleUpdateNote: vi.fn(), service: {} };
    },
}));
vi.mock('../hooks/useAppNavigation', () => ({
    useAppNavigation: () => ({ setMainView: vi.fn(), logIntent: null, setCurrentRoute: vi.fn(), setLastLabourLogIds: vi.fn() }),
}));
vi.mock('../hooks/useAppData', () => ({
    useAppData: () => ({
        crops: B_CROPS, farmerProfile: { operators: [], activeOperatorId: 'u-me', motors: [], waterResources: [] }, history: [], plannedTasks: [],
        isDemoMode: false, setHistory: vi.fn(), setPlannedTasks: vi.fn(), setCrops: vi.fn(), setFarmerProfile: vi.fn(),
    }),
}));
vi.mock('../../features/profile/farmSetup/useFarmSetup', () => ({ useFarmSetup: () => null }));
vi.mock('../hooks/useTrustLayer', () => ({ useTrustLayer: () => ({}) }));
vi.mock('../hooks/useVoiceAutoSave', () => ({ useVoiceAutoSave: () => ({ sink: vi.fn(), voiceResult: null, saveChecked: vi.fn(), clearVoiceResult: vi.fn() }) }));
vi.mock('../context/LogContext', () => ({
    useLogContext: () => ({ logScope: { selectedCropIds: [], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' }, setLogScope: vi.fn(), currentLogContext: null, hasActiveLogContext: false }),
}));
vi.mock('../../features/weather/useWeatherMonitor', () => ({ useWeatherMonitor: () => ({}) }));
vi.mock('../../features/location/hooks/useLocationCapture', () => ({ useLocationCapture: () => ({ captureLocation: async () => null }) }));
vi.mock('../../infrastructure/ai/BackendAiClient', () => ({ BackendAiClient: class {} }));
vi.mock('../../infrastructure/farmGeography', () => ({ BackendFarmGeographyClient: class {} }));
vi.mock('../../infrastructure/weather/FarmAnchoredWeatherService', () => ({ FarmAnchoredWeatherService: class {} }));
vi.mock('../../infrastructure/weather/BackendWeatherClient', () => ({ BackendWeatherClient: class {} }));
vi.mock('../../infrastructure/voice/VoicePreprocessor', () => ({ VoicePreprocessor: class {} }));

import { useAgriLogApp } from '../compositionRoot';

describe('the voice understanding is given the open farm\'s crops and plots only', () => {
    it('the recorder and the log commands are handed the read layer\'s list for farm B', () => {
        renderHook(() => useAgriLogApp({ initialCrops: [], currentFarmId: 'farm-b' }));
        expect(h.recorder?.crops).toBe(B_CROPS);
        expect(h.commandsCrops).toBe(B_CROPS);
    });
});
