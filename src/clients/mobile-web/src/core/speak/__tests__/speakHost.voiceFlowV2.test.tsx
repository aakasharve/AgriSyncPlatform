// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 6, review M7) — `renderProcessingScreen` is shared with SpeakHost, so with the flag
 * on EVERY speak entry point shows the calm step list (the REAL waiting screen here; only the recorder is a stand-in).
 * A recording that never reaches "understood" (the हजेरी door hands it to its own screen) shows step 1 only, then the
 * screen it lands on — never a held "saved" list.
 */
import '@testing-library/jest-dom/vitest';
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const flags = vi.hoisted(() => ({ voiceFlowV2: true, dailyLoop: true }));
vi.mock('../../../app/featureFlags', async orig => {
    const real = await orig<typeof import('../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../navigation/logRecorder', async orig => ({
    ...(await orig<typeof import('../../navigation/logRecorder')>()),
    renderLogRecorder: () => <div data-testid="the-recorder" />,
}));
vi.mock('../../../features/logs/components/shramsathi/ShramSathiUnderstanding', () => ({
    ShramSathiUnderstanding: () => <div data-testid="shram-sathi-understanding" />,
}));
vi.mock('../../../features/logs/services/pendingQuestionAnswer', () => ({ abandonPendingQuestionAnswer: vi.fn(async () => true) }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'me' }));

import type { AppStatus, LogScope } from '../../../types';
import type { AppRouterContext } from '../../navigation/routeContext';
import { SpeakHost } from '../SpeakHost';
import { requestSpeak, resetSpeakStoreForTests } from '../speakStore';
import { noteVoiceJourney, resetVoiceJourneyForTests } from '../../../infrastructure/voice/voiceJourneySignal';
import { releaseHoldForTests } from '../../../features/logs/components/voiceFlowV2/holdOnScreen';

const SCOPE: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['g1'], mode: 'single', applyPolicy: 'broadcast' };
const CROPS = [{ id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'x', plots: [{ id: 'g1', name: 'सोनाका' }] }];
let setStatus: (s: AppStatus, ids?: string[]) => void = () => undefined;

const Harness: React.FC = () => {
    const [s, setS] = useState<{ status: AppStatus; lastSavedLogIds: string[]; logScope: LogScope }>({ status: 'idle', lastSavedLogIds: [], logScope: SCOPE });
    setStatus = (status, ids) => setS(prev => ({ ...prev, status, lastSavedLogIds: ids ?? prev.lastSavedLogIds }));
    const ctx = {
        ...s, draftLog: null, mode: 'voice', currentRoute: 'main', mainView: 'reflect', liveCaption: '', voiceStreamingPhase: 'idle',
        crops: CROPS, history: [], farmerProfile: { operators: [], activeOperatorId: 'me' }, farmRole: 'PrimaryOwner', isContextReady: true,
        handleReset: () => setS(prev => ({ ...prev, status: 'idle' })), setMode: () => undefined, setStatus: (st: AppStatus) => setStatus(st),
        setLogScope: (sc: LogScope) => setS(prev => ({ ...prev, logScope: sc })), setCurrentRoute: () => undefined, setMainView: () => undefined,
    } as unknown as AppRouterContext;
    return <SpeakHost ctx={ctx} />;
};

beforeEach(() => { resetSpeakStoreForTests(); resetVoiceJourneyForTests(); releaseHoldForTests(); });
afterEach(() => { cleanup(); resetSpeakStoreForTests(); resetVoiceJourneyForTests(); releaseHoldForTests(); flags.voiceFlowV2 = true; });

const open = () => {
    render(<Harness />);
    act(() => { requestSpeak({ purpose: 'addToDay', context: { place: { cropId: 'grape', plotId: 'g1' } }, returnTo: { route: 'main', mainView: 'reflect' } }); });
    expect(screen.getByTestId('the-recorder')).toBeInTheDocument();
};

describe('SpeakHost with voice flow v2 on', () => {
    it('a speak entry point shows the step list while it works, ticking on the real events', () => {
        open();
        act(() => setStatus('processing'));
        expect(screen.getByTestId('speak-screen')).toHaveAttribute('data-processing', 'yes');
        expect(screen.getByTestId('voice-journey')).toBeInTheDocument();
        expect(screen.queryByTestId('shram-sathi-understanding')).toBeNull();
        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 5000 }));
        expect(screen.getByTestId('vj-step-kept')).toHaveAttribute('data-state', 'done');
    });

    it('a recording that never reaches "understood": step 1 only, then the screen it lands on, nothing held', () => {
        open();
        act(() => setStatus('processing'));
        act(() => noteVoiceJourney({ kind: 'kept', input: 'audio', durationMs: 5000 }));
        expect(screen.getByTestId('vj-step-kept')).toHaveAttribute('data-state', 'done');
        expect(screen.getByTestId('vj-step-words')).toHaveAttribute('data-state', 'active');
        expect(screen.getByTestId('vj-step-saved')).toHaveAttribute('data-state', 'waiting');
        act(() => setStatus('idle'));
        expect(screen.queryByTestId('voice-journey')).toBeNull();
        expect(screen.getByTestId('the-recorder')).toBeInTheDocument();
        expect(screen.queryByTestId('voice-journey-hold')).toBeNull();
    });

    it('flag off: the same entry point shows today\'s श्रम साथी screen', () => {
        flags.voiceFlowV2 = false;
        open();
        act(() => setStatus('processing'));
        expect(screen.getByTestId('shram-sathi-understanding')).toBeInTheDocument();
        expect(screen.queryByTestId('voice-journey')).toBeNull();
    });
});
