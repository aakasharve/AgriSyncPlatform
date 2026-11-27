// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 1, task 1d (founder Q-A, 27 Nov: "Save after बरोबर").
 * The farm's FIRST record lands on the existing "तपासा आणि जतन करा" screen (`CheckSaveHost`) with what was understood, and
 * the हजेरी card's own words (`attendanceCardCopy`): "बरोबर" saves it, "बदल करा" corrects it first (said again on THE one
 * mic, same place), and the line ""बरोबर" दाबेपर्यंत काहीही जतन होणार नाही." Nothing is saved until "बरोबर"; then the farm's
 * once-only mark is set. Both languages, each alone.
 */
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => ({
    ...(await orig<typeof import('../../../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => '2026-11-28',
}));

import type { AgriLogResponse, DailyLog, FarmerProfile, LogScope } from '../../../../../types';
import type { AppRouterContext } from '../../../../../core/navigation/routeContext';
import { CheckSaveHost } from '../../../../../core/navigation/checkSaveView';
import { bindDraftDecline } from '../../../../voice/draftFacts';
import { resetSpeakStoreForTests, speakState } from '../../../../../core/speak/speakStore';
import { getDatabase, resetDatabase } from '../../../../../infrastructure/storage/DexieDatabase';
import { firstRecordOfferKey } from '../../../../onboarding/firstRun/firstRecord';

const PROFILE = { activeOperatorId: 'me', operators: [{ id: 'me', name: 'मी', role: 'PRIMARY_OWNER' }], trust: {} } as unknown as FarmerProfile;
const WHOLE_FARM: LogScope = { selectedCropIds: ['FARM_GLOBAL'], selectedPlotIds: [], mode: 'single', applyPolicy: 'broadcast' };
const REC = { recordedAtUtc: '2026-11-28T05:00:00.000Z', clipId: 'clip-first' };
const parse = (): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', fullTranscript: 'आज बागेत फवारणी केली',
    cropActivities: [{ id: 'a', title: 'फवारणी' }], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
} as unknown as AgriLogResponse);
const DEVANAGARI = /[ऀ-ॿ]/;

const make = (extra: Partial<AppRouterContext> = {}) => {
    const draft = bindDraftDecline(parse(), 'firstRecord', REC);
    const ctx = {
        draftLog: draft, logScope: WHOLE_FARM, crops: [], farmerProfile: PROFILE, history: [] as DailyLog[], activeFarmId: 'farm-1',
        setDraftLog: vi.fn(), setMode: vi.fn(), setLogScope: vi.fn(),
        saveCheckedDraft: vi.fn(async () => [{ id: 'LOG-1' } as DailyLog]),
        ...extra,
    } as unknown as AppRouterContext;
    render(<CheckSaveHost ctx={ctx} />);
    return { ctx, draft };
};
const markOf = async () => (await getDatabase().uiPrefs.get(firstRecordOfferKey('farm-1')))?.value;

beforeEach(async () => {
    resetSpeakStoreForTests();
    try { await getDatabase().delete(); } catch { /* first run */ }
    await resetDatabase();
});
afterEach(() => { cleanup(); resetSpeakStoreForTests(); vi.useRealTimers(); lang.value = 'mr'; });

describe('R1-g 1d — the first record: "बरोबर" saves, "बदल करा" corrects, nothing before', () => {
    it('Marathi: what was understood, his words, and the हजेरी card\'s line and buttons — nothing saved yet', () => {
        const { ctx } = make();
        expect(screen.getByTestId('check-save')).toHaveAttribute('data-kind', 'firstRecord');
        expect(screen.getByTestId('check-said')).toHaveTextContent('आज बागेत फवारणी केली');
        expect(screen.getByTestId('check-understood')).toHaveTextContent('फवारणी');
        expect(screen.getByTestId('check-first-honesty')).toHaveTextContent('"बरोबर" दाबेपर्यंत काहीही जतन होणार नाही.');
        expect(screen.getByTestId('check-save-button')).toHaveTextContent('बरोबर');
        expect(screen.getByTestId('check-first-change')).toHaveTextContent('बदल करा');
        // the place and the day can still be changed before "बरोबर"
        expect(screen.getByTestId('check-place')).toHaveTextContent('संपूर्ण शेत');
        expect(screen.getByTestId('check-day')).toHaveTextContent('आज');
        expect(ctx.saveCheckedDraft).not.toHaveBeenCalled();
        expect(screen.getByTestId('check-save').textContent).not.toMatch(/[A-Za-z]/);
    });

    it('English: the same, in English only', () => {
        lang.value = 'en';
        make();
        expect(screen.getByTestId('check-first-honesty')).toHaveTextContent('Nothing is saved until you press "Correct".');
        expect(screen.getByTestId('check-save-button')).toHaveTextContent('Correct');
        expect(screen.getByTestId('check-first-change')).toHaveTextContent('Change');
        // his own words are his (Marathi, as he said them); every word the screen itself says is English
        const shown = screen.getByTestId('check-save').cloneNode(true) as HTMLElement;
        shown.querySelector('[data-testid="check-said"]')?.remove();
        shown.querySelector('[data-testid="check-understood"]')?.remove();
        expect(shown.textContent).not.toMatch(DEVANAGARI);
    });

    it('"बरोबर" saves it ONCE, on the place and day shown, and sets the farm\'s mark', async () => {
        const { ctx, draft } = make();
        expect(await markOf()).toBeUndefined();
        fireEvent.click(screen.getByTestId('check-save-button'));
        fireEvent.click(screen.getByTestId('check-save-button'));
        await waitFor(() => expect(ctx.setDraftLog).toHaveBeenCalledWith(null));
        expect(ctx.saveCheckedDraft).toHaveBeenCalledTimes(1);
        expect(ctx.saveCheckedDraft).toHaveBeenCalledWith(draft, undefined, { scope: WHOLE_FARM, dateKey: undefined, recording: REC });
        await waitFor(async () => expect(await markOf()).toBe('saved'), { timeout: 8000 });
    });

    it('a save that wrote nothing: no mark, he stays to press again (nothing lost)', async () => {
        const { ctx } = make({ saveCheckedDraft: vi.fn(async () => null) } as Partial<AppRouterContext>);
        fireEvent.click(screen.getByTestId('check-save-button'));
        expect(await screen.findByTestId('check-save-failed')).toBeInTheDocument();
        expect(ctx.setDraftLog).not.toHaveBeenCalled();
        expect(await markOf()).toBeUndefined();
    });

    it('"बदल करा": the parse is put down and THE one mic opens on the same place — nothing saved', () => {
        vi.useFakeTimers({ toFake: ['setTimeout'] });
        const { ctx } = make();
        fireEvent.click(screen.getByTestId('check-first-change'));
        expect(ctx.setDraftLog).toHaveBeenCalledWith(null);
        expect(ctx.setMode).toHaveBeenCalledWith('voice');
        act(() => { vi.runAllTimers(); });
        expect(speakState().request).toMatchObject({ purpose: 'addToDay', context: { place: 'current' }, returnTo: { route: 'main', mainView: 'log' } });
        expect(ctx.saveCheckedDraft).not.toHaveBeenCalled();
    });
});
