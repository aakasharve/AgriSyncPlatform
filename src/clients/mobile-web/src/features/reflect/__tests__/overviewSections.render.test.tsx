// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I6)
 *
 * One render test per section of the redesigned "पूर्ण शेतीचा आढावा", fed by the real adapters over real-shaped
 * records (no preview sample data). Each pins what the farmer reads — above all, "—" / an honest empty line
 * where nothing was recorded, never a 0 (P4).
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

vi.mock('../overview/useLogAttachmentCount', () => ({ useLogAttachmentCount: () => 0 }));
const lang = vi.hoisted(() => ({ value: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', async () => {
    const { t } = await import('../../../i18n/translations');
    const ctx = () => ({ language: lang.value, setLanguage: () => undefined, t: (k: string) => t(k, lang.value) });
    return { useLanguage: ctx, useOptionalLanguage: ctx };
});

import { ActivityCalendar } from '../overview/ActivityCalendar';
import { buildCalendarDay } from '../overview/calendarModel';
import { CostSection, InHandCard } from '../overview/CostSection';
import { DayBar } from '../overview/DayBar';
import { FarmStatus } from '../overview/FarmStatus';
import { EMPTY_LEDGER, buildInHand, buildSeasonTotals, buildSpend, spendRange, type Ledger } from '../overview/moneyModel';
import { buildDayNotes } from '../overview/notesModel';
import { NotesList } from '../overview/NotesList';
import { buildPlotDayCard } from '../overview/plotDayModel';
import { PlotDayCards } from '../overview/PlotDayCards';
import { plotRefsInScope, selectAll, toViewScope } from '../overview/reflectSelection';
import { buildTodoList } from '../overview/todoModel';
import { TodoCount, TodoSection } from '../overview/TodoSection';
import { CROPS, TODAY, TODAY_KEY, log, task } from './reflectFixtures';

afterEach(cleanup);
const all = toViewScope(CROPS, selectAll(CROPS));

describe('शेताची स्थिती (FarmStatus)', () => {
    it('shows "सर्व पिकं" and each real crop; picking a crop narrows the plot chips to it', () => {
        const onSel = vi.fn();
        const { rerender } = render(<FarmStatus crops={CROPS} sel={selectAll(CROPS)} onSel={onSel} />);
        expect(screen.getByTestId('farm-crop-all')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-crop-grape')).toHaveTextContent('द्राक्ष');
        expect(screen.getAllByTestId(/^farm-plot-/)).toHaveLength(3);
        fireEvent.click(screen.getByTestId('farm-crop-grape'));
        expect(onSel).toHaveBeenCalledWith({ crop: 'grape', plotIds: ['g1', 'g2'] });
        rerender(<FarmStatus crops={CROPS} sel={{ crop: 'grape', plotIds: ['g1'] }} onSel={onSel} />);
        expect(screen.getAllByTestId(/^farm-plot-/)).toHaveLength(2);
        expect(screen.getByTestId('farm-plot-g1')).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByTestId('farm-plot-g2')).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByTestId('farm-crop-grape')).toHaveTextContent('1 पैकी 2 प्लॉट');
    });

    it('no crop yet: says so plainly', () => {
        render(<FarmStatus crops={[]} sel={{ crop: 'all', plotIds: [] }} onSel={vi.fn()} />);
        expect(screen.getByTestId('farm-status-empty')).toBeInTheDocument();
    });
});

describe('करायची कामे (TodoSection)', () => {
    const list = buildTodoList({
        tasks: [task('late', 'पाणी द्यायचं', { dueDate: '2026-10-23', priority: 'urgent' }), task('log', 'फवारणी', { dueDate: TODAY_KEY }), task('done', 'बांधणी', { status: 'done' })],
        storeIds: new Set(['late', 'done']), crops: CROPS, scope: all, wholeFarm: true, todayKey: TODAY_KEY,
    });

    it('reads late → today, ticks a stored task, and cannot tick one the store does not hold', () => {
        const onToggle = vi.fn();
        render(<TodoSection list={list} onToggle={onToggle} />);
        expect(within(screen.getByTestId('todo-group-late')).getByText('पाणी द्यायचं')).toBeInTheDocument();
        expect(within(screen.getByTestId('todo-group-late')).getByText('2 दिवस उशीर')).toBeInTheDocument();
        expect(screen.getByText('तातडीचं')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('todo-tick-late'));
        expect(onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'late' }));
        expect(screen.getByTestId('todo-tick-log')).toBeDisabled();
        // nothing due "later": the tile says "—", not 0
        expect(screen.getByTestId('todo-tile-later')).toHaveTextContent('—');
        // done ones are folded
        expect(screen.queryByTestId('todo-group-done')).toBeNull();
        fireEvent.click(screen.getByTestId('todo-done-toggle'));
        expect(screen.getByTestId('todo-group-done')).toBeInTheDocument();
    });

    it('the header count is what is still open, red when something is late', () => {
        render(<TodoCount list={list} />);
        expect(screen.getByTestId('todo-count')).toHaveTextContent('2 बाकी');
        expect(screen.getByTestId('todo-count').className).toContain('bg-rose-600');
    });

    it('no task at all: an honest empty line, the real "add" opens the task sheet, no count badge', () => {
        const empty = buildTodoList({ tasks: [], storeIds: new Set(), crops: CROPS, scope: all, wholeFarm: true, todayKey: TODAY_KEY });
        const onAdd = vi.fn();
        render(<><TodoCount list={empty} /><TodoSection list={empty} onToggle={vi.fn()} onAdd={onAdd} /></>);
        expect(screen.getByTestId('todo-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('todo-count')).toBeNull();
        fireEvent.click(screen.getByTestId('todo-add'));
        expect(onAdd).toHaveBeenCalled();
    });
});

describe.each(['mr', 'en'] as const)('प्लॉटनिहाय काम (PlotDayCards) — lane RF2, the founder screen 1 (%s)', language => {
    const refs = plotRefsInScope(CROPS, all);
    const meta = (hhmm: string) => ({ createdAtISO: `2026-10-25T${hhmm}:00.000Z`, createdByOperatorId: 'op' });
    const worked = log({ id: 'w', plotIds: ['g1'], meta: meta('03:00'), cropActivities: [{ id: 'a', title: 'छाटणी' }], labour: [{ id: 'l', type: 'HIRED', count: 5 }] });
    const later = log({ id: 'w2', plotIds: ['g1'], meta: meta('09:00'), labour: [{ id: 'l2', type: 'HIRED', count: 10 }],
        observations: [{ id: 'o', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '', textRaw: 'पानं पिवळी', noteType: 'observation', severity: 'normal', source: 'voice' }] });
    const stopped = log({ id: 's', cropId: 'cane', plotIds: ['c1'], disturbance: { scope: 'FULL_DAY', group: 'WEATHER', reason: 'पाऊस', blockedSegments: [] } });
    // lane RF: the card's money is the server ledger's for that plot-day (here ₹ 1,500 on g1, not all of it on the server yet)
    const cards = refs.map(r => buildPlotDayCard(r, [worked, later, stopped], all, TODAY_KEY, TODAY, r.plotId === 'g1' ? { amount: 1500, hidden: false, partial: ['notOnServer'] } : undefined, language));
    const wrap = (ui: React.ReactElement) => ui;
    beforeEach(() => { lang.value = language; });
    afterEach(() => { lang.value = 'mr'; });

    it('no numbered squares and no colour key: only what happened, as chips in the part colours; two labour chips, never summed', () => {
        render(wrap(<PlotDayCards cards={cards} isToday onOpen={vi.fn()} onCost={vi.fn()} />));
        const card = screen.getByTestId('plot-card-grape:g1');
        expect(card.querySelectorAll('[data-bucket]')).toHaveLength(0);
        expect(screen.queryByTestId('bucket-key')).toBeNull();
        const chips = [...card.querySelectorAll('[data-kind]')].map(c => c.getAttribute('data-kind'));
        expect(chips).toEqual(['crop', 'labour', 'labour', 'observation']);
        const labour = [...card.querySelectorAll('[data-kind="labour"]')].map(c => c.textContent);
        expect(labour).toEqual(['5 जण', '10 जण']);
        expect(card.textContent).not.toContain('15');
        // the farmer's note is an "निरीक्षण" chip, not the amber box
        expect(card.querySelector('[data-kind="observation"]')).toHaveTextContent('पानं पिवळी');
        expect(screen.queryByTestId('plot-note-grape:g1')).toBeNull();
        // each chip carries its part's icon (the result screen's) and colour
        expect(card.querySelector('[data-kind="crop"] [data-icon="work"]')).not.toBeNull();
        expect((card.querySelector('[data-kind="crop"]') as HTMLElement).style.background).not.toBe('');
        expect(card).toHaveTextContent(language === 'en' ? 'Told 2 times today' : 'आज 2 वेळा सांगितलं');
    });

    it('an empty day says so plainly; a stopped day shows its stoppage chip', () => {
        render(wrap(<PlotDayCards cards={cards} isToday onOpen={vi.fn()} onCost={vi.fn()} />));
        expect(screen.getByTestId('plot-empty-grape:g2')).toHaveTextContent(language === 'en' ? 'Nothing told yet today' : 'आज अजून काही सांगितलं नाही');
        expect(screen.getByTestId('plot-card-cane:c1').querySelector('[data-kind="blocker"]')).toHaveTextContent('पाऊस');
    });

    it('tapping the card opens the day; tapping the money chip opens the money lens only', () => {
        const onOpen = vi.fn();
        const onCost = vi.fn();
        render(wrap(<PlotDayCards cards={cards} isToday onOpen={onOpen} onCost={onCost} />));
        expect(screen.getByTestId('plot-money-grape:g1')).toHaveTextContent('1,500');
        expect(screen.getByTestId('plot-money-partial-grape:g1')).toHaveTextContent(language === 'en' ? 'partial' : 'अपूर्ण');
        fireEvent.click(screen.getByTestId('plot-money-grape:g1'));
        expect(onCost).toHaveBeenCalledWith(expect.objectContaining({ key: 'grape:g1', plotId: 'g1' }));
        expect(onOpen).not.toHaveBeenCalled();
        fireEvent.click(screen.getByTestId('plot-card-grape:g2'));
        expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ key: 'grape:g2' }));
    });

    it('lane RF: the ONE status wording on the card; hidden money stays hidden (no chip, no door)', () => {
        render(wrap(<PlotDayCards cards={cards} isToday onOpen={vi.fn()} />));
        expect(screen.getByTestId('plot-state-grape:g1')).toHaveTextContent(language === 'en' ? 'Not confirmed' : 'पक्कं नाही');
        expect(screen.queryByTestId('plot-state-grape:g2')).toBeNull(); // nothing told: no status at all
        expect(screen.queryByTestId('plot-money-grape:g1')).toBeNull(); // money he may not see: no chip
        const hidden = refs.map(r => buildPlotDayCard(r, [worked], all, TODAY_KEY, TODAY, { amount: null, hidden: true, partial: [] }, language));
        cleanup();
        render(wrap(<PlotDayCards cards={hidden} isToday onOpen={vi.fn()} onCost={vi.fn()} />));
        expect(screen.queryByTestId('plot-money-grape:g1')).toBeNull();
        expect(screen.getByTestId('plot-card-grape:g1').textContent).not.toMatch(/₹/);
    });

    it('the "संपूर्ण शेत" card: whole-farm work in the same style, its own door', () => {
        const onOpenFarm = vi.fn();
        const farm = { chips: [{ id: 'x', kind: 'labour' as const, text: '3 जण', verified: true }], status: 'worked' as const, recordings: 1, confirmed: false };
        render(wrap(<PlotDayCards cards={cards} farm={farm} isToday onOpen={vi.fn()} onOpenFarm={onOpenFarm} />));
        const card = screen.getByTestId('plot-card-farm');
        expect(card).toHaveTextContent(language === 'en' ? 'Whole farm' : 'संपूर्ण शेत');
        expect(card.querySelector('[data-kind="labour"]')).toHaveTextContent('3 जण');
        fireEvent.click(card);
        expect(onOpenFarm).toHaveBeenCalledTimes(1);
    });
});

describe('DayBar', () => {
    it('one tap for आज / काल / परवा; no step into the future; any past day from the picker', () => {
        const onDate = vi.fn();
        render(<DayBar date={new Date()} onDate={onDate} />);
        expect(screen.getByTestId('day-next')).toBeDisabled();
        expect(screen.getByTestId('day-quick-0')).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(screen.getByTestId('day-quick-1'));
        expect(onDate).toHaveBeenCalledTimes(1);
        fireEvent.change(screen.getByTestId('day-picker'), { target: { value: '2026-09-14' } });
        const picked = onDate.mock.calls[1][0] as Date;
        expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 8, 14]);
    });
});

describe('निरीक्षणं व नोंदी (NotesList)', () => {
    it('nothing that day: one plain line', () => {
        render(<NotesList notes={[]} />);
        expect(screen.getByTestId('notes-empty')).toHaveTextContent('या दिवशी कोणतीही नोंद नाही');
    });

    it('each note: its kind, time, plot, who — and a long one opens on a tap', () => {
        const notes = buildDayNotes({
            history: [log({ id: 'a', plotIds: ['g1'], meta: { createdAtISO: '', createdByOperatorId: 'op' }, observations: [{ id: 'o', plotId: 'g1', dateKey: TODAY_KEY, timestamp: '2026-10-25T03:40:00.000Z', textRaw: 'कीड दिसली', noteType: 'issue', severity: 'normal', source: 'voice' }] })],
            dateKey: TODAY_KEY, scope: all, crops: CROPS, operatorNameById: { op: 'रमेश' },
        });
        render(<NotesList notes={notes} />);
        const note = screen.getByTestId('note-o');
        expect(note).toHaveTextContent('अडचण');
        expect(note).toHaveTextContent('सकाळी 9:10 · सोनाका · रमेश');
        fireEvent.click(screen.getByTestId('note-o-toggle'));
        expect(screen.getByTestId('note-o-toggle')).toHaveAttribute('aria-expanded', 'true');
    });
});

describe('कामाचं कॅलेंडर (ActivityCalendar)', () => {
    const history = [log({ id: 'w', plotIds: ['g1'], cropActivities: [{ id: 'a', title: 'छाटणी' }] })];
    const dayOf = (d: Date) => buildCalendarDay({ date: d, history, crops: CROPS, scope: all, dueTasks: [task('t', 'फवारणी', { dueDate: '2026-10-21' })], today: TODAY });
    const legend = CROPS.map(c => ({ id: c.id, name: c.name, color: c.color }));

    it('week: seven days, the record in its crop colour, a due to-do on its day, "नोंद नाही" on an empty day', () => {
        const onDate = vi.fn();
        render(<ActivityCalendar date={TODAY} onDate={onDate} mode="week" onMode={vi.fn()} view={TODAY} onView={vi.fn()} dayOf={dayOf} legendCrops={legend} />);
        expect(screen.getAllByTestId(/^cal-day-/)).toHaveLength(7);
        expect(screen.getByTestId('cal-title')).toHaveTextContent('25–31 ऑक्टो');
        const chip = screen.getByTestId('cal-chip-w');
        expect(chip.className).toContain('bg-purple-500');
        expect(chip).toHaveTextContent('छाटणी');
        expect(within(screen.getByTestId('cal-day-2026-10-26')).getByText('नोंद नाही')).toBeInTheDocument();
        fireEvent.click(screen.getByTestId('cal-day-2026-10-26'));
        expect(onDate).toHaveBeenCalled();
        expect(within(screen.getByTestId('cal-key')).getByText('द्राक्ष')).toBeInTheDocument();
    });

    it('month: the month grid with crop strips; ‹ › move by a month; the switch changes the mode', () => {
        const onView = vi.fn();
        const onMode = vi.fn();
        render(<ActivityCalendar date={TODAY} onDate={vi.fn()} mode="month" onMode={onMode} view={TODAY} onView={onView} dayOf={dayOf} legendCrops={legend} />);
        expect(screen.getAllByTestId(/^cal-cell-/)).toHaveLength(31);
        expect(screen.getByTestId('cal-title')).toHaveTextContent('ऑक्टोबर 2026');
        expect(screen.getByTestId('cal-cell-2026-10-25').querySelector('.bg-purple-500')).not.toBeNull();
        expect(screen.getByTestId('cal-cell-2026-10-21').querySelector('.border-dashed')).not.toBeNull();
        fireEvent.click(screen.getByTestId('cal-next'));
        expect((onView.mock.calls[0][0] as Date).getMonth()).toBe(10);
        fireEvent.click(screen.getByTestId('cal-mode-week'));
        expect(onMode).toHaveBeenCalledWith('week');
    });
});

describe('उत्पन्न आणि खर्च (CostSection + InHandCard) — the server ledger', () => {
    const range = spendRange('week', TODAY, TODAY);
    const noSessions = () => [];

    it('nothing recorded: "—" everywhere and a line saying why; no ₹ 0', () => {
        const totals = buildSeasonTotals(EMPTY_LEDGER, CROPS, all, noSessions, true);
        render(<><InHandCard figure={buildInHand(EMPTY_LEDGER, CROPS, all, true)} /><CostSection totals={totals} spend={buildSpend(EMPTY_LEDGER, CROPS, all, range, true)} range={range} /></>);
        expect(screen.getByTestId('in-hand-amount')).toHaveTextContent('—');
        expect(screen.getByTestId('season-cost')).toHaveTextContent('—');
        expect(screen.getByTestId('season-income')).toHaveTextContent('—');
        expect(screen.getByTestId('season-net')).toHaveTextContent('—');
        expect(screen.getByTestId('season-net-why')).toHaveTextContent('उत्पन्न अजून नोंदलेलं नाही');
        expect(screen.getByTestId('cost-empty')).toBeInTheDocument();
        expect(screen.queryByTestId('cost-mix')).toBeNull();
        expect(document.body.textContent).not.toContain('₹ 0');
        expect(screen.queryByTestId('open-finance')).toBeNull();
    });

    it('recorded money: totals, the 7-day chart, by crop with shares, the mix, the finance ledger link', () => {
        const ledger: Ledger = {
            entries: [
                { id: 'a', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense', category: 'Labour', amount: 2000 },
                { id: 'a2', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Expense', category: 'Input', amount: 1000 },
                { id: 'b', plotId: 'c1', dateKey: TODAY_KEY, direction: 'Expense', category: 'Machinery', amount: 1000 },
                { id: 'r', plotId: 'g1', dateKey: TODAY_KEY, direction: 'Income', category: 'Other', amount: 42500 },
            ],
            gaps: [],
            complete: true,
        };
        const totals = buildSeasonTotals(ledger, CROPS, all, noSessions, true);
        const onOpenFinance = vi.fn();
        const onOpenIncome = vi.fn();
        render(<><InHandCard figure={buildInHand(ledger, CROPS, all, true)} onOpen={onOpenIncome} /><CostSection totals={totals} spend={buildSpend(ledger, CROPS, all, range, true)} range={range} onOpenFinance={onOpenFinance} /></>);
        expect(screen.getByTestId('in-hand-amount')).toHaveTextContent('₹ 42,500');
        fireEvent.click(screen.getByTestId('overview-money'));
        expect(onOpenIncome).toHaveBeenCalled();
        expect(screen.getByTestId('season-cost')).toHaveTextContent('₹ 4,000');
        expect(screen.getByTestId('week-total')).toHaveTextContent('₹ 4,000');
        expect(screen.getByTestId('cost-bars-day')).toBeInTheDocument();
        expect(screen.getByTestId('cost-top')).toHaveTextContent('रवि');
        fireEvent.click(screen.getByTestId('cost-view-crop'));
        expect(screen.getByTestId('cost-bars-crop')).toHaveTextContent('₹ 3,000 · 75%');
        expect(screen.getByTestId('cost-mix')).toHaveTextContent('मजुरी ₹ 2,000');
        expect(screen.getByTestId('cost-mix')).toHaveTextContent('इतर —');
        expect(screen.queryByTestId('season-partial')).toBeNull(); // a complete set says nothing more
        fireEvent.click(screen.getByTestId('open-finance'));
        expect(onOpenFinance).toHaveBeenCalled();
    });
});
