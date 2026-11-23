// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (Task 12; amendments H2, H3, M5) — the REAL container over a real Dexie (fake-indexeddb), with
 * the voice flow v2 flag ON:
 *   - the saved screen comes first; today's result screen (unchanged) is one tap away, its "मागे", the phone's back and the
 *     sticky back all return to the saved screen;
 *   - after 30 s untouched the screen closes itself once, with ONE toast whose claim follows the sync truth (P10);
 *   - it never closes itself while a log is not known to be on its way to the server, or while the sync needs a hand;
 *   - with the flag OFF the container renders exactly today's screen (the existing suites pin the rest).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { flags } = vi.hoisted(() => ({ flags: { voiceFlowV2: true as boolean | undefined } }));
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k in flags ? flags[k as keyof typeof flags] : t[k as keyof typeof t]) }) };
});
vi.mock('../../../../../infrastructure/sync/BackgroundSyncWorker', () => ({
    backgroundSyncWorker: { triggerNow: vi.fn(async () => undefined), start: vi.fn(), stop: vi.fn() },
}));
vi.mock('../../../../../app/providers/DataSourceProvider', () => ({
    useDataSource: () => ({ dataSource: { logs: {} }, auditPort: { append: vi.fn(async () => undefined) } }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-10-26' : actual.getDateKey(t)) };
});
vi.mock('../../../../../infrastructure/voice/VoiceClipRetention', async (orig) => ({
    ...(await orig<typeof import('../../../../../infrastructure/voice/VoiceClipRetention')>()),
    readVoiceClipPlaintext: vi.fn(async () => new Uint8Array([1, 2, 3]).buffer),
}));

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import type { VoiceClipCacheRecord } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import { SyncMutationName } from '../../../../../infrastructure/sync/SyncMutationCatalog';
import { __resetBackStackForTests, dismissTopOverlay, openOverlayCount } from '../../../../../core/navigation/backStack';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import { leaveDetailIfOpen, resetDetailBackForTests } from '../../voiceFlowV2/detailBack';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const NOW = 'c3c3c3c3-0000-4000-8000-000000000003';
const DATE = '2026-10-26';

const HISTORY: DailyLog[] = [{
    id: NOW, date: DATE, dayOutcome: 'WORK_RECORDED', fullTranscript: 'दोन तास पाणी दिलं',
    context: { selection: [{ cropId: 'c1', cropName: 'द्राक्ष', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], labour: [], inputs: [], machinery: [],
    irrigation: [{ id: 'irr', durationHours: 2, sourceText: 'दोन तास पाणी' }],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO: '2026-10-26T10:00:00.000Z', createdByOperatorId: ME },
} as unknown as DailyLog];

const clipRow: VoiceClipCacheRecord = {
    id: 'clip-now', dailyLogId: NOW, farmId: 'farm-1', plotId: 'plot-1', recordedAtUtc: '2026-10-26T10:00:00.000Z', durationMs: 4000,
    mimeType: 'audio/webm', sizeBytes: 3, ciphertext: new Uint8Array([1]).buffer, iv: new Uint8Array([1]), wrappedDekId: 'dek',
    status: 'parsed', retentionPolicy: 'processing_30d', expiresAtUtc: '2026-11-25T00:00:00.000Z', createdAt: 'T', updatedAt: 'T',
} as unknown as VoiceClipCacheRecord;

const createAudio = () => ({ play: vi.fn(async () => undefined), pause: vi.fn(), duration: 4, currentTime: 0, onended: null, ontimeupdate: null, onloadedmetadata: null }) as unknown as HTMLAudioElement;

const props = (over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => ({
    result: { logIds: [NOW], clipId: 'clip-now', key: 'clip-now|T', unclear: [] },
    history: HISTORY,
    farmerProfile: { name: 'सुनील', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
    operatorNameById: new Map(),
    farmId: 'farm-1',
    farmRole: 'PrimaryOwner',
    placeLabel: 'द्राक्ष · प्लॉट १',
    syncQueuedById: new Map([[NOW, true]]),
    onEdit: vi.fn(),
    onBack: vi.fn(),
    onAddAnother: vi.fn(),
    onAutoClose: vi.fn(),
    createAudio,
    ...over,
});
const mount = (p: VoiceResultContainerProps) => render(<VoiceResultContainer {...p} />);

const toasts: Array<{ message: string; type: string }> = [];
const onToast = (e: Event) => { toasts.push((e as CustomEvent<{ message: string; type: string }>).detail); };

beforeEach(async () => {
    flags.voiceFlowV2 = true;
    toasts.length = 0;
    window.addEventListener('agrisync:toast', onToast);
    __resetBackStackForTests();
    resetDetailBackForTests();
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    await getDatabase().voiceClips.bulkPut([clipRow]);
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:clip'), revokeObjectURL: vi.fn() }));
});
afterEach(() => { cleanup(); clearAuthSession(); vi.useRealTimers(); window.removeEventListener('agrisync:toast', onToast); });

const applied = async () => getDatabase().mutationQueue.add({
    deviceId: 'd', clientRequestId: 'r1', mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: NOW },
    createdAt: 'T', status: 'APPLIED', retryCount: 0, updatedAt: 'T',
} as never);

describe('voice flow v2 — the saved screen first', () => {
    it('shows the saved screen, not today\'s result screen', () => {
        mount(props());
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
        expect(screen.queryByTestId('voice-result')).toBeNull();
        expect(screen.getByTestId('vr2-saved-title').textContent).toBe('लक्षात ठेवलं ✓');
    });

    it('the blue button opens today\'s result screen unchanged, with the owner\'s "पक्कं आहे"; its मागे returns', () => {
        mount(props());
        fireEvent.click(screen.getByTestId('vr2-open-detail'));
        expect(screen.getByTestId('voice-result')).toBeTruthy();
        expect(screen.getByTestId('vr-confirm')).toBeTruthy();
        expect(screen.queryByTestId('vr2-saved-card')).toBeNull();
        fireEvent.click(screen.getByTestId('vr-back'));
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
        expect(screen.queryByTestId('voice-result')).toBeNull();
    });

    it('the phone\'s back (the back stack) and the sticky back return from the detail page to the saved screen', () => {
        const p = props();
        mount(p);
        expect(openOverlayCount()).toBe(0);
        fireEvent.click(screen.getByTestId('vr2-open-detail'));
        expect(openOverlayCount()).toBe(1);
        act(() => { expect(dismissTopOverlay()).toBe(true); });
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
        expect(openOverlayCount()).toBe(0);

        fireEvent.click(screen.getByTestId('vr2-open-detail'));
        act(() => { expect(leaveDetailIfOpen()).toBe(true); });
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
        // on the saved screen the sticky back has no step to take: it leaves the surface (the route's own reset)
        expect(leaveDetailIfOpen()).toBe(false);
        expect(p.onBack).not.toHaveBeenCalled();
    });

    it('after 30 s untouched: closes once, with ONE toast that claims only the phone ("लक्षात ठेवलं ✓")', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        act(() => { vi.advanceTimersByTime(29_000); });
        expect(p.onAutoClose).not.toHaveBeenCalled();
        act(() => { vi.advanceTimersByTime(2_000); });
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
        expect(p.onBack).not.toHaveBeenCalled();
        expect(toasts).toEqual([{ message: 'लक्षात ठेवलं ✓ — परत बघायचं असेल तर शेतीचा आढावा मध्ये बघा', type: 'success' }]);
        act(() => { vi.advanceTimersByTime(60_000); });
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
        expect(toasts).toHaveLength(1);
    });

    it('server-acknowledged: the title and the closing toast name the server', async () => {
        await applied();
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        // the server's acknowledgement is read from the queue (Dexie); the DOM change is what is waited for
        await waitFor(() => expect(screen.getByTestId('vr2-saved-title').textContent).toBe('श्रम सफलमध्ये साठवून ठेवलं'));
        fireEvent.pointerDown(screen.getByTestId('vr2-saved-card'));
        act(() => { vi.advanceTimersByTime(31_000); });
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
        expect(toasts[0]?.message).toBe('श्रम सफलमध्ये साठवून ठेवलं — परत बघायचं असेल तर शेतीचा आढावा मध्ये बघा');
    });

    it('no onAutoClose given: the close is the screen\'s own "मागे"', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props({ onAutoClose: undefined });
        mount(p);
        act(() => { vi.advanceTimersByTime(31_000); });
        expect(p.onBack).toHaveBeenCalledTimes(1);
    });

    it('never closes itself while a log is not known to be on its way to the server', () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props({ syncQueuedById: new Map([[NOW, null]]) });
        mount(p);
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('off');
        expect(p.onAutoClose).not.toHaveBeenCalled();
        expect(toasts).toHaveLength(0);
    });

    it('never closes itself while the sync needs a hand', async () => {
        await getDatabase().mutationQueue.add({
            deviceId: 'd', clientRequestId: 'r1', mutationType: SyncMutationName.CreateDailyLog, payload: { dailyLogId: NOW },
            createdAt: 'T', status: 'REJECTED_USER_REVIEW', retryCount: 0, updatedAt: 'T',
        } as never);
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        await waitFor(() => expect(screen.getByTestId('vr2-needs-fix')).toBeTruthy());
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('off');
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(p.onAutoClose).not.toHaveBeenCalled();
    });

    it('a new recording starts on the saved screen again', () => {
        const p = props();
        const view = mount(p);
        fireEvent.click(screen.getByTestId('vr2-open-detail'));
        expect(screen.getByTestId('voice-result')).toBeTruthy();
        view.rerender(<VoiceResultContainer {...p} result={{ ...p.result, key: 'clip-next|T' }} />);
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
    });
});

describe('voice flow v2 OFF', () => {
    it('renders exactly today\'s result screen: no saved screen, no auto-close', () => {
        flags.voiceFlowV2 = undefined;
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        expect(screen.getByTestId('voice-result')).toBeTruthy();
        expect(screen.queryByTestId('vr2-saved')).toBeNull();
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(p.onAutoClose).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('vr-back'));
        expect(p.onBack).toHaveBeenCalledTimes(1);
        expect(openOverlayCount()).toBe(0);
    });
});
