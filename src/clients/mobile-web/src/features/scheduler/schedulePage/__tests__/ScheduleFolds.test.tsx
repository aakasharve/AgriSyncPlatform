// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-4; founder D-146) - the शेड्यूल tab, much simpler: the header and the one "today" list
 * are open, every other part is a closed row with a short line, one tap opens it, and nothing is removed. Plus the round creator badge.
 * Rows are NOT auto-opened here (the older tests use `autoOpenFolds`).
 */
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('../usePlotClips', () => ({ usePlotClips: () => new Map() }));
vi.mock('../../../finance/components/MoneyLensDrawer', () => ({ MoneyLensDrawer: () => null }));
vi.mock('../../../finance/financeSelectors', () => ({ financeSelectors: { getTotalCost: () => 0 } }));

import SchedulerPage from '../../../../pages/SchedulerPage';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { ScheduleCreatorBadge, creatorLetter } from '../ScheduleCreatorBadge';
import { SERVER_TEMPLATE, SPRAY_TEMPLATE, crop } from './scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

// Version 7 (slice 10): the followed-schedules row (the four tiles) is OPEN under the plot head; every other row stays closed.
const ROWS = ['owed', 'ahead', 'done', 'stages', 'tools'] as const;

describe('UI-4: the शेड्यूल tab is one short screen with closed rows', () => {
    it('the header, the badge and the today card are open; every other row is closed and draws nothing inside', () => {
        render(<SchedulerPage crops={[crop()]} logs={[]} tasks={[]} onUpdateCrops={vi.fn()} onBack={vi.fn()} />);
        expect(screen.getByTestId('sched-header')).toBeInTheDocument();
        expect(screen.getByTestId('sched-badge')).toBeInTheDocument();
        expect(screen.getByTestId('today-card')).toBeInTheDocument();
        expect(screen.getByTestId('day-now')).toBeInTheDocument();
        for (const id of ROWS) {
            expect(screen.getByTestId(`fold-${id}`)).toHaveAttribute('data-open', 'no');
            expect(screen.getByTestId(`fold-${id}-toggle`)).toHaveAttribute('aria-expanded', 'false');
            expect(screen.queryByTestId(`fold-${id}-body`)).toBeNull();
        }
        expect(screen.getByTestId('fold-followed')).toHaveAttribute('data-open', 'yes');
        // the content of the closed rows is not on the screen yet
        expect(screen.queryByTestId('owed-card')).toBeNull();
        expect(screen.queryByTestId('stage-ribbon')).toBeNull();
        expect(screen.queryByTestId('sched-tools')).toBeNull();
        expect(screen.queryByTestId('tab-today')).toBeNull();
    });

    it('one tap opens a row and its content is there; a second tap closes it again', () => {
        render(<SchedulerPage crops={[crop()]} logs={[]} tasks={[]} onUpdateCrops={vi.fn()} onBack={vi.fn()} />);
        fireEvent.click(screen.getByTestId('fold-owed-toggle'));
        expect(screen.getByTestId('fold-owed')).toHaveAttribute('data-open', 'yes');
        expect(screen.getByTestId('owed-card')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('fold-stages-toggle'));
        expect(screen.getByTestId('stage-ribbon')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('fold-tools-toggle'));
        expect(screen.getByTestId('open-library')).toBeInTheDocument();
        expect(screen.getByTestId('open-editor')).toBeInTheDocument();
        expect(screen.getByTestId('open-grid')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('fold-owed-toggle'));
        expect(screen.queryByTestId('owed-card')).toBeNull();
    });
});

describe('UI-4: the round creator badge', () => {
    it('shows the first letter of a real name, never a photo, and a leaf when there is no name', () => {
        const { rerender } = render(<ScheduleCreatorBadge name="  संजय पाटील" />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'letter');
        expect(screen.getByTestId('sched-badge').textContent).toBe('स');
        rerender(<ScheduleCreatorBadge name={null} />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'leaf');
        expect(screen.getByTestId('sched-badge').querySelector('svg')).not.toBeNull();
        expect(screen.getByTestId('sched-badge').querySelector('img')).toBeNull();
        rerender(<ScheduleCreatorBadge name="   " />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'leaf');
        expect(creatorLetter('akash')).toBe('A');
    });

    it('accepts an imageUrl for a later lane (the layout stays the same)', () => {
        render(<ScheduleCreatorBadge imageUrl="https://example.test/x.png" name="A" />);
        expect(screen.getByTestId('sched-badge')).toHaveAttribute('data-kind', 'image');
        expect(screen.getByTestId('sched-badge').querySelector('img')).not.toBeNull();
    });

    it('the page passes no picture: the header badge is a letter or a leaf, never an image', () => {
        render(<SchedulerPage crops={[crop()]} logs={[]} tasks={[]} onUpdateCrops={vi.fn()} onBack={vi.fn()} />);
        expect(screen.getByTestId('sched-badge')).not.toHaveAttribute('data-kind', 'image');
    });
});
