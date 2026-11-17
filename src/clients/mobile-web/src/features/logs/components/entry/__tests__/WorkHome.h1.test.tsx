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
import { homeAttendanceShape } from '../homeAttendanceShape';
import type { DayWork, TodayAttendance } from '../todayAttendance';

const WORK: DayWork = { names: ['खुरपणी'], parts: [], place: { cropId: 'grape', cropName: 'द्राक्ष', plotNames: ['G1'] } };
const NOTHING: TodayAttendance = { work: null, headcount: null, provisional: false };
const WORK_NO_COUNT: TodayAttendance = { work: WORK, headcount: null, provisional: false };
const COUNT_NO_WORK: TodayAttendance = { work: null, headcount: 5, provisional: true };
const REST_DAY: TodayAttendance = { work: null, headcount: null, provisional: false, restDay: true };
const WORK_AND_COUNT: TodayAttendance = { work: WORK, headcount: 8, provisional: false };

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

describe('the हजेरी card only when a head count was said (founder D-150, note 2.4)', () => {
    it('a head count was said, with the work: the big card, its words and its "हजेरी वही बघा" link unchanged', () => {
        const onAttendance = vi.fn();
        const onAttendanceNames = vi.fn();
        render(<WorkHome {...full({ attendance: WORK_AND_COUNT, onAttendance, onAttendanceNames })} />);
        expect(screen.getByTestId('home-attendance')).toHaveAttribute('data-shape', 'card');
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'ready');
        expect(screen.getByTestId('attendance-card-ready')).toHaveTextContent('इथे हजेरी घ्या — आज 8 जण');
        expect(screen.getByTestId('attendance-card-register')).toHaveTextContent('हजेरी वही बघा');
        fireEvent.click(screen.getByTestId('attendance-card-register'));
        expect(onAttendance).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByTestId('attendance-card'));
        expect(onAttendanceNames).toHaveBeenCalledTimes(1);
        expect(screen.queryByTestId('home-attendance-ask')).toBeNull();
    });

    it('a head count was said but no work: the card is still drawn (it asks for the work, as before)', () => {
        render(<WorkHome {...full({ attendance: COUNT_NO_WORK })} />);
        expect(screen.getByTestId('attendance-card')).toHaveAttribute('data-state', 'count-told');
        expect(screen.getByTestId('attendance-card-tell')).toHaveTextContent('आधी आजचं काम सांगा');
    });

    it('work was logged but NO head count: no big card; ONE small line with the existing card words, and the same tap as the green door', () => {
        const onTell = vi.fn();
        const onAttendance = vi.fn();
        render(<WorkHome {...full({ attendance: WORK_NO_COUNT, onTell, onAttendance })} />);
        expect(screen.queryByTestId('attendance-card')).toBeNull();
        expect(screen.queryByTestId('attendance-card-register')).toBeNull();
        const wrap = screen.getByTestId('home-attendance');
        expect(wrap).toHaveAttribute('data-shape', 'ask');
        expect(within(wrap).getAllByRole('button')).toHaveLength(1);
        const line = screen.getByTestId('home-attendance-ask');
        expect(line).toHaveTextContent('किती जण होते ते सांगा');
        expect(line.className).toMatch(/text-\[1[0-4](\.5)?px\]/);
        expect(Number(/min-h-\[(\d+)px\]/.exec(line.className)?.[1])).toBeGreaterThanOrEqual(44);
        fireEvent.click(line);
        expect(onTell).toHaveBeenCalledTimes(1); // the crop -> plot -> mic step, exactly the card's old button
        expect(onAttendance).not.toHaveBeenCalled();
    });

    it('nothing told yet: no हजेरी part at all (the green door already asks for the work)', () => {
        render(<WorkHome {...full({ attendance: NOTHING })} />);
        expect(screen.queryByTestId('home-attendance')).toBeNull();
        expect(screen.queryByTestId('attendance-card')).toBeNull();
        expect(screen.queryByTestId('home-attendance-ask')).toBeNull();
    });

    it('a declared rest day and nothing else: one small line with the existing card sentence, opening the हजेरी place', () => {
        const onTell = vi.fn();
        const onAttendance = vi.fn();
        render(<WorkHome {...full({ attendance: REST_DAY, onTell, onAttendance })} />);
        expect(screen.queryByTestId('attendance-card')).toBeNull();
        const line = screen.getByTestId('home-attendance-rest');
        expect(line).toHaveTextContent('आज कामाला सुट्टी नोंदली आहे');
        fireEvent.click(line);
        expect(onAttendance).toHaveBeenCalledTimes(1);
        expect(onTell).not.toHaveBeenCalled();
    });

    it('someone who may not take हजेरी (no door) gets no हजेरी part, whatever was told', () => {
        render(<WorkHome {...full({ onAttendance: undefined, attendance: undefined })} />);
        expect(screen.queryByTestId('home-attendance')).toBeNull();
        cleanup();
        render(<WorkHome {...full({ onAttendance: undefined, attendance: WORK_AND_COUNT })} />);
        expect(screen.queryByTestId('home-attendance')).toBeNull();
    });

    it('English mode: the small line is English only', () => {
        h.language = 'en';
        render(<WorkHome {...full({ attendance: WORK_NO_COUNT })} />);
        const line = screen.getByTestId('home-attendance-ask');
        expect(line).toHaveTextContent('Tell how many people worked');
        expect(line.textContent).not.toMatch(/[ऀ-ॿ]/);
    });

    it('the decision itself: head count -> card; work only -> ask; rest day only -> rest; nothing -> none', () => {
        expect(homeAttendanceShape(WORK_AND_COUNT)).toBe('card');
        expect(homeAttendanceShape(COUNT_NO_WORK)).toBe('card');
        expect(homeAttendanceShape(WORK_NO_COUNT)).toBe('ask');
        expect(homeAttendanceShape(REST_DAY)).toBe('rest');
        expect(homeAttendanceShape(NOTHING)).toBe('none');
        // a head count wins over a rest-day mark (the card's own rest branch then speaks, as before)
        expect(homeAttendanceShape({ ...REST_DAY, headcount: 3 })).toBe('card');
    });
});

describe('the money as a full-width dark card (founder D-150, note 1.2)', () => {
    it('is stone-900 with white text, a 44 px amber circle with the rupee at left, and the label, the big amount and the small line', () => {
        render(<WorkHome {...full({ cost: { today: 1200, yesterday: 0, soFar: 45000, scopeLabel: 'संपूर्ण शेत' } })} />);
        const card = screen.getByTestId('running-cost-card');
        expect(card.className).toContain('bg-stone-900');
        expect(card.className).toContain('text-white');
        expect(card.className).toContain('w-full');
        expect(card.className).not.toContain('bg-white');
        const circle = card.querySelector('span.rounded-full') as HTMLElement;
        expect(circle.className).toContain('bg-amber-500');
        expect(circle.className).toContain('h-11');
        expect(circle.className).toContain('w-11');
        expect(circle.querySelector('svg')).not.toBeNull();
        expect(within(card).getByTestId('running-cost-scope').textContent).toBe('खर्च — संपूर्ण शेत · आजपर्यंत');
        expect(within(card).getByTestId('running-cost-scope').className).toContain('text-[11.5px]');
        const amount = within(card).getByTestId('running-cost-so-far');
        expect(amount).toHaveTextContent('₹ 45,000');
        expect(amount.className).toContain('text-[26px]');
        expect(amount.className).toContain('font-extrabold');
        expect(amount.className).toContain('text-amber-300');
        // the small line carries the real figures; nothing recorded is the app's own "—", never "₹ 0"
        expect(within(card).getByTestId('running-cost-recent').textContent).toBe('आज ₹ 1,200 · काल —');
        expect(within(card).getByTestId('running-cost-today')).toHaveTextContent('₹ 1,200');
        expect(within(card).getByTestId('running-cost-yesterday')).toHaveTextContent('—');
        expect(card.textContent).not.toContain('₹ 0');
    });

    it('a plot or crop name goes in the label; no name says just "खर्च · आजपर्यंत"; no total shows "—" in the big place', () => {
        const { rerender } = render(<WorkHome {...full({ cost: { today: 0, yesterday: 0, soFar: 0, scopeLabel: 'द्राक्ष G1' } })} />);
        expect(screen.getByTestId('running-cost-scope').textContent).toBe('खर्च — द्राक्ष G1 · आजपर्यंत');
        expect(screen.getByTestId('running-cost-so-far').textContent).toBe('—');
        expect(screen.getByTestId('running-cost-recent').textContent).toBe('आज — · काल —');
        rerender(<WorkHome {...full({ cost: { today: 0, yesterday: 0, soFar: 10, scopeLabel: '' } })} />);
        expect(screen.getByTestId('running-cost-scope').textContent).toBe('खर्च · आजपर्यंत');
    });

    it('is drawn only when the caller hands the cost in (a person who may not see money is handed none)', () => {
        render(<WorkHome {...full({ cost: undefined })} />);
        expect(screen.queryByTestId('running-cost-card')).toBeNull();
    });

    it('has no tap and no button of its own (the old card had none; no chevron promises a place nobody wired)', () => {
        render(<WorkHome {...full()} />);
        const card = screen.getByTestId('running-cost-card');
        expect(within(card).queryAllByRole('button')).toHaveLength(0);
        expect(card.tagName).toBe('SECTION');
    });
});

describe('contrast (WCAG AA, 4.5 : 1 for the small lines) of the text the picture puts on solid colours', () => {
    const HEX: Record<string, string> = {
        'text-white': '#ffffff', 'text-stone-200': '#e7e5e4', 'text-amber-300': '#fcd34d', 'text-emerald-50': '#ecfdf5',
        'bg-stone-900': '#1c1917', 'bg-emerald-700': '#047857', 'bg-[#1448E6]': '#1448e6', 'bg-amber-500': '#f59e0b', 'text-stone-900': '#1c1917',
    };
    const lin = (c: number) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
    const ratio = (fg: string, bg: string) => { const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
    const textClass = (el: HTMLElement) => Object.keys(HEX).find(k => k.startsWith('text-') && el.className.split(/\s+/).includes(k));
    // text/90 on a solid: the picture's own "opacity .9" white, mixed into the blue
    const white90OnBlue = () => { const f = [255, 255, 255].map((c, i) => Math.round(0.9 * c + 0.1 * [20, 72, 230][i])); return '#' + f.map(c => c.toString(16).padStart(2, '0')).join(''); };

    it('the money card: the label, the small line and the amber figure on stone-900', () => {
        render(<WorkHome {...full()} />);
        for (const id of ['running-cost-scope', 'running-cost-recent', 'running-cost-so-far']) {
            const cls = textClass(screen.getByTestId(id));
            expect(cls, `${id} must use a colour this table knows`).toBeTruthy();
            expect(ratio(HEX[cls as string], HEX['bg-stone-900'])).toBeGreaterThanOrEqual(4.5);
        }
    });

    it('the green door: title and line on emerald-700; the blue door: title, line and pill on #1448E6', () => {
        render(<WorkHome {...full()} />);
        expect(ratio(HEX['text-white'], HEX['bg-emerald-700'])).toBeGreaterThanOrEqual(4.5);
        expect(textClass(screen.getByTestId('home-tell-sub'))).toBe('text-emerald-50');
        expect(ratio(HEX['text-emerald-50'], HEX['bg-emerald-700'])).toBeGreaterThanOrEqual(4.5);
        expect(ratio(HEX['text-white'], HEX['bg-[#1448E6]'])).toBeGreaterThanOrEqual(4.5);
        expect(screen.getByTestId('home-plan-sub').className).toContain('text-white/90');
        expect(ratio(white90OnBlue(), HEX['bg-[#1448E6]'])).toBeGreaterThanOrEqual(4.5);
        // the pill is blue on white
        expect(ratio(HEX['bg-[#1448E6]'], HEX['text-white'])).toBeGreaterThanOrEqual(4.5);
        // the rupee on its amber circle
        expect(ratio(HEX['text-stone-900'], HEX['bg-amber-500'])).toBeGreaterThanOrEqual(4.5);
    });
});
