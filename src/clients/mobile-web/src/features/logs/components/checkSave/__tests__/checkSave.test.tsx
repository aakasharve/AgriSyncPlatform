// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF, founder D-58 = 2A) — a parse the voice auto-save did not
 * save by itself lands on "तपासा आणि जतन करा" (the log tab's `CheckSaveHost`), never the old hand-filled form:
 *   1. nothing understood: his words, "पुन्हा सांगा" (THE one mic, same plots), "बोलता येत नसेल तर इथे लिहा", no save;
 *   2. Sathi thinks it was another plot: the place chosen in the canonical crop → plot steps, his guess MARKED (not
 *      chosen); nothing saves until he picks;
 *   3. the phone could not write it: "पुन्हा जतन करा", on the plots it was spoken for;
 * the day chip opens the calendar and the save carries that day. Both languages.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => ({
    ...(await orig<typeof import('../../../../../core/domain/services/DateKeyService')>()),
    getDateKey: () => '2026-10-31',
}));

import type { AgriLogResponse, DailyLog, FarmerProfile, LogScope } from '../../../../../types';
import type { AppRouterContext } from '../../../../../core/navigation/routeContext';
import { CheckSaveHost } from '../../../../../core/navigation/checkSaveView';
import { bindDraftDay, bindDraftDecline } from '../../../../voice/draftFacts';
import { resetSpeakStoreForTests, speakState } from '../../../../../core/speak/speakStore';

const CROPS = [{
    id: 'grape', name: 'Grapes', iconName: 'Grapes', color: 'x', supportedTasks: [], workflow: [],
    plots: [{ id: 'g1', name: 'वरचा', baseline: {}, schedule: {} }, { id: 'g2', name: 'खालचा', baseline: {}, schedule: {} }],
}] as unknown as AppRouterContext['crops'];
const PROFILE = { activeOperatorId: 'me', operators: [{ id: 'me', name: 'मी', role: 'PRIMARY_OWNER' }], trust: {} } as unknown as FarmerProfile;
const G1: LogScope = { selectedCropIds: ['grape'], selectedPlotIds: ['g1'], mode: 'single', applyPolicy: 'broadcast' };

const parse = (over: Partial<AgriLogResponse> = {}): AgriLogResponse => ({
    summary: '', dayOutcome: 'WORK_RECORDED', fullTranscript: 'खुरपणी केली, 5 बायका होत्या',
    cropActivities: [{ id: 'a', title: 'खुरपणी' }], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], missingSegments: [],
    ...over,
} as AgriLogResponse);

const make = (draftLog: AgriLogResponse, extra: Partial<AppRouterContext> = {}) => {
    const ctx = {
        draftLog, logScope: G1, crops: CROPS, farmerProfile: PROFILE, history: [] as DailyLog[],
        setDraftLog: vi.fn(), setMode: vi.fn(), setLogScope: vi.fn(),
        saveCheckedDraft: vi.fn(async () => [{ id: 'saved-1' } as DailyLog]),
        ...extra,
    } as unknown as AppRouterContext;
    render(<CheckSaveHost ctx={ctx} />);
    return ctx;
};

beforeEach(() => { resetSpeakStoreForTests(); vi.useFakeTimers({ toFake: ['setTimeout'] }); });
afterEach(() => { cleanup(); resetSpeakStoreForTests(); vi.useRealTimers(); lang.value = 'mr'; });

describe.each(['mr', 'en'] as const)('"तपासा आणि जतन करा" (%s)', language => {
    beforeEach(() => { lang.value = language; });

    it('nothing understood: his words, the big "पुन्हा सांगा", typing under it; nothing to save', () => {
        const ctx = make(bindDraftDecline(parse({ cropActivities: [], fullTranscript: 'आज ते काम झालं ना, ते…' }), 'unclear'));
        expect(screen.getByTestId('check-save')).toHaveAttribute('data-kind', 'unclear');
        expect(screen.getByTestId('check-title')).toHaveTextContent(language === 'en' ? 'Sathi did not understand it well' : 'साथीला नीट समजलं नाही');
        expect(screen.getByTestId('check-said')).toHaveTextContent('आज ते काम झालं ना, ते…');
        expect(screen.getByTestId('check-unclear')).toBeInTheDocument();
        expect(screen.getByTestId('check-type')).toHaveTextContent(language === 'en' ? 'If you cannot speak, type here' : 'बोलता येत नसेल तर इथे लिहा');
        expect(screen.queryByTestId('check-save-button')).toBeNull();
        // "पुन्हा सांगा": the parse is put down, then THE one mic opens on the same plots
        fireEvent.click(screen.getByTestId('check-say-again'));
        expect(ctx.setDraftLog).toHaveBeenCalledWith(null);
        expect(ctx.setMode).toHaveBeenCalledWith('voice');
        act(() => { vi.runAllTimers(); });
        expect(speakState().request).toMatchObject({ purpose: 'addToDay', context: { place: 'current' }, returnTo: { route: 'main', mainView: 'log' } });
    });

    it('typing goes to the same understanding: THE one mic with what he typed', () => {
        make(bindDraftDecline(parse({ cropActivities: [] }), 'unclear'));
        fireEvent.click(screen.getByTestId('check-type'));
        fireEvent.change(screen.getByTestId('typed-input'), { target: { value: 'खुरपणी केली, 5 बायका' } });
        fireEvent.click(screen.getByTestId('typed-send'));
        act(() => { vi.runAllTimers(); });
        expect(speakState().request?.context.typed).toBe('खुरपणी केली, 5 बायका');
    });

    it('Sathi thinks it was another plot: nothing saves until he picks, in the canonical steps with the guess MARKED', async () => {
        const ctx = make(bindDraftDecline(parse({ suggestedContext: { cropId: 'grape', plotId: 'g2' } } as Partial<AgriLogResponse>), 'otherPlot'));
        expect(screen.getByTestId('check-other-plot')).toHaveTextContent('वरचा');
        expect(screen.getByTestId('check-other-plot')).toHaveTextContent('खालचा');
        expect(screen.getByTestId('check-save-button')).toBeDisabled();
        fireEvent.click(screen.getByTestId('check-place'));
        expect(screen.getByTestId('place-picker')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('flow-crop-grape'));
        expect(screen.getByTestId('flow-plot-mark-g2')).toHaveTextContent(language === 'en' ? "Sathi's guess" : 'साथीचा अंदाज');
        expect(screen.getByTestId('flow-plot-g2')).toHaveAttribute('aria-pressed', 'false'); // marked, never chosen for him
        fireEvent.click(screen.getByTestId('flow-plot-g2'));
        fireEvent.click(screen.getByTestId('place-picker-choose'));
        expect(screen.getByTestId('check-place')).toHaveTextContent('खालचा');
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(ctx.saveCheckedDraft).toHaveBeenCalledWith(
            expect.objectContaining({ fullTranscript: 'खुरपणी केली, 5 बायका होत्या' }), undefined,
            expect.objectContaining({ scope: expect.objectContaining({ selectedPlotIds: ['g2'] }), dateKey: undefined }),
        );
        expect(ctx.setDraftLog).toHaveBeenCalledWith(null);
    });

    it('the phone could not write it: "पुन्हा जतन करा" on the plots it was spoken for; a failure says so and keeps everything', async () => {
        const save = vi.fn(async () => null);
        make(bindDraftDecline(parse({ inputs: [{ id: 'i', productName: 'इथरेल', mix: [], quantity: 300, unit: 'ml' }] as AgriLogResponse['inputs'] }), 'notWritten'), { saveCheckedDraft: save } as Partial<AppRouterContext>);
        expect(screen.getByTestId('check-not-written')).toBeInTheDocument();
        expect(screen.getByTestId('check-understood')).toHaveTextContent('इथरेल');
        expect(screen.getByTestId('check-save-button')).toHaveTextContent(language === 'en' ? 'Save again' : 'पुन्हा जतन करा');
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(save).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({ scope: G1 }));
        expect(screen.getByTestId('check-save-failed')).toBeInTheDocument();
        expect(screen.getByTestId('check-said')).toBeInTheDocument(); // nothing he said is dropped
    });

    it('the day chip opens the calendar; the save carries the day he chose (a past day it was spoken for is kept)', async () => {
        const ctx = make(bindDraftDecline(bindDraftDay(parse(), '2026-10-29'), 'notWritten'));
        expect(screen.getByTestId('check-day')).toHaveTextContent(language === 'en' ? '29 Oct' : '29 ऑक्टो');
        expect(screen.getByTestId('check-day-note')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('check-day'));
        expect(screen.getByTestId('day-pick-2026-10-31')).toBeInTheDocument(); // today, never a future day
        fireEvent.click(screen.getByTestId('day-pick-2026-10-27'));
        expect(screen.getByTestId('check-day')).toHaveTextContent(language === 'en' ? '27 Oct' : '27 ऑक्टो');
        await act(async () => { fireEvent.click(screen.getByTestId('check-save-button')); });
        expect(ctx.saveCheckedDraft).toHaveBeenCalledWith(expect.anything(), undefined, expect.objectContaining({ dateKey: '2026-10-27' }));
    });
});
