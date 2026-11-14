// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-T fix round 1, review P001) - after every sync the page asks the server again
 * (`agrisync:sync-reconciled`). The answer already on the screen stays until the new one arrives: the view does not unmount, an open reason
 * sheet stays open and the words he typed stay. The REAL `useFarmCompare` / `loadFarmCompare` run here; only the HTTP boundary, the kept-answer
 * store and the session are faked.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CROP_ID, FARM, PLOT_ID, answerOf, baseAnswer, cropsOf } from './compareFixtures';
import type { FarmCompareResult } from '../data/compareClient';

const h = vi.hoisted(() => ({ get: vi.fn(), dbListeners: [] as Array<() => void> }));

vi.mock('../../../infrastructure/api/AgriSyncClient', () => ({ agriSyncClient: { http: { get: (...a: unknown[]) => h.get(...a) } } }));
vi.mock('../../../infrastructure/storage/AuthTokenStore', () => ({ getSessionUserId: () => 'user-1' }));
vi.mock('../../../infrastructure/storage/activeDatabaseName', () => ({
    onActiveDatabaseChanged: (cb: () => void) => { h.dbListeners.push(cb); return () => { h.dbListeners = h.dbListeners.filter(x => x !== cb); }; },
}));
vi.mock('../data/compareStore', () => ({ readCachedCompare: async () => null, saveCompare: async () => undefined, dropCompare: async () => undefined }));
vi.mock('../../../i18n/LanguageContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../i18n/LanguageContext')>()),
    useOptionalLanguage: () => ({ language: 'mr', setLanguage: () => undefined, t: (k: string) => k }),
}));
vi.mock('../../../core/session/FarmContext', async (importActual) => ({
    ...(await importActual<typeof import('../../../core/session/FarmContext')>()),
    useOptionalFarmContext: () => ({ currentFarmId: FARM }),
}));
vi.mock('../../../shared/hooks/useUiPref', () => ({ useUiPref: () => [true, vi.fn(), true] as const }));
vi.mock('../../plannedWork/components/PlanMic', () => ({ default: () => <div data-testid="plan-mic" /> }));

import { ComparePage } from '../ComparePage';
import { CompareView } from '../CompareView';

const SYNC = () => act(() => { window.dispatchEvent(new Event('agrisync:sync-reconciled')); });

beforeEach(() => { h.get.mockReset(); h.dbListeners = []; });
afterEach(() => cleanup());

describe('a refetch after a sync keeps what is on the screen (P001)', () => {
    it('the view does not unmount, the open reason sheet stays, the typed words and the stage stay - while the new answer is on its way and after it arrives', async () => {
        h.get.mockResolvedValueOnce({ data: baseAnswer() });
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
        await screen.findByTestId('compare-screen');
        fireEvent.click(screen.getByTestId('compare-tile-work'));
        fireEvent.click(screen.getByTestId('compare-own-row-log-1:work:vine-tying'));
        fireEvent.change(screen.getByTestId('compare-reason-words'), { target: { value: 'वारा होता' } });

        let release!: (v: unknown) => void;
        h.get.mockReturnValueOnce(new Promise(r => { release = r; }));
        SYNC();
        await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
        // the new answer has NOT arrived: nothing may have been taken away
        expect(screen.queryByTestId('compare-loading')).toBeNull();
        expect(screen.getByTestId('compare-own-sheet')).toBeInTheDocument();
        expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).toBe('वारा होता');

        await act(async () => { release({ data: baseAnswer() }); });
        expect(screen.getByTestId('compare-own-sheet')).toBeInTheDocument();
        expect((screen.getByTestId('compare-reason-words') as HTMLTextAreaElement).value).toBe('वारा होता');
    });

    it('the stage he stepped to stays after a refetch', async () => {
        h.get.mockResolvedValueOnce({ data: baseAnswer() });
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
        await screen.findByTestId('compare-screen');
        fireEvent.click(screen.getByTestId('compare-stage-next'));
        h.get.mockResolvedValueOnce({ data: baseAnswer() });
        SYNC();
        await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
        expect(screen.queryByTestId('compare-loading')).toBeNull();
        expect(screen.getByTestId('compare-stage-name').textContent).toBe('फळवाढ');
    });

    it('another farmer\'s database (the active database changes) still drops the old answer at once', async () => {
        h.get.mockResolvedValueOnce({ data: baseAnswer() });
        render(<ComparePage crops={cropsOf()} />);
        fireEvent.click(screen.getByTestId(`flow-crop-${CROP_ID}`));
        fireEvent.click(screen.getByTestId(`flow-plot-${PLOT_ID}`));
        await screen.findByTestId('compare-screen');
        h.get.mockReturnValueOnce(new Promise(() => undefined));
        act(() => { h.dbListeners.forEach(cb => cb()); });
        expect(screen.getByTestId('compare-loading')).toBeInTheDocument();
        expect(screen.queryByTestId('compare-screen')).toBeNull();
    });
});

describe('the stage index follows the answer it is shown with', () => {
    const result = (compare: ReturnType<typeof answerOf>) => ({ kind: 'compare', compare, source: 'server', asOfUtc: compare.serverTimeUtc }) as Extract<FarmCompareResult, { kind: 'compare' }>;

    it('a new answer with fewer stages than the one he stepped to does not break the view: it shows the last stage', () => {
        const full = answerOf();
        const view = render(<CompareView result={result(full)} plot={full.plots[0]} farmId={FARM} chip="x" language="mr" crops={[]} onChange={() => undefined} />);
        fireEvent.click(screen.getByTestId('compare-stage-next'));
        const shorter = answerOf(a => {
            a.plots[0].stages = a.plots[0].stages.slice(0, 1);
            a.plots[0].schedules.forEach(s => { s.stages = s.stages.slice(0, 1); });
            a.plots[0].ownWork = [];
        });
        view.rerender(<CompareView result={result(shorter)} plot={shorter.plots[0]} farmId={FARM} chip="x" language="mr" crops={[]} onChange={() => undefined} />);
        expect(screen.getByTestId('compare-stage-name').textContent).toBe('फुटवा वाढ');
        expect(screen.getByTestId('compare-stage-next')).toBeDisabled();
    });
});
