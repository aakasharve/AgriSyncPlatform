// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 fix round 1, review L007) - the source line of a reminder made from what he said
 * ("बोलण्यातून · plot · day") writes the day with the card's own date helper (`whenView`), localised - never a raw YYYY-MM-DD.
 */
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PlanCard } from '../components/PlanCard';
import type { LocalPlannedWork } from '../data/plannedWorkStore';
import { whenView } from '../planDates';
import { plannedWorkWords } from '../plannedWorkWords';

afterEach(cleanup);

const ME = '22222222-2222-4222-8222-222222222222';
const TODAY = new Date(2026, 10, 8);
const PLOT = '44444444-4444-4444-8444-444444444441';

const spoken = (): LocalPlannedWork => ({
    id: '33333333-3333-4333-8333-333333333331', farmId: 'f1', title: 'पाईपलाईन दुरुस्त करायची', scope: 'Unspecified', plotIds: [], plannedDate: '2026-11-09', looseWhen: null,
    plannedTime: null, assigneeUserId: null, crewText: null, expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', sourceKind: 'Spoken',
    sourcePlotId: PLOT, recordedOn: '2026-11-08', createdByUserId: ME, modifiedAtUtc: null, source: 'server', keptOnPhone: false, pendingSteps: [], refused: false, plots: [], confirmationState: null,
});

const draw = (language: string) =>
    render(<ul><PlanCard task={spoken()} today={TODAY} me={ME} language={language} whereText="" plotNames={new Map([[PLOT, 'ऊस 1']])} /></ul>);

describe('L007 - the source line\'s day is localised', () => {
    it('Marathi: the word, the plot and a short Marathi date; no YYYY-MM-DD anywhere in the card', () => {
        draw('mr');
        const line = screen.getByTestId('plan-card-source');
        expect(line).toHaveTextContent('बोलण्यातून');
        expect(line).toHaveTextContent('ऊस 1');
        expect(line.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        const sub = whenView({ plannedDate: '2026-11-08', looseWhen: null, status: 'Open' }, TODAY, plannedWorkWords('mr'), 'mr').sub!;
        expect(line).toHaveTextContent(sub);
        expect(screen.getByTestId(`plan-${spoken().id}`)).not.toHaveTextContent(/\d{4}-\d{2}-\d{2}/);
    });

    it('English: English only, an English short date, no YYYY-MM-DD', () => {
        draw('en');
        const line = screen.getByTestId('plan-card-source');
        expect(line).toHaveTextContent('From what you said');
        expect(line.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        expect(line.textContent).not.toMatch(/बोलण्यातून/);
        const sub = whenView({ plannedDate: '2026-11-08', looseWhen: null, status: 'Open' }, TODAY, plannedWorkWords('en'), 'en').sub!;
        expect(line).toHaveTextContent(sub);
    });
});
