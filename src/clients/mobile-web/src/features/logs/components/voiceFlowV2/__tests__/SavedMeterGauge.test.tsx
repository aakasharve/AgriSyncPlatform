// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: voice-flow-v2-2026-11-23 (design-fidelity pass F3) — the saved card's dial shows the SERVER's number only (P4): the plot's
 * score for a recording with a plot, the farm-day score without one; nothing (the pending words, no needle) when there is none; a
 * declared no-work day says so. Its question is the server's own "tell more" line when there is one, else the first untold part;
 * never a projected "→ N/10".
 */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { state } = vi.hoisted(() => ({ state: { farm: null as number | null, plot: null as number | null, classification: null as string | null, hint: null as string | null } }));
vi.mock('../../../hooks/useDayUnderstanding', () => ({
    useDayUnderstanding: () => ({ score: state.farm, classification: state.classification, isLoading: false, error: null, refresh: async () => undefined }),
}));
vi.mock('../../../hooks/usePlotDayUnderstanding', () => ({
    usePlotDayUnderstanding: () => ({ score: state.plot, refresh: async () => undefined }),
}));
vi.mock('../../../../reflect/overview/usePlotUnderstanding', () => ({
    usePlotUnderstanding: () => ({ hintFor: (plotId: string | null | undefined) => (plotId ? state.hint : null) }),
}));
vi.mock('../../../../../i18n/LanguageContext', async () => {
    const real = await vi.importActual<typeof import('../../../../../i18n/LanguageContext')>('../../../../../i18n/LanguageContext');
    return { ...real, useOptionalLanguage: () => ({ language: 'mr' }) };
});

import SavedMeterGauge, { type SavedMeterGaugeProps } from '../SavedMeterGauge';

const props = (over: Partial<SavedMeterGaugeProps> = {}): SavedMeterGaugeProps => ({
    farmId: 'farm-1', dayDate: '2026-10-26', plotId: 'plot-1', savedLogId: 'L-1', missing: ['machinery', 'observation'],
    onTellMore: vi.fn(), onAddAnother: vi.fn(), ...over,
});

afterEach(() => { cleanup(); Object.assign(state, { farm: null, plot: null, classification: null, hint: null }); });

describe('SavedMeterGauge — the server number only', () => {
    it('no server score: the pending words, no needle, no number', () => {
        render(<SavedMeterGauge {...props()} />);
        const meter = screen.getByTestId('vr2-meter');
        expect(meter.getAttribute('data-state')).toBe('pending');
        expect(screen.queryByTestId('vr2-meter-needle')).toBeNull();
        expect(meter.textContent).not.toMatch(/\/\s*१०/);
    });

    it('a recording with a plot shows THAT plot\'s score, never the farm-day score', () => {
        state.farm = 3; state.plot = 8;
        render(<SavedMeterGauge {...props()} />);
        expect(screen.getByTestId('vr2-meter').getAttribute('data-score')).toBe('8');
        expect(screen.getByTestId('vr2-meter-needle')).toBeTruthy();
        expect(screen.getByTestId('vr2-meter').textContent).toContain('८');
    });

    it('a whole-farm recording shows the farm-day score', () => {
        state.farm = 6; state.plot = 9;
        render(<SavedMeterGauge {...props({ plotId: null })} />);
        expect(screen.getByTestId('vr2-meter').getAttribute('data-score')).toBe('6');
    });

    it('a declared no-work day: no number, the day is named as such', () => {
        state.plot = 5; state.classification = 'DeclaredNoWorkDay';
        render(<SavedMeterGauge {...props()} />);
        expect(screen.getByTestId('vr2-meter').getAttribute('data-state')).toBe('no-work');
        expect(screen.queryByTestId('vr2-meter-needle')).toBeNull();
    });

    it('the question is the server\'s own line when there is one; its mic is the next recording; no "→ N/10"', () => {
        state.plot = 7; state.hint = 'शेतात काय दिसलं ते सांगा';
        const p = props();
        render(<SavedMeterGauge {...p} />);
        const next = screen.getByTestId('vr2-meter-next');
        expect(next.textContent).toContain('शेतात काय दिसलं ते सांगा');
        expect(next.getAttribute('data-source')).toBe('server');
        expect(next.textContent).not.toMatch(/→/);
        fireEvent.click(next);
        expect(p.onAddAnother).toHaveBeenCalledTimes(1);
        expect(p.onTellMore).not.toHaveBeenCalled();
    });

    it('without a server line: the first untold part, whose mic opens the mic for THAT part', () => {
        const p = props();
        render(<SavedMeterGauge {...p} />);
        const next = screen.getByTestId('vr2-meter-next');
        expect(next.getAttribute('data-part')).toBe('machinery');
        fireEvent.click(next);
        expect(p.onTellMore).toHaveBeenCalledWith('machinery');
    });

    it('nothing untold and no server line: no question', () => {
        render(<SavedMeterGauge {...props({ missing: [] })} />);
        expect(screen.queryByTestId('vr2-meter-next')).toBeNull();
    });
});
