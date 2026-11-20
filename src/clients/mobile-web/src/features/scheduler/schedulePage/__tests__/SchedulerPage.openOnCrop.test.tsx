// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-9a, redesign item 7) - Setup's "शेड्यूल बघा" opens the शेड्यूल tab ON that crop: the
 * one-shot hand-off `schedule_view_crop_id` picks the crop (its first plot) and stays on the home view (not the library); the key is used once.
 * The older `schedule_library_crop_id` hand-off (the library) is unchanged.
 */
import { autoOpenFolds } from './foldTestKit';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../voiceDiary/components/ClipPlayerCard', () => ({ default: () => <div /> }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, crop, plot } from './scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE]));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
    window.sessionStorage.clear();
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.sessionStorage.clear(); });

const farm = () => [
    crop([plot({ id: 'plot-1', name: 'A' })]),
    crop([plot({ id: 'plot-9', name: 'Z' }), plot({ id: 'plot-8', name: 'Y' })], { id: 'crop-2', name: 'Onion', color: 'bg-pink-500' }),
];

const mount = () => {
    render(<SchedulerPage crops={farm()} logs={[]} tasks={[]} onUpdateCrops={vi.fn()} onBack={vi.fn()} onCloseDay={vi.fn()} />);
    autoOpenFolds();
};
const where = () => screen.getByTestId('sched-crop-plot').textContent ?? '';

describe('opening the schedule tab on a crop (Setup "शेड्यूल बघा")', () => {
    it('with no hand-off the tab opens on the first crop, as before', () => {
        mount();
        expect(where()).toContain('· A');
    });

    it('with the crop handed over, the tab opens on that crop\'s first plot, on the home view (not the library), and the key is used once', () => {
        window.sessionStorage.setItem('schedule_view_crop_id', 'crop-2');
        mount();
        expect(where()).toContain('· Z');
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'HOME');
        expect(window.sessionStorage.getItem('schedule_view_crop_id')).toBeNull();
    });

    it('a crop that is no longer on the farm is ignored (the first crop opens) and the key is dropped', () => {
        window.sessionStorage.setItem('schedule_view_crop_id', 'gone');
        mount();
        expect(where()).toContain('· A');
        expect(window.sessionStorage.getItem('schedule_view_crop_id')).toBeNull();
    });

    it('the older library hand-off still opens the library on that crop', () => {
        window.sessionStorage.setItem('schedule_library_crop_id', 'crop-2');
        mount();
        expect(screen.getByTestId('schedule-page')).toHaveAttribute('data-view', 'LIBRARY');
    });
});
