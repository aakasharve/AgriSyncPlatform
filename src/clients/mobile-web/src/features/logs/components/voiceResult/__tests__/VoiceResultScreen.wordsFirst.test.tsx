// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane RWF, founder 2026-11-20; design v2 of 25 Oct) - after he speaks, HIS WORDS come first and
 * OPEN (no tap, no scroll), then the parts THIS recording added; the plot's whole day is one folded line lower down. After the ring has settled the
 * screen glides to his words; the one thing to do next gets three soft rings. The record is only read (P7).
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const { scroll, ring } = vi.hoisted(() => ({ scroll: vi.fn(), ring: { settle: null as null | (() => void) } }));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../../../i18n/translations');
    const ctx = () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => t(k, 'mr') });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});
vi.mock('../../../../../core/domain/services/DateKeyService', async (orig) => {
    const actual = await orig<typeof import('../../../../../core/domain/services/DateKeyService')>();
    return { ...actual, getDateKey: (t?: Date | string) => (t === undefined ? '2026-11-20' : actual.getDateKey(t)) };
});
vi.mock('../../../../../app/featureFlags', async (orig) => {
    const real = await orig<typeof import('../../../../../app/featureFlags')>();
    return { ...real, FEATURE_FLAGS: new Proxy(real.FEATURE_FLAGS, { get: (t, k) => (k === 'understandingMeter' ? true : t[k as keyof typeof t]) }) };
});
vi.mock('../../../hooks/useDayUnderstanding', () => ({ useDayUnderstanding: () => ({ score: 7, classification: null, refresh: vi.fn(), isLoading: false, error: null }) }));
vi.mock('../../../hooks/usePlotDayUnderstanding', () => ({ usePlotDayUnderstanding: () => ({ score: 7, refresh: vi.fn() }) }));
vi.mock('../scrollBelowHeader', () => ({ scrollBelowHeader: scroll }));
// The canvas ring is the founder's own module; here only the moment it reports "settled" matters.
vi.mock('../RingStage', () => ({
    default: (p: { onSettled?: () => void }) => { ring.settle = p.onSettled ?? null; return <div data-testid="ring-stub" />; },
    forgetPlayedReveals: () => undefined,
}));

import type { DailyLog } from '../../../../../domain/types/log.types';
import type { DayView } from '../resultModel';
import { buildDayView, ringNodesForDay } from '../resultModel';
import VoiceResultScreen, { type VoiceResultScreenProps } from '../VoiceResultScreen';

const DATE = '2026-11-20';
const mk = (id: string, at: string, over: Record<string, unknown>): DailyLog => ({
    id, date: DATE, dayOutcome: 'WORK_RECORDED',
    context: { selection: [{ cropId: 'c1', cropName: 'Grapes', selectedPlotIds: ['plot-1'], selectedPlotNames: ['प्लॉट १'] }] },
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: 'DRAFT', required: true },
    meta: { createdAtISO: at, createdByOperatorId: 'me', farmId: 'farm-1' },
    ...over,
}) as unknown as DailyLog;

const earlier = mk('log-earlier', `${DATE}T08:00:00.000Z`, {
    fullTranscript: 'सकाळी कराटे फवारलं',
    inputs: [{ id: 'ev-e', method: 'Spray', sourceText: 'कराटे फवारलं', mix: [{ id: 'me', productName: 'कराटे', dose: 250, unit: 'ml' }] }],
});
const current = mk('log-now', `${DATE}T10:00:00.000Z`, {
    fullTranscript: 'आज माती लावली, सहा मजूर होते, कॉन्फिडॉर फवारलं',
    cropActivities: [{ id: 'ca', title: 'माती लावणे', sourceText: 'माती लावली' }],
    labour: [{ id: 'lb', count: 6, sourceText: 'सहा मजूर' }],
    inputs: [{ id: 'ev-n', method: 'Spray', sourceText: 'कॉन्फिडॉर फवारलं', mix: [{ id: 'm1', productName: 'कॉन्फिडॉर', dose: 100, unit: 'ml' }] }],
});

const deps = { youIds: new Set(['me']), nameOf: () => 'सुनील', ownName: 'सुनील' } as never;
const dayOf = (history: DailyLog[]): DayView => buildDayView([current], history, deps);

const screenProps = (over: Partial<VoiceResultScreenProps> = {}, history: DailyLog[] = [earlier, current]): VoiceResultScreenProps => ({
    day: dayOf(history), recordingKey: 'k1', placeLabel: 'द्राक्ष · प्लॉट १', farmId: null, nodes: ringNodesForDay([current], DATE), unclear: [],
    clips: new Map(), clipsReady: true, playingId: null, progress: 0, lengthOf: () => 8, heard: new Set(), onTogglePlay: vi.fn(),
    sync: 'onServer', syncQueuedOf: () => true, canConfirm: true, confirmed: false, confirmFailed: false, onConfirm: vi.fn(),
    onEdit: vi.fn(), onBack: vi.fn(), onAddAnother: vi.fn(), onTellMore: vi.fn(), ...over,
});
const show = (over: Partial<VoiceResultScreenProps> = {}, history?: DailyLog[]) => render(<VoiceResultScreen {...screenProps(over, history)} />);

afterEach(() => { cleanup(); scroll.mockReset(); ring.settle = null; });

describe('his words come first and open', () => {
    it('WordsAreOpen_OnTheFirstRender_WithNoTap', () => {
        show();
        expect(screen.getByTestId('vr-words').textContent).toContain('माती लावली');
        expect(screen.getByTestId('vr-words-fold').getAttribute('data-open')).toBe('yes');
        expect(screen.getByTestId('vr-words-hint').textContent).toBe('लपवण्यासाठी दाबा');
    });

    it('ATapOnTheTitle_HidesThem_AndTheHintSaysHowToSeeThemAgain', () => {
        show();
        fireEvent.click(screen.getByTestId('vr-words-toggle'));
        expect(screen.queryByTestId('vr-words')).toBeNull();
        expect(screen.getByTestId('vr-words-hint').textContent).toBe('शब्द पाहण्यासाठी दाबा');
        fireEvent.click(screen.getByTestId('vr-words-toggle'));
        expect(screen.getByTestId('vr-words')).toBeTruthy();
    });

    it('TheWordsSitAboveThePartsOfThisRecording_AndBelowTheRing', () => {
        show();
        const before = (a: HTMLElement, b: HTMLElement) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(before(screen.getByTestId('vr-hero'), screen.getByTestId('vr-words-first'))).toBe(true);
        expect(before(screen.getByTestId('vr-words-first'), screen.getByTestId('vr-day-lines'))).toBe(true);
        expect(before(screen.getByTestId('vr-day-lines'), screen.getByTestId('vr-confirm'))).toBe(true);
    });
});

describe('the parts listed under his words are THIS recording only', () => {
    it('TheListIsTitled_WhatWasUnderstood_AndHoldsOnlyThisRecordingsParts', () => {
        show();
        expect(screen.getByTestId('vr-day-title').textContent).toBe('यातून काय समजलं');
        const list = screen.getByTestId('vr-lines');
        const parts = within(list).getAllByTestId(/^vr-line-(?!row-|head-|body-|red-)/);
        expect(parts.map(l => l.getAttribute('data-part')).sort()).toEqual(['crop', 'inputs', 'labour']);
        // the earlier recording's spray ("कराटे") is not in it
        expect(list.textContent).toContain('कॉन्फिडॉर');
        expect(list.textContent).not.toContain('कराटे');
        expect(parts.every(l => l.getAttribute('data-touched') === 'no')).toBe(true); // all of it is new: no "नवीन" on each line
    });
});

describe('the whole day is one folded line', () => {
    it('WithAnEarlierRecording_TheDayIsFolded_UntilATap', () => {
        show();
        const fold = screen.getByTestId('vr-dayfold');
        expect(fold.getAttribute('data-open')).toBe('no');
        expect(screen.getByTestId('vr-dayfold-title').textContent).toBe('आजचं आतापर्यंत');
        expect(screen.queryByTestId('vr-day-lines-list')).toBeNull();
        fireEvent.click(screen.getByTestId('vr-dayfold-toggle'));
        const list = screen.getByTestId('vr-day-lines-list');
        expect(list.textContent).toContain('कराटे');
        expect(list.textContent).toContain('कॉन्फिडॉर');
        // two sprays in the whole day, one in this recording's own list
        expect(within(list).getAllByTestId(/^vr-day-line-inputs:/)).toHaveLength(2);
        expect(within(screen.getByTestId('vr-lines')).getAllByTestId(/^vr-line-inputs:/)).toHaveLength(1);
    });

    it('TheTwoListsKeepTheirOwnOpenLines', () => {
        show();
        fireEvent.click(screen.getByTestId('vr-dayfold-toggle'));
        fireEvent.click(screen.getByTestId('vr-line-row-part:labour'));
        expect(screen.getByTestId('vr-line-part:labour').getAttribute('data-open')).toBe('yes');
        expect(screen.getByTestId('vr-day-line-part:labour').getAttribute('data-open')).toBe('no');
    });

    it('WithNoEarlierRecording_ThereIsNothingToFold_SoNoFoldIsDrawn', () => {
        show({}, [current]);
        expect(screen.queryByTestId('vr-dayfold')).toBeNull();
        expect(within(screen.getByTestId('vr-lines')).getAllByTestId(/^vr-line-(?!row-|head-|body-|red-)/)).toHaveLength(3);
    });
});

describe('after the ring settles, and the next step', () => {
    it('TheRingSettling_GlidesToHisWords_NotToTheRing', () => {
        show();
        expect(ring.settle).toBeTypeOf('function');
        expect(scroll).not.toHaveBeenCalled();
        ring.settle?.();
        expect(scroll).toHaveBeenCalledTimes(1);
        expect(scroll.mock.calls[0]?.[0]).toBe(screen.getByTestId('vr-latest'));
    });

    it('TheOwnersNextStep_IsPaK_kaAahe_WithTheSoftRings_AndAddAnotherStaysPlain', () => {
        show();
        expect(screen.getByTestId('vr-confirm').className).toContain('motion-safe:animate-plr-cue');
        expect(screen.getByTestId('vr-add-another').className).not.toContain('animate-plr-cue');
    });

    it('ForAnyoneNotAskedToConfirm_TheNextStepIsAddAnother', () => {
        show({ canConfirm: false });
        expect(screen.queryByTestId('vr-confirm')).toBeNull();
        expect(screen.getByTestId('vr-add-another').className).toContain('motion-safe:animate-plr-cue');
    });

    it('AConfirmedRecording_NeedsNoCueOnConfirm_AddAnotherTakesIt', () => {
        show({ confirmed: true });
        expect(screen.getByTestId('vr-add-another').className).toContain('motion-safe:animate-plr-cue');
    });
});
