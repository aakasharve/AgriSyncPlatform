// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1b (founder Q5, 28 Nov; CTO ruling 3). The
 * REAL container over a real Dexie (fake-indexeddb), with the voice flow v2 flag ON. After the FIRST record of this farm is
 * saved, its "जतन झालं" screen also shows his line "तुमच्या शेताची माहिती पूर्ण करा. म्हणजे पुढील कामांच्या नोंदी अधिक
 * अचूक होतील." with "शेताची माहिती भरा" (the setup hub) and "नंतर":
 *   - only for the first record on this farm, once (a per-farm mark on the phone), for an owner seat on a phone that went
 *     through the first-record card;
 *   - never as a block, and the screen does not close by itself while the line shows;
 *   - a second record shows the screen as today; an installed phone that passed the first run long ago sees it as today (P11).
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { flags, lang } = vi.hoisted(() => ({ flags: { voiceFlowV2: true as boolean | undefined }, lang: { language: 'mr' as 'mr' | 'en' } }));
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
    const ctx = () => ({ language: lang.language, setLanguage: () => undefined, t: (k: string) => t(k, lang.language) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-11-28' : actual.getDateKey(t)) };
});

import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { clearAuthSession, setAuthSession } from '../../../../../infrastructure/storage/AuthTokenStore';
import { __resetBackStackForTests } from '../../../../../core/navigation/backStack';
import { LogVerificationStatus, type DailyLog, type FarmerProfile } from '../../../../../types';
import { resetDetailBackForTests } from '../../voiceFlowV2/detailBack';
import { VoiceResultContainer, type VoiceResultContainerProps } from '../VoiceResultContainer';
import { forgetPlayedReveals } from '../RingStage';

const ME = 'a1a1a1a1-0000-4000-8000-000000000001';
const FIRST = 'c3c3c3c3-0000-4000-8000-000000000003';
const EARLIER = 'c3c3c3c3-0000-4000-8000-000000000002';
const DATE = '2026-11-28';
const FARM = 'farm-1';
const CARD_KEY = 'shramsafal_first_record_card_v1_seen';
const OFFER_KEY = `shramsafal_first_record_offer_v1:${FARM}`;
const LINE = 'तुमच्या शेताची माहिती पूर्ण करा. म्हणजे पुढील कामांच्या नोंदी अधिक अचूक होतील.';

const log = (id: string, farmId: string | undefined, createdAtISO = '2026-11-28T10:00:00.000Z'): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED', fullTranscript: 'आज बागेत फवारणी केली',
    context: { selection: [{ cropId: 'FARM_GLOBAL', cropName: 'संपूर्ण शेत', selectedPlotIds: [], selectedPlotNames: [] }] },
    cropActivities: [{ id: 'a1', title: 'फवारणी' }], labour: [], inputs: [], machinery: [], irrigation: [],
    verification: { status: LogVerificationStatus.DRAFT, required: true },
    meta: { createdAtISO, createdByOperatorId: ME, ...(farmId ? { farmId } : {}) },
} as unknown as DailyLog);

const props = (over: Partial<VoiceResultContainerProps> = {}): VoiceResultContainerProps => ({
    result: { logIds: [FIRST], clipId: null, key: 'clip-first|T', unclear: [] },
    history: [log(FIRST, FARM)],
    farmerProfile: { name: 'सुनील', activeOperatorId: ME, operators: [] } as unknown as FarmerProfile,
    operatorNameById: new Map(),
    farmId: FARM,
    farmRole: 'PrimaryOwner',
    placeLabel: 'संपूर्ण शेत',
    syncQueuedById: new Map([[FIRST, true]]),
    onEdit: vi.fn(),
    onBack: vi.fn(),
    onAddAnother: vi.fn(),
    onAutoClose: vi.fn(),
    onOpenSetupHub: vi.fn(),
    ...over,
});
const mount = (p: VoiceResultContainerProps) => render(<VoiceResultContainer {...p} />);

const offerMark = async (): Promise<unknown> => (await getDatabase().uiPrefs.get(OFFER_KEY))?.value;
/** Lets the phone's reads (fake IndexedDB) settle before an absence is asserted. */
const settle = async () => { for (let i = 0; i < 5; i += 1) await act(async () => { await new Promise(r => setTimeout(r, 40)); }); };
const DEVANAGARI = /[ऀ-ॿ]/;
/** The phone's database (fake IndexedDB) can take more than waitFor's 1 s under a full parallel run (as the v2 suite notes). */
const DB_WAIT = { timeout: 8000 };

beforeEach(async () => {
    flags.voiceFlowV2 = true;
    lang.language = 'mr';
    __resetBackStackForTests();
    resetDetailBackForTests();
    forgetPlayedReveals();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
    // A phone that went through the first-record card (R1-g 1a) and answered it.
    await getDatabase().uiPrefs.put({ key: CARD_KEY, value: true });
    setAuthSession({ userId: ME, accessToken: 't', expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString() });
});
afterEach(() => { cleanup(); clearAuthSession(); vi.useRealTimers(); });

describe('R1-g 1b — the FIRST record\'s saved screen offers the setup hub', () => {
    it('his line and the two buttons, under "जतन झालं"; the screen does not close by itself while it shows', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        const offer = await screen.findByTestId('vr2-first-record-offer', {}, DB_WAIT);
        expect(screen.getByTestId('vr2-saved-title').textContent).toBe('जतन झालं ✓');
        expect(screen.getByTestId('vr2-first-record-line').textContent).toBe(LINE);
        expect(screen.getByTestId('vr2-first-record-fill').textContent).toBe('शेताची माहिती भरा');
        expect(screen.getByTestId('vr2-first-record-later').textContent).toBe('नंतर');
        expect(offer.textContent).not.toMatch(/[A-Za-z]/);
        // It sits right under the saved card (the first thing after it), not over it: never a block.
        expect(screen.getByTestId('vr2-saved-card').nextElementSibling).toBe(offer);
        expect(screen.getByTestId('vr2-add-another')).toBeTruthy();
        // No self-close while the line shows.
        await waitFor(() => expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('off'), DB_WAIT);
        await act(async () => { await Promise.resolve(); });
        act(() => { vi.advanceTimersByTime(120_000); });
        expect(p.onAutoClose).not.toHaveBeenCalled();
        expect(screen.getByTestId('vr2-first-record-offer')).toBeTruthy();
        // Kept once for THIS recording on this farm.
        await waitFor(async () => expect(await offerMark()).toBe('clip-first|T'), DB_WAIT);
    });

    it('"शेताची माहिती भरा" opens the setup hub, and the offer is used up', async () => {
        const p = props();
        mount(p);
        fireEvent.click(await screen.findByTestId('vr2-first-record-fill', {}, DB_WAIT));
        expect(p.onOpenSetupHub).toHaveBeenCalledTimes(1);
        expect(p.onBack).not.toHaveBeenCalled();
        await waitFor(async () => expect(await offerMark()).toBe('done'), DB_WAIT);
    });

    it('"नंतर" closes the line only: the saved screen stays, and its 30-second close runs again as today', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props();
        mount(p);
        fireEvent.click(await screen.findByTestId('vr2-first-record-later', {}, DB_WAIT));
        expect(screen.queryByTestId('vr2-first-record-offer')).toBeNull();
        expect(screen.getByTestId('vr2-saved-card')).toBeTruthy();
        expect(p.onOpenSetupHub).not.toHaveBeenCalled();
        await waitFor(async () => expect(await offerMark()).toBe('done'), DB_WAIT);
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('running');
        await act(async () => { await Promise.resolve(); });
        act(() => { vi.advanceTimersByTime(31_000); });
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('once: the same farm\'s mark already used, the next "first-looking" record shows the screen as today', async () => {
        await getDatabase().uiPrefs.put({ key: OFFER_KEY, value: 'done' });
        mount(props());
        await settle();
        expect(screen.queryByTestId('vr2-first-record-offer')).toBeNull();
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('running');
    });

    it('a second record on this farm: the screen as today (and the farm\'s mark is closed for good)', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
        const p = props({
            result: { logIds: [FIRST], clipId: null, key: 'clip-second|T', unclear: [] },
            history: [log(EARLIER, FARM, '2026-11-28T08:00:00.000Z'), log(FIRST, FARM)],
        });
        mount(p);
        await waitFor(async () => expect(await offerMark()).toBe('done'), DB_WAIT);
        expect(screen.queryByTestId('vr2-first-record-offer')).toBeNull();
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('running');
        await act(async () => { await Promise.resolve(); });
        act(() => { vi.advanceTimersByTime(31_000); });
        expect(p.onAutoClose).toHaveBeenCalledTimes(1);
    });

    it('a record the phone holds for ANOTHER farm does not count; one with no farm on it does (fails closed)', async () => {
        mount(props({ history: [log(EARLIER, 'farm-2', '2026-11-28T08:00:00.000Z'), log(FIRST, FARM)] }));
        expect(await screen.findByTestId('vr2-first-record-offer', {}, DB_WAIT)).toBeTruthy();
        cleanup();
        await getDatabase().uiPrefs.delete(OFFER_KEY);
        mount(props({ history: [log(EARLIER, undefined, '2026-11-28T08:00:00.000Z'), log(FIRST, FARM)] }));
        await waitFor(async () => expect(await offerMark()).toBe('done'), DB_WAIT);
        expect(screen.queryByTestId('vr2-first-record-offer')).toBeNull();
    });

    it('P11: a phone that passed the first run before the card existed sees the screen as today, and nothing is written', async () => {
        await getDatabase().uiPrefs.delete(CARD_KEY);
        mount(props());
        await settle();
        expect(screen.queryByTestId('vr2-first-record-offer')).toBeNull();
        expect(screen.getByTestId('vr2-idle-bar').getAttribute('data-state')).toBe('running');
        expect(await offerMark()).toBeUndefined();
    });

    it('a worker or a मुकादम seat: no offer (the line speaks to the farm owner)', async () => {
        for (const farmRole of ['Worker', 'Mukadam']) {
            mount(props({ farmRole }));
            await settle();
            expect(screen.queryByTestId('vr2-first-record-offer'), farmRole).toBeNull();
            expect(await offerMark(), farmRole).toBeUndefined();
            cleanup();
        }
    });

    it('English mode: the line and its buttons in English only', async () => {
        lang.language = 'en';
        mount(props());
        const offer = await screen.findByTestId('vr2-first-record-offer', {}, DB_WAIT);
        expect(screen.getByTestId('vr2-first-record-line').textContent).toBe('Complete your farm\'s details, so the records of the work ahead are more accurate.');
        expect(screen.getByTestId('vr2-first-record-fill').textContent).toBe('Fill in the farm details');
        expect(screen.getByTestId('vr2-first-record-later').textContent).toBe('Later');
        expect(offer.textContent).not.toMatch(DEVANAGARI);
    });
});
