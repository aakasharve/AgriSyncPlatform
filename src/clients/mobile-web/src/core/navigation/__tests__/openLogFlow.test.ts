/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — CMP-1, T2)
 *
 * The one door from another tab into the recorder ("झालं, सांगा", "काम सांगा", "बोलून सांगा") never harms
 * what the log flow already holds:
 *   - a waiting draft / manual edit / failed parse / busy recorder: the plot is NOT moved, nothing is reset,
 *     the log tab shows what is waiting (a draft for plot A can never be saved under plot B);
 *   - a just-finished save: reset to a fresh recorder first (else he lands on the old saved screen);
 *   - otherwise: that plot, voice, the log tab.
 */
import { describe, expect, it, vi } from 'vitest';
import { hasWaitingLogWork, openLogFlow, type LogFlowDoorCtx } from '../openLogFlow';

const ctxWith = (status: string, draftLog: unknown = null) => ({
    status, draftLog, handleReset: vi.fn(), setLogScope: vi.fn(), setMode: vi.fn(), setMainView: vi.fn(),
}) as unknown as LogFlowDoorCtx & { handleReset: ReturnType<typeof vi.fn>; setLogScope: ReturnType<typeof vi.fn>; setMode: ReturnType<typeof vi.fn>; setMainView: ReturnType<typeof vi.fn> };

const PLOT_B = { cropId: 'grape', plotId: 'plot-b' };

describe('openLogFlow — nothing waiting', () => {
    it('idle: picks the plot, voice, the log tab; resets nothing', () => {
        const c = ctxWith('idle');
        expect(openLogFlow(c, PLOT_B)).toBe('opened');
        expect(c.setLogScope).toHaveBeenCalledWith({ selectedCropIds: ['grape'], selectedPlotIds: ['plot-b'], mode: 'single', applyPolicy: 'broadcast' });
        expect(c.setMode).toHaveBeenCalledWith('voice');
        expect(c.setMainView).toHaveBeenCalledWith('log');
        expect(c.handleReset).not.toHaveBeenCalled();
    });

    it('without a plot ("बोलून सांगा"): keeps the plot he had, voice, the log tab', () => {
        const c = ctxWith('idle');
        expect(openLogFlow(c)).toBe('opened');
        expect(c.setLogScope).not.toHaveBeenCalled();
        expect(c.setMode).toHaveBeenCalledWith('voice');
        expect(c.setMainView).toHaveBeenCalledWith('log');
    });

    it('success (a save just finished): resets to a fresh recorder BEFORE picking the plot', () => {
        const c = ctxWith('success', { summary: 'the log just saved' });
        const order: string[] = [];
        c.handleReset.mockImplementation(() => order.push('reset'));
        c.setLogScope.mockImplementation(() => order.push('plot'));
        expect(openLogFlow(c, PLOT_B)).toBe('opened');
        expect(order).toEqual(['reset', 'plot']);
        expect(c.setMainView).toHaveBeenCalledWith('log');
    });

    it('error with no draft left: a fresh recorder for the plot he tapped (never the old plot\'s recorder)', () => {
        const c = ctxWith('error');
        expect(openLogFlow(c, PLOT_B)).toBe('opened');
        expect(c.handleReset).toHaveBeenCalledTimes(1);
        expect(c.setLogScope).toHaveBeenCalledWith(expect.objectContaining({ selectedPlotIds: ['plot-b'] }));
    });
});

describe('openLogFlow — something is waiting: shown, never moved or cleared', () => {
    it.each([
        // `useVoiceRecorder` leaves a parsed draft at status 'idle' with `draftLog` set — the common case
        ['idle', { summary: 'a parsed draft, spoken for plot A' }],
        ['confirming', { summary: 'spoken for plot A' }],
        ['error', { summary: 'a draft still on screen' }],
        ['recording', null],
        ['processing', null],
    ])('%s: the plot is not moved, nothing is reset, the log tab opens on it', (status, draft) => {
        const c = ctxWith(status, draft);
        expect(hasWaitingLogWork(c)).toBe(true);
        expect(openLogFlow(c, PLOT_B)).toBe('waiting');
        expect(c.setLogScope).not.toHaveBeenCalled();
        expect(c.handleReset).not.toHaveBeenCalled();
        expect(c.setMode).not.toHaveBeenCalled();
        expect(c.setMainView).toHaveBeenCalledWith('log');
    });

    it('idle with no draft, and a finished save, are not "waiting"', () => {
        expect(hasWaitingLogWork(ctxWith('idle'))).toBe(false);
        expect(hasWaitingLogWork(ctxWith('success', { summary: 'saved' }))).toBe(false);
    });
});
