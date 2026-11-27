// @vitest-environment jsdom
/**
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 — repair R1-g Part 2. The day card's place on Home: UNDER the two big
 * doors (record, plan) and the हजेरी part, above the money card — never louder than the doors (lane UI-6, founder D-150), never
 * over anything. Nothing handed in = nothing drawn.
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

vi.mock('../../../../appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => null }));
vi.mock('../../../../plannedWork/components/PlanDoor', () => ({ PlanDoor: () => <div data-testid="home-plan" /> }));

import { WorkHome } from '../WorkHome';

afterEach(cleanup);

const order = () => Array.from(document.querySelectorAll('[data-testid="work-home"] > *')).map(el => el.getAttribute('data-testid'));

describe('Home: the day card slot', () => {
    it('sits under the two doors and the हजेरी part, above the money card', () => {
        render(
            <WorkHome onTell={vi.fn()} onAttendance={vi.fn()} attendance={{ work: null, headcount: null, provisional: false }}
                cost={{ today: 0, yesterday: 0, soFar: 500 }}
                planDoor={{ kind: 'plan', farmId: 'f1', userId: 'u1', onOpen: vi.fn() }}
                dayCard={<div data-testid="day-card-slot" />} />,
        );
        expect(order()).toEqual(['home-title', 'home-tell', 'home-plan', 'home-attendance', 'day-card-slot', 'running-cost-card']);
    });

    it('no day card handed in: nothing in its place', () => {
        render(<WorkHome onTell={vi.fn()} />);
        expect(order()).toEqual(['home-title', 'home-tell']);
    });
});
