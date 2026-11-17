// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane UI-6; founder D-150, notes 1.2 and 2.4) - the Home is the approved picture H1:
 * two big doors (solid green record door, solid blue plan door under it), the हजेरी card only when a head count was said, and the
 * money as a full-width dark card. The WorkHome is drawn alone here, with its real children (`PlanDoor`, `TodayAttendanceCard`,
 * `RunningCostCard`); only the language, the update card and the planned-work store are stubbed.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en', open: 3 }));

vi.mock('../../../../../i18n/LanguageContext', () => ({ useOptionalLanguage: () => ({ language: h.language }) }));
vi.mock('../../../../appUpdate/AppUpdateCard', () => ({ AppUpdateCard: () => <div data-testid="app-update-card" /> }));
vi.mock('../../../../plannedWork/data/usePlannedWork', () => ({
    usePlannedWork: () => ({
        items: Array.from({ length: h.open }, (_, i) => ({
            id: `t${i}`, farmId: 'f', title: 'फवारणी', status: 'Accepted', assigneeUserId: 'u', createdByUserId: 'o', plots: [],
        })),
        loaded: true, parked: new Map(), reload: async () => undefined,
    }),
}));

import { WorkHome, type WorkHomeProps } from '../WorkHome';
import type { TodayAttendance } from '../todayAttendance';

const WORK = { names: ['खुरपणी'], parts: [], place: { cropId: 'grape', cropName: 'द्राक्ष', plotNames: ['G1'] } } as const;
const WORK_AND_COUNT: TodayAttendance = { work: { ...WORK, names: [...WORK.names], parts: [] }, headcount: 8, provisional: false };

const full = (over: Partial<WorkHomeProps> = {}): WorkHomeProps => ({
    onTell: vi.fn(),
    onAttendance: vi.fn(),
    attendance: WORK_AND_COUNT,
    onAttendanceNames: vi.fn(),
    cost: { today: 0, yesterday: 0, soFar: 132455, scopeLabel: 'संपूर्ण शेत' },
    planDoor: { kind: 'plan', farmId: 'f', userId: 'u', onOpen: vi.fn() },
    ...over,
});

beforeEach(() => { h.language = 'mr'; h.open = 3; });
afterEach(cleanup);

const follows = (a: HTMLElement, b: HTMLElement) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the order and weight of the Home (picture H1)', () => {
    it('top to bottom: update card, the small question, green door, blue door, हजेरी card, money', () => {
        render(<WorkHome {...full()} />);
        const order = ['app-update-card', 'home-title', 'home-tell', 'home-plan', 'attendance-card', 'running-cost-card'].map(id => screen.getByTestId(id));
        for (let i = 0; i < order.length - 1; i++) expect(follows(order[i], order[i + 1])).toBe(true);
    });

    it('the question is one small bold line, and the big Sathi banner is gone', () => {
        const { container } = render(<WorkHome {...full()} />);
        const title = screen.getByTestId('home-title');
        expect(title).toHaveTextContent('काय करायचं आहे?');
        expect(title.className).toContain('text-[15px]');
        expect(title.className).toContain('font-bold');
        expect(title.className).toContain('text-stone-600');
        expect(title.className).not.toContain('text-[22px]');
        expect(container.querySelector('img')).toBeNull();
    });
});

describe('the green record door', () => {
    it('is one solid colour (no gradient), 26 px title, small line, 52 px mic circle, and still calls onTell', () => {
        const onTell = vi.fn();
        render(<WorkHome {...full({ onTell })} />);
        const door = screen.getByTestId('home-tell');
        expect(door.className).toContain('bg-emerald-700');
        expect(door.className).not.toMatch(/gradient|from-|to-emerald/);
        expect(within(door).getByTestId('home-tell-title')).toHaveTextContent('झालेले काम सांगा');
        expect(within(door).getByTestId('home-tell-title').className).toContain('text-[26px]');
        expect(within(door).getByTestId('home-tell-title').className).toContain('font-extrabold');
        expect(within(door).getByTestId('home-tell-sub')).toHaveTextContent('आज शेतात काय काम झालं ते बोलून किंवा लिहून सांगा');
        expect(within(door).getByTestId('home-tell-sub').className).toMatch(/text-\[1[23]px\]/);
        expect(door.querySelector('.h-\\[52px\\].w-\\[52px\\]')).not.toBeNull();
        fireEvent.click(door);
        expect(onTell).toHaveBeenCalledTimes(1);
    });

    it('stays the biggest block: taller than the blue door, and the blue door has the smaller title', () => {
        render(<WorkHome {...full()} />);
        const minH = (el: HTMLElement) => Number(/min-h-\[(\d+)px\]/.exec(el.className)?.[1]);
        expect(minH(screen.getByTestId('home-tell'))).toBeGreaterThan(minH(screen.getByTestId('home-plan')));
        const px = (el: HTMLElement) => Number(/text-\[(\d+)px\]/.exec(el.className)?.[1]);
        expect(px(screen.getByTestId('home-tell-title'))).toBeGreaterThan(px(screen.getByTestId('home-plan-title')));
    });

    it('every tap target is at least 44 px high', () => {
        render(<WorkHome {...full()} />);
        for (const id of ['home-tell', 'home-plan']) {
            const min = Number(/min-h-\[(\d+)px\]/.exec(screen.getByTestId(id).className)?.[1]);
            expect(min).toBeGreaterThanOrEqual(44);
        }
    });
});

describe('the blue plan door', () => {
    it('kind plan: the title is exactly "नियोजन करा" (24 px, extra-bold), with the small line and the count pill', () => {
        const onOpen = vi.fn();
        render(<WorkHome {...full({ planDoor: { kind: 'plan', farmId: 'f', userId: 'u', onOpen } })} />);
        const door = screen.getByTestId('home-plan');
        expect(door).toHaveAttribute('data-kind', 'plan');
        expect(door.className).toContain('bg-[#1448E6]');
        const title = within(door).getByTestId('home-plan-title');
        expect(title.textContent).toBe('नियोजन करा');
        expect(title.className).toContain('text-[24px]');
        expect(title.className).toContain('font-extrabold');
        expect(within(door).getByTestId('home-plan-sub').textContent).toBe('पुढची कामे ठरवा आणि मुकादमाला सोपवा');
        const pill = within(door).getByTestId('home-plan-count');
        expect(pill).toHaveAttribute('data-count', '3');
        expect(pill).toHaveTextContent('3 कामे चालू');
        fireEvent.click(door);
        expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it('kind mine (the worker): the same solid blue and size, and his own words unchanged', () => {
        render(<WorkHome {...full({ planDoor: { kind: 'mine', farmId: 'f', userId: 'u', onOpen: vi.fn() } })} />);
        const door = screen.getByTestId('home-plan');
        expect(door).toHaveAttribute('data-kind', 'mine');
        expect(door.className).toContain('bg-[#1448E6]');
        expect(within(door).getByTestId('home-plan-title').textContent).toBe('तुमच्यावर सोपवलेली कामे');
        expect(within(door).getByTestId('home-plan-title').className).toContain('text-[24px]');
        expect(within(door).getByTestId('home-plan-sub').textContent).toBe('तुम्हाला सोपवलेली कामे इथे दिसतात');
        expect(door.textContent).not.toContain('नियोजन करा');
    });

    it('English mode: English only, with the twin of the new title', () => {
        h.language = 'en';
        render(<WorkHome {...full()} />);
        const door = screen.getByTestId('home-plan');
        expect(within(door).getByTestId('home-plan-title').textContent).toBe('Plan the work');
        expect(door.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('no farm yet: no blue door', () => {
        render(<WorkHome {...full({ planDoor: undefined })} />);
        expect(screen.queryByTestId('home-plan')).toBeNull();
    });
});
