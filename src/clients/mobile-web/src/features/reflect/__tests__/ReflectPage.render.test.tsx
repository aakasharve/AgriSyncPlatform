// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6; lane RF)
 *
 * The whole "पूर्ण शेतीचा आढावा" page on real-shaped records: the six sections in their first-use order, folded
 * and ordered as the founder's D-4 asks (remembered on this phone — `useUiPref` is an in-memory store here, so a
 * remount is a reopen), every section fed from the page's real props, and the page's actions wired to the real callbacks
 * (task tick → `onUpdateTask` with the whole task; in-hand card → the income page; the ledger link; a plot card
 * → that plot's day sheet; the money pill → the money lens). Lane RF: the day's work follows the chosen day; the
 * money comes from the server's ledger (`useMoneyLedger`, a fixture here) and is "—" for a role that may not see it;
 * "बदला" takes the result screen's path; a note opens its recording. Lane RF2: the plot cards show only what happened
 * (chips), a "संपूर्ण शेत" card holds whole-farm work, the day's feed button and sheet are retired, a card opens the
 * plot's day (buckets + time chips that open a recording inline), and "आणखी सांगा" asks THE ONE mic (`onSpeak`), the
 * new work highlighted when it lands. Only infrastructure edges are mocked (farm
 * context, harvest storage, the ledger read, the clip player, Dexie attachment counts, telemetry, the money lens).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../../../core/session/FarmContext', () => ({ useFarmContext: () => ({ currentFarmId: null }) }));
// spec: plr-d10 (I22, D-4) — the remembered folds / order, in memory: survives a remount (a reopen), cleared per test.
const prefs = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../../../shared/hooks/useUiPref', async () => {
    const { useState } = await import('react');
    return {
        useUiPref: <T,>(key: string, fallback: T) => {
            const [value, setValue] = useState<T>(prefs.has(key) ? prefs.get(key) as T : fallback);
            const update = (next: T) => { prefs.set(key, next); setValue(next); };
            return [value, update, true] as const;
        },
    };
});
vi.mock('../../../services/harvestService', () => ({ getHarvestSessions: () => [], getOtherIncomeEntries: () => [] }));
vi.mock('../../attachments', () => ({ AttachmentList: () => null, useAttachmentRetry: () => ({ retryUpload: vi.fn() }) }));
vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
vi.mock('../../../core/telemetry/eventEmitters', () => ({ emitClosureSummaryViewed: vi.fn() }));
vi.mock('../../logs/components/FarmWideTodayPanel', () => ({ default: () => null }));
vi.mock('../../finance/components/MoneyLensDrawer', () => ({
    MoneyLensDrawer: ({ isOpen, filters }: { isOpen: boolean; filters: object }) => (isOpen ? <div data-testid="money-lens">{JSON.stringify(filters)}</div> : null),
}));
// lane RF — the server's ledger as this phone holds it (₹ 1,500 spent on सोनाका today), and no player behind ▶.
const SPENT_TODAY = { id: 'e1', plotId: 'g1', dateKey: '2026-10-25', direction: 'Expense', category: 'Labour', amount: 1500 };
const ledger = vi.hoisted(() => ({ entries: [] as unknown[] }));
vi.mock('../overview/useMoneyLedger', () => ({ useMoneyLedger: () => ({ entries: ledger.entries, gaps: [], complete: true }) }));
vi.mock('../day/useDayListen', () => ({
    useDayListen: () => ({ kindOf: () => 'none', clipOf: () => undefined, playing: () => false, progress: 0, lengthOf: () => null, toggle: () => undefined, stop: () => undefined, farmOf: () => null }),
}));
vi.mock('../../../infrastructure/voice/logOriginalVoice', () => ({ fetchLogOriginalVoice: vi.fn() }));
vi.mock('../../../infrastructure/sync/PayloadValidator', () => ({ validatePayload: () => ({ ok: true }) }));

import ReflectPage from '../ReflectPage';
import { CROPS, TODAY_KEY, log, money, task } from './reflectFixtures';

const history = [
    log({
        id: 'g1-today', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'छाटणी' }], financialSummary: money(9999),
        meta: { createdAtISO: '2026-10-25T03:40:00.000Z', createdByOperatorId: 'me' },
        observations: [{ id: 'o1', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '2026-10-25T03:40:00.000Z', textRaw: 'कीड दिसली', noteType: 'issue', severity: 'normal', source: 'voice' }],
    }),
    log({ id: 'c1-old', date: '2026-10-21', cropId: 'cane', plotIds: ['c1'], irrigation: [{ id: 'i', method: 'drip', source: 'Well' }], meta: { createdAtISO: '2026-10-21T05:00:00.000Z', createdByOperatorId: 'op-sunil' } }),
];

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 25, 10, 0, 0));
    prefs.clear();
    ledger.entries = [SPENT_TODAY];
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

const renderPage = (over: Partial<React.ComponentProps<typeof ReflectPage>> = {}) => {
    const props = {
        history, crops: CROPS,
        tasks: [task('t1', 'फवारणी', { dueDate: TODAY_KEY })],
        onUpdateTask: vi.fn(), onAddTask: vi.fn(), navigate: vi.fn(), onOpenLog: vi.fn(), onSpeak: vi.fn(),
        sessionUserId: 'me', farmRole: 'PrimaryOwner',
        operators: [{ id: 'op-sunil', name: 'सुनील' }] as React.ComponentProps<typeof ReflectPage>['operators'],
        ...over,
    };
    render(<ReflectPage {...props} />);
    return props;
};

/** Open every folded section (the content tests below read all six). */
const openAll = () => {
    for (const id of ['status', 'todo', 'day', 'notes', 'calendar', 'cost']) {
        const toggle = screen.getByTestId(`reflect-section-${id}-toggle`);
        if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
    }
};

const sectionOrder = () => Array.from(document.querySelectorAll('section[data-testid^="reflect-section-"]')).map(s => s.getAttribute('data-testid'));
const pickOct21 = () => {
    // 25 Oct 2026 is a Sunday: the calendar's week (Sunday first) is 25–31; the 21st is one week back
    fireEvent.click(screen.getByTestId('cal-prev'));
    fireEvent.click(screen.getByTestId('cal-day-2026-10-21'));
};

describe('ReflectPage (redesigned, real data)', () => {
    it('six sections in their first-use order; no move buttons until "क्रम बदला" is on', () => {
        renderPage();
        expect(sectionOrder()).toEqual([
            'reflect-section-status', 'reflect-section-todo', 'reflect-section-day',
            'reflect-section-notes', 'reflect-section-calendar', 'reflect-section-cost',
        ]);
        expect(document.querySelector('[data-testid$="-reorder"]')).toBeNull();
        expect(screen.queryByRole('button', { name: /move (up|down)/i })).toBeNull();
        // folding a section hides its body; the section stays where it is
        fireEvent.click(screen.getByTestId('reflect-section-day-toggle'));
        expect(screen.queryAllByTestId(/^plot-card-/)).toHaveLength(0);
        expect(sectionOrder()[2]).toBe('reflect-section-day');
    });

    it('D-4 first use: शेताची स्थिती, करायची कामे, प्लॉटनिहाय काम open; notes, calendar, money folded — their headers keep the count', () => {
        renderPage();
        const expanded = (id: string) => screen.getByTestId(`reflect-section-${id}-toggle`).getAttribute('aria-expanded');
        expect(['status', 'todo', 'day', 'notes', 'calendar', 'cost'].map(expanded)).toEqual(['true', 'true', 'true', 'false', 'false', 'false']);
        expect(screen.queryByTestId('notes-list')).toBeNull();
        expect(screen.getByTestId('notes-count')).toHaveTextContent('1'); // the folded section still says how many
        expect(screen.getByTestId('todo-count')).toBeInTheDocument();
    });

    it('D-4 reopening: his folds and his order are remembered', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-notes-toggle')); // open notes
        fireEvent.click(screen.getByTestId('reflect-section-todo-toggle')); // fold to-dos
        fireEvent.click(screen.getByTestId('reflect-reorder-toggle'));
        expect(screen.queryByTestId('reflect-section-status-reorder')).toBeNull(); // शेताची स्थिती never moves
        expect(screen.getByTestId('reflect-section-todo-up')).toBeDisabled(); // already first of the movable ones
        fireEvent.click(screen.getByTestId('reflect-section-cost-up'));
        expect(sectionOrder().slice(-2)).toEqual(['reflect-section-cost', 'reflect-section-calendar']);
        cleanup();

        renderPage(); // the page opened again
        expect(screen.getByTestId('notes-list')).toBeInTheDocument();
        expect(screen.getByTestId('reflect-section-todo-toggle')).toHaveAttribute('aria-expanded', 'false');
        expect(sectionOrder()).toEqual([
            'reflect-section-status', 'reflect-section-todo', 'reflect-section-day',
            'reflect-section-notes', 'reflect-section-cost', 'reflect-section-calendar',
        ]);
    });

    it('D-4 upgrade from LIVE (P11): his LIVE fold and order choices are kept until he makes new ones', () => {
        prefs.set('collapsible-daily-logs', false);
        prefs.set('collapsible-notes', true);
        prefs.set('reflect-block-order', ['farm-status', 'notes', 'daily-logs']);
        renderPage();
        expect(screen.getByTestId('reflect-section-day-toggle')).toHaveAttribute('aria-expanded', 'false');
        expect(screen.getByTestId('reflect-section-notes-toggle')).toHaveAttribute('aria-expanded', 'true');
        expect(sectionOrder().slice(0, 4)).toEqual(['reflect-section-status', 'reflect-section-todo', 'reflect-section-notes', 'reflect-section-day']);
    });

    it('D-4 TEST build: the owner-layout label and the three versions; V1 opens all, V3 opens calendar and money one at a time', () => {
        renderPage();
        expect(screen.getByTestId('reflect-owner-preview-label')).toHaveTextContent('मालकाचा आढावा — नमुना');
        fireEvent.click(screen.getByTestId('reflect-layout-v1'));
        expect(screen.getByTestId('notes-list')).toBeInTheDocument();
        expect(screen.queryByTestId('reflect-reorder-toggle')).toBeNull(); // V1 keeps no order
        fireEvent.click(screen.getByTestId('reflect-layout-v3'));
        const expanded = (id: string) => screen.getByTestId(`reflect-section-${id}-toggle`).getAttribute('aria-expanded');
        expect([expanded('notes'), expanded('calendar'), expanded('cost')]).toEqual(['true', 'false', 'false']);
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        fireEvent.click(screen.getByTestId('reflect-section-cost-toggle'));
        expect([expanded('calendar'), expanded('cost')]).toEqual(['false', 'true']);
        // "पहिली भेट": this version forgets its folds
        fireEvent.click(screen.getByTestId('reflect-layout-first-visit'));
        expect([expanded('calendar'), expanded('cost')]).toEqual(['false', 'false']);
    });

    it('feeds every section from the real props — the money from the server ledger, never the log\'s own total', () => {
        renderPage();
        openAll();
        // three plots, and the whole farm's own card (lane RF2)
        expect(screen.getAllByTestId(/^plot-card-/).map(c => c.getAttribute('data-testid'))).toEqual(['plot-card-grape:g1', 'plot-card-grape:g2', 'plot-card-cane:c1', 'plot-card-farm']);
        expect(screen.getByTestId('plot-card-grape:g1')).toHaveAttribute('data-status', 'worked');
        expect(screen.getByTestId('plot-card-grape:g1').querySelector('[data-kind="crop"]')).toHaveTextContent('छाटणी');
        expect(screen.getByTestId('notes-count')).toHaveTextContent('1');
        expect(within(screen.getByTestId('notes-list')).getByText('कीड दिसली')).toBeInTheDocument();
        expect(within(screen.getByTestId('todo-group-today')).getByText('फवारणी')).toBeInTheDocument();
        expect(screen.getByTestId('cal-chip-g1-today')).toBeInTheDocument();
        expect(screen.getByTestId('week-total')).toHaveTextContent('₹ 1,500');
        expect(screen.getByTestId('plot-money-grape:g1')).toHaveTextContent('₹ 1,500');
        expect(document.body.textContent).not.toContain('9,999'); // the log's own guessed total is gone
        expect(screen.getByTestId('plot-state-grape:g1')).toHaveTextContent('पक्कं नाही');
        // no income in the ledger: "—", not ₹ 0
        expect(screen.getByTestId('in-hand-amount')).toHaveTextContent('—');
    });

    it('picking a crop narrows every section', () => {
        renderPage();
        openAll();
        fireEvent.click(screen.getByTestId('farm-crop-cane'));
        expect(screen.getAllByTestId(/^plot-card-/).map(c => c.getAttribute('data-testid'))).toEqual(['plot-card-cane:c1']);
        expect(screen.getByTestId('notes-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('cal-chip-g1-today')).toBeNull();
        expect(screen.getByTestId('cost-empty')).toBeInTheDocument();
    });

    it('a calendar day shows that day in the plot cards', () => {
        renderPage();
        openAll();
        pickOct21();
        expect(screen.getByTestId('day-label')).toHaveTextContent('बुधवार, 21 ऑक्टो');
        expect(screen.getByTestId('plot-card-cane:c1')).toHaveAttribute('data-status', 'worked');
        expect(screen.getByTestId('plot-empty-grape:g1')).toHaveTextContent('या दिवशी काही सांगितलं नाही');
        expect(screen.getByTestId('plot-empty-grape:g1').textContent).not.toContain('नोंद');
    });

    it('ticking a to-do hands the whole updated task to onUpdateTask (what the app\'s task store expects)', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('todo-tick-t1'));
        expect(props.onUpdateTask).toHaveBeenCalledWith(expect.objectContaining({ id: 't1', title: 'फवारणी', status: 'done', completedAt: expect.any(String) }));
        fireEvent.click(screen.getByTestId('todo-add'));
        expect(props.onAddTask).toHaveBeenCalled();
    });

    it('the in-hand card opens the income page; the ledger link opens the finance ledger', () => {
        const props = renderPage();
        openAll();
        fireEvent.click(screen.getByTestId('overview-money'));
        expect(props.navigate).toHaveBeenCalledWith('income');
        fireEvent.click(screen.getByTestId('open-finance'));
        expect(props.navigate).toHaveBeenCalledWith('finance-ledger');
    });

    it('a farm with no crop yet: honest empty lines, no invented figures', () => {
        ledger.entries = [];
        renderPage({ history: [], crops: [], tasks: [] });
        openAll();
        expect(screen.getByTestId('farm-status-empty')).toBeInTheDocument();
        expect(screen.getByTestId('plot-cards-empty')).toBeInTheDocument();
        expect(screen.getByTestId('todo-empty')).toBeInTheDocument();
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(document.body.textContent).not.toContain('₹ 0');
    });
});

describe('ReflectPage — lane RF: every piece of work, the result screen\'s way', () => {
    it('a plot card opens that plot day: buckets, then the time chips; a chip opens its recording inline; बदला takes the result screen path', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('plot-card-grape:g1'));
        expect(screen.getByTestId('rf-day-title')).toHaveTextContent('सोनाका · द्राक्ष');
        expect(screen.getByTestId('rf-day-date')).toHaveTextContent('आज');
        expect(screen.getByTestId('vr-day-crop')).toHaveAttribute('data-open', 'yes');
        expect(screen.getByTestId('rf-day')).not.toHaveTextContent('Edit This Log');
        fireEvent.click(screen.getByTestId('rf-time-g1-today'));
        expect(screen.getByTestId('rf-rec-g1-today-who')).toHaveTextContent('तुम्ही');
        fireEvent.click(screen.getByTestId('rf-rec-g1-today-edit-g1-today'));
        expect(props.onOpenLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1-today' }));
    });

    it('a plot day nothing was told for says so; "आणखी सांगा" asks THE ONE mic for that plot, and the new work is highlighted when it lands', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('plot-card-grape:g2'));
        expect(screen.getByTestId('rf-day-empty')).toHaveTextContent('आज अजून काही सांगितलं नाही');
        expect(screen.queryByTestId('rf-day-add')).toBeNull(); // the old hand-filled "add" is gone (lane E1)
        fireEvent.click(screen.getByTestId('rf-day-tell'));
        expect(props.onSpeak).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'addToDay', context: { place: { cropId: 'grape', plotId: 'g2' } } }));
        expect(screen.getByTestId('rf-day')).toBeInTheDocument(); // he stays on this plot day
    });

    it('a past day offers no "आणखी सांगा" (a recording is always today): no dead button', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        pickOct21();
        fireEvent.click(screen.getByTestId('plot-card-cane:c1'));
        expect(screen.queryByTestId('rf-day-tell')).toBeNull();
    });

    it('the money pill opens the money lens for that plot\'s day, by the plot (the ledger has no phone crop label)', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('plot-money-grape:g1'));
        const lens = JSON.parse(screen.getByTestId('money-lens').textContent ?? '{}');
        expect(lens).toEqual({ fromDate: TODAY_KEY, toDate: TODAY_KEY, plotId: 'g1' });
    });

    it('RF2 fix pass: the "आजचा आढावा" button is back as it was (title, count, it follows the chosen day)', () => {
        renderPage();
        expect(screen.getByTestId('activity-feed-button')).toHaveTextContent('आजचा आढावा');
        expect(screen.getByTestId('activity-feed-count')).toHaveTextContent('1');
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        pickOct21();
        expect(screen.getByTestId('activity-feed-button')).toHaveTextContent('दिवसाचा आढावा');
        expect(screen.getByTestId('activity-feed-button')).toHaveTextContent('बुधवार, 21 ऑक्टो');
        fireEvent.click(screen.getByTestId('activity-feed-button'));
        expect(screen.getByTestId('rf-feed-title')).toHaveTextContent('दिवसाचा आढावा');
        expect(screen.getByTestId('rf-feed-block-cane:c1')).toBeInTheDocument();
        expect(screen.queryByTestId('rf-feed-block-grape:g1')).toBeNull();
    });

    it('RF2 fix pass — the screen inside it (screen 2): one block per plot that had work, plus the whole farm; a time opens that recording in the block', () => {
        const farmWide = log({ id: 'farm-today', cropId: 'FARM_GLOBAL', plotIds: [], labour: [{ id: 'l', type: 'HIRED', count: 3 }],
            meta: { createdAtISO: '2026-10-25T04:00:00.000Z', createdByOperatorId: 'op-sunil' } });
        const props = renderPage({ history: [...history, farmWide] });
        expect(screen.getByTestId('activity-feed-count')).toHaveTextContent('2');
        fireEvent.click(screen.getByTestId('activity-feed-button'));
        const blocks = Array.from(document.querySelectorAll('[data-testid^="rf-feed-block-"]')).map(e => e.getAttribute('data-testid')).filter(id => !id!.endsWith('-times'));
        expect(blocks).toEqual(['rf-feed-block-grape:g1', 'rf-feed-block-farm']); // only places with work that day
        expect(screen.getByTestId('rf-feed-block-grape:g1-times')).toHaveTextContent('आज 1 वेळा सांगितलं');
        expect(screen.getByTestId('rf-feed-block-farm')).toHaveTextContent('संपूर्ण शेत');
        // ONE row of time chips per block; a tap opens that recording RIGHT THERE: its work as rows, and one small line
        const block = screen.getByTestId('rf-feed-block-grape:g1');
        fireEvent.click(within(block).getByTestId('rf-time-grape:g1-g1-today'));
        expect(within(block).getByTestId('rf-rec-grape:g1-g1-today-who')).toHaveTextContent('तुम्ही');
        expect(within(block).getByTestId('rf-rec-grape:g1-g1-today-state')).toHaveTextContent('पक्कं नाही');
        expect(within(block).getByTestId('rf-rec-grape:g1-g1-today-parts')).toHaveTextContent('छाटणी');
        expect(within(block).queryByTestId('vr-words')).toBeNull(); // no source-words panel
        fireEvent.click(within(block).getByTestId('rf-rec-grape:g1-g1-today-edit-g1-today'));
        expect(props.onOpenLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1-today' }));
        fireEvent.click(within(screen.getByTestId('rf-feed-block-farm')).getByTestId('rf-time-farm-farm-today'));
        expect(screen.getByTestId('rf-rec-farm-farm-today-who')).toHaveTextContent('सुनील');
        expect(screen.getByTestId('rf-rec-farm-farm-today-parts')).toHaveTextContent('3 जण');
    });

    it('the plot cards stay as built: whole-farm work also has its "संपूर्ण शेत" card', () => {
        const farmWide = log({ id: 'farm-today', cropId: 'FARM_GLOBAL', plotIds: [], labour: [{ id: 'l', type: 'HIRED', count: 3 }],
            meta: { createdAtISO: '2026-10-25T04:00:00.000Z', createdByOperatorId: 'op-sunil' } });
        renderPage({ history: [...history, farmWide] });
        expect(screen.getByTestId('plot-card-farm').querySelector('[data-kind="labour"]')).toHaveTextContent('3 जण');
        expect(screen.getByTestId('plot-card-grape:g1').querySelector('[data-kind="labour"]')).toBeNull();
    });

    it('B006: a crop with no plot opens "आणखी सांगा" with the crop → plot pickers (no place it cannot record on)', () => {
        const props = renderPage({ crops: [...CROPS, { id: 'flowers', name: 'Flowers', iconName: '', color: 'bg-pink-500', plots: [], supportedTasks: [], workflow: [] } as never] });
        fireEvent.click(screen.getByTestId('plot-card-flowers'));
        fireEvent.click(screen.getByTestId('rf-day-tell'));
        expect(props.onSpeak).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'addToDay', context: {} }));
    });

    it('a note opens its recording through the same plot-day view', () => {
        renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-notes-toggle'));
        expect(screen.getByTestId('note-o1-who')).toHaveTextContent('तुम्ही');
        fireEvent.click(screen.getByTestId('note-o1-source'));
        expect(screen.getByTestId('rf-day-title')).toHaveTextContent('सोनाका');
        expect(screen.getByTestId('rf-rec-g1-today')).toBeInTheDocument();
        expect(screen.queryByTestId('rf-glance')).toBeNull();
        expect(screen.queryByTestId('rf-rec-g1-today-play-listen')).toBeNull(); // ▶ only where it may be offered
    });

    it('money a worker may not see: "—", one line saying why, no money doors anywhere', () => {
        const props = renderPage({ farmRole: 'Worker' });
        openAll();
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(screen.getByTestId('season-hidden')).toBeInTheDocument();
        expect(screen.getByTestId('in-hand-amount')).toHaveTextContent('—');
        expect(screen.queryByTestId('week-total')).toBeNull();
        expect(screen.queryByTestId('plot-money-grape:g1')).toBeNull();
        expect(screen.queryByTestId('open-finance')).toBeNull();
        expect(document.body.textContent).not.toContain('1,500');
        fireEvent.click(screen.getByTestId('overview-money'));
        expect(props.navigate).not.toHaveBeenCalled();
    });

    it('a role the server has not told this phone yet stays closed (never shown money by default)', () => {
        renderPage({ farmRole: null });
        openAll();
        expect(screen.getByTestId('season-hidden')).toBeInTheDocument();
    });
});

describe('ReflectPage — lane OF (founder D-60 = 4A): any past day can be filled', () => {
    it('today: no "त्या दिवसाचं काम सांगा" (today\'s work is told from the home page)', () => {
        renderPage();
        openAll();
        expect(screen.queryByTestId('past-day-tell')).toBeNull();
        expect(screen.queryByTestId('past-day-tell-cal')).toBeNull();
    });

    it('a past day reached through "कामाचं कॅलेंडर": "त्या दिवसाचं काम सांगा · <date>" asks THE ONE mic for THAT day, with no place (crop → plot first)', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        pickOct21();
        const tell = screen.getByTestId('past-day-tell-cal');
        expect(tell).toHaveTextContent('त्या दिवसाचं काम सांगा');
        expect(screen.getByTestId('past-day-tell-cal-day')).toHaveTextContent('21 ऑक्टो');
        fireEvent.click(tell);
        expect(props.onSpeak).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'addToDay', context: { date: '2026-10-21' } }));
    });

    it('a past day reached through the day bar shows it there too', () => {
        const props = renderPage();
        openAll();
        fireEvent.click(screen.getByTestId('day-prev'));
        fireEvent.click(screen.getByTestId('past-day-tell'));
        expect(props.onSpeak).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'addToDay', context: { date: '2026-10-24' } }));
    });
});

describe('ReflectPage — lane OF fix 1 (H1): no work can be told for a day after today', () => {
    it('a FUTURE day in "कामाचं कॅलेंडर" can be looked at, but offers no "त्या दिवसाचं काम सांगा"', () => {
        const props = renderPage();
        fireEvent.click(screen.getByTestId('reflect-section-calendar-toggle'));
        fireEvent.click(screen.getByTestId('cal-day-2026-10-27')); // two days after today (25 Oct)
        expect(screen.getByTestId('cal-day-2026-10-27')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByTestId('past-day-tell-cal')).toBeNull();
        expect(screen.queryByTestId('past-day-tell')).toBeNull();
        expect(props.onSpeak).not.toHaveBeenCalled();
    });
});
