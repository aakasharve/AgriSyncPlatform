// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (founder D-167: the start day - pruning day for grapes - is DAY 1 as the farmer reads it; the
 * server stores it as day 0)
 *
 * The schedule editor (शेड्यूल बदला): the heading over the date box names the start day "दिवस १" (it said "दिवस ०"), and the line under it,
 * "म्हणजे आज दिवस N", prints the shown day (stored + 1). A date still ahead says how many days until it starts - a count, never shifted.
 */
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import ScheduleMaker from '../ScheduleMaker';
import { addDays } from '../../schedulePage/scheduleDates';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, crop } from '../../schedulePage/__tests__/scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));
afterEach(() => cleanup());

const text = (id: string) => screen.getByTestId(id).textContent ?? '';
const open = (todayKey: string) => render(<ScheduleMaker crops={[crop()]} todayKey={todayKey} onSave={vi.fn()} />);

describe('the editor names the start day "दिवस १"', () => {
    it('the heading over the date box reads "छाटणीची तारीख (दिवस १)", never "(दिवस ०)"', () => {
        open(addDays(REF, 9));

        expect(text('editor-day-zero')).toContain('छाटणीची तारीख (दिवस १)');
        expect(text('editor-day-zero')).not.toContain('दिवस ०');
    });

    it('on the start date itself the line reads "म्हणजे आज दिवस १"', () => {
        open(REF);

        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस १');
    });

    it('9 days after the start date it reads day 10; the day after that, day 11', () => {
        open(addDays(REF, 9));
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस १०');

        cleanup();
        open(addDays(REF, 10));
        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस ११');
    });

    it('moving the date moves the line: a start date 1 day later makes today day 9, not day 8', () => {
        open(addDays(REF, 9));
        fireEvent.change(screen.getByTestId('editor-date'), { target: { value: addDays(REF, 1) } });

        expect(text('editor-today-day')).toBe('म्हणजे आज दिवस ९');
    });

    it('a start date still ahead says in how many days it starts - that count is not shifted', () => {
        open(addDays(REF, -3));

        expect(text('editor-today-day')).toBe('शेड्यूल ३ दिवसांनी सुरू होईल');
    });
});
