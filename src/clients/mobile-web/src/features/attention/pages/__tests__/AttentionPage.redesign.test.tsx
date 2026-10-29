// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H15 / T3, H16)
 *
 * लक्ष द्या in the app's common look, on the REAL server board and the REAL task store:
 *   H14  — Marathi only: one title bar with the big "← मागे", a plain intro line, glass cards; no "Attention",
 *          no "Critical / Needs Attention / Watch" bands, no "as of", no English twin lines, no "Loading...";
 *   H16  — every card's button leads where it can be done (tests / तुलना / शेड्यूल / आढावा / sync retry), and a
 *          card whose action has nowhere to go (a dispute; तुलना for a worker) draws NO button;
 *   H15/T3 — to-dos whose day has passed show here too, and a tick here or in करायची कामे clears both
 *          (one store — proven with both pages mounted over the same state).
 *   I22 (founder D-1) — three groups (वेळ निघून गेली / आज करायचे / निर्णय घ्यायचा) from ONE list: reminders
 *          (झाले / वेळ बदला), the server's scheduled steps (काम नोंदवा / पुढे ठरवा), the plot cards; disputes
 *          stay in मंजुरी; a step clears only on the server's word or a confirmed move.
 * Only the edges are mocked: Dexie (the board), the sync worker, the HTTP call.
 */
import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AttentionCardCacheRecord } from '../../../../infrastructure/storage/DexieDatabase';
import type { CropProfile, PlannedTask } from '../../../../types';

const board = vi.hoisted(() => ({ cards: [] as unknown[], cursor: { tableName: 'shramsafal', lastSyncAt: '2026-10-26T03:30:00.000Z', version: 1 } as unknown, meta: {} as Record<string, unknown> }));
const triggerNow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const apiFetch = vi.hoisted(() => vi.fn());

vi.mock('../../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => board.cursor },
        appMeta: { get: async (key: string) => (key in board.meta ? { key, value: board.meta[key] } : undefined) },
    }),
}));
vi.mock('../../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: () => triggerNow() } }));
vi.mock('../../../../infrastructure/api/apiFetch', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

import AttentionPage from '../AttentionPage';
import { SCHEDULED_WORK_META_KEY, clearRescheduledForTests } from '../../scheduledWork';
import { TodoSection } from '../../../reflect/overview/TodoSection';
import { buildTodoList, toggledTask } from '../../../reflect/overview/todoModel';

const card = (id: string, rank: string | number, suggestedAction: string | number, labelMr: string, extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => ({
    cardId: id, farmId: 'f1', farmName: 'आर्वे शेत', plotId: `plot-${id}`, plotName: 'सोनाका', cropCycleId: 'cc1', stageName: 'फुलोरा',
    rank, computedAtUtc: '2026-10-26T03:30:00.000Z',
    titleEn: `EN title ${id}`, titleMr: `मराठी शीर्षक ${id}`, descriptionEn: 'EN description', descriptionMr: 'काही कामांवर लक्ष द्यावे',
    suggestedAction, suggestedActionLabelEn: 'EN label', suggestedActionLabelMr: labelMr,
    overdueTaskCount: null, latestHealthScore: null, unresolvedDisputeCount: null, ...extra,
});

const CARDS = [
    card('watch', 'Watch', 'OpenPlot', 'तुकडा पहा'),
    card('dispute', 'Critical', 'ResolveDispute', 'वाद सोडवा', { unresolvedDisputeCount: 2 }),
    card('compare', 'NeedsAttention', 'OpenStageCompare', 'टप्पा तुलना पहा', { latestHealthScore: 'NeedsAttention' }),
    card('test', 'NeedsAttention', 'AssignTest', 'चाचण्या नियुक्त करा'),
    card('owed', 'NeedsAttention', 'ReviewOverdueTasks', 'थकलेली कामे पहा', { overdueTaskCount: 4 }),
    card('sync', 'Watch', 'RetryFailedSync', 'पुन्हा जोडा'),
];

const ENGLISH = /Attention|Critical|Needs Attention|Watch|as of|Loading|EN title|EN label|overdue|signals?/;

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00.000Z'));
    board.cards = CARDS;
    board.meta = {};
    triggerNow.mockClear();
    apiFetch.mockReset();
    clearRescheduledForTests();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('लक्ष द्या — Marathi page in the common look (H14)', () => {
    it('one title bar with the big "मागे" that goes back; a plain intro; no English at all', async () => {
        const onBack = vi.fn();
        render(<AttentionPage onBack={onBack} onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक test')).toBeInTheDocument());
        expect(screen.getByTestId('page-title')).toHaveTextContent('लक्ष द्या');
        fireEvent.click(screen.getByTestId('page-back'));
        expect(onBack).toHaveBeenCalledTimes(1);
        expect(screen.getByText('आज ज्याकडे पाहायला हवं, ते इथे. एक-एक करून पूर्ण करा.')).toBeInTheDocument();
        const text = screen.getByTestId('attention-page').textContent ?? '';
        expect(text).not.toMatch(ENGLISH);
        // the server's Marathi, and Marathi rank words, Marathi chips (the one Critical card was a dispute: not here, D-1)
        expect(screen.queryByText('गंभीर')).toBeNull();
        expect(screen.getAllByText('लक्ष द्या').length).toBeGreaterThan(1);
        expect(screen.getByText('4 कामं बाकी')).toBeInTheDocument();
        expect(screen.getByText('तब्येत: लक्ष द्या')).toBeInTheDocument();
        expect(screen.getByTestId('attention-as-of')).toHaveTextContent('आज सकाळी 9:00 पर्यंतची माहिती');
    });

    it('most serious first', async () => {
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक test')).toBeInTheDocument());
        const order = Array.from(document.querySelectorAll('[data-testid^="attention-card-"]')).map(e => e.getAttribute('data-testid'));
        expect(order.slice(0, 3).sort()).toEqual(['attention-card-compare', 'attention-card-owed', 'attention-card-test']);
        expect(order.slice(-2)).toEqual(['attention-card-watch', 'attention-card-sync']);
    });

    it('while loading, it says so in Marathi', () => {
        render(<AttentionPage />);
        expect(screen.getByTestId('attention-loading')).toHaveTextContent('माहिती आणत आहोत…');
    });
});

describe('लक्ष द्या — every button leads where it can be done, or is not drawn (H16)', () => {
    it('maps each server action to a real place', async () => {
        const onGo = vi.fn();
        render(<AttentionPage onGo={onGo} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक test')).toBeInTheDocument());

        fireEvent.click(screen.getByTestId('attention-go-test'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'tests' }, expect.objectContaining({ cardId: 'test' }));
        expect(window.location.pathname).toBe('/tests');
        expect(window.location.search).toContain('plotId=plot-test');

        fireEvent.click(screen.getByTestId('attention-go-compare'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'compare' }, expect.anything());
        fireEvent.click(screen.getByTestId('attention-go-owed'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'route', route: 'schedule' }, expect.anything());
        // "तुकडा पहा" opens the overview on THIS card's plot
        fireEvent.click(screen.getByTestId('attention-go-watch'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'reflect', plotId: 'plot-watch' }, expect.anything());

        fireEvent.click(screen.getByTestId('attention-go-sync'));
        await waitFor(() => expect(triggerNow).toHaveBeenCalled());
        expect(onGo).toHaveBeenCalledTimes(4);
    });

    it('a disputed record stays in मंजुरी (D-1): its card is not on लक्ष द्या at all, and nothing links to मंजुरी', async () => {
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक test')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-card-dispute')).toBeNull();
        expect(screen.queryByText('मराठी शीर्षक dispute')).toBeNull();
        expect(screen.getByTestId('attention-page')).not.toHaveTextContent('मंजुरी');
    });

    it('a worker (तुलना hidden) gets no "टप्पा तुलना पहा" button', async () => {
        render(<AttentionPage onGo={vi.fn()} hiddenViews={['compare']} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक compare')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-go-compare')).toBeNull();
        expect(screen.getByTestId('attention-go-test')).toBeInTheDocument();
    });

    it('with nowhere to go at all (no navigation given), no card draws a dead button — only the sync retry runs here', async () => {
        render(<AttentionPage />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक test')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-go-test')).toBeNull();
        expect(screen.getByTestId('attention-go-sync')).toBeInTheDocument();
    });
});

/*
 * What the server REALLY sends (I14 verifier BLOCKER): `AttentionRank` / `SuggestedActionKind` are C# enums with
 * no string converter, so `/sync/pull` carries their ORDINALS and the reconciler stores them unchanged.
 * rank: Critical 0, NeedsAttention 1, Watch 2, Healthy 3 · action: OpenPlot 0, OpenStageCompare 1, AssignTest 2,
 * ResolveDispute 3, ReviewOverdueTasks 4, RetryFailedSync 5. Labels and stage names are the server's own.
 */
const WIRE_CARDS = [
    card('w-watch', 2, 0, 'तुकडा पहा', { stageName: 'unstated' }),
    card('w-dispute', 0, 3, 'वाद सोडवा', { stageName: 'Flowering & Fruit Set', unresolvedDisputeCount: 2 }),
    card('w-compare', 1, 1, 'टप्पा तुलना पहा', { stageName: 'Unknown' }),
    card('w-test', 1, 2, 'चाचण्या नियुक्त करा', { stageName: 'Bulb Development' }),
    card('w-owed', 1, 4, 'थकलेली कामे पहा', { stageName: 'Vegetative Growth', overdueTaskCount: 3 }),
    card('w-sync', 3, 5, 'पुन्हा जोडा', { stageName: null }),
    card('w-signal', 0, 2, 'अनुपालन सिग्नल पहा', { suggestedActionLabelEn: 'View compliance signal', stageName: 'Some Custom Stage' }),
];

describe('लक्ष द्या — on the server\'s REAL wire format (numbers, English template stages)', () => {
    beforeEach(() => { board.cards = WIRE_CARDS; });

    it('every card with somewhere to go draws its button; each leads to its real place', async () => {
        const onGo = vi.fn();
        render(<AttentionPage onGo={onGo} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक w-test')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attention-go-w-test'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'tests' }, expect.objectContaining({ cardId: 'w-test' }));
        fireEvent.click(screen.getByTestId('attention-go-w-compare'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'compare' }, expect.anything());
        fireEvent.click(screen.getByTestId('attention-go-w-owed'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'route', route: 'schedule' }, expect.anything());
        fireEvent.click(screen.getByTestId('attention-go-w-watch'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'reflect', plotId: 'plot-w-watch' }, expect.anything());
        // a compliance-signal card goes by the action it maps to (2 = tests), and its button says THAT place —
        // never "अनुपालन सिग्नल पहा", and never to the still-English चेतावण्या page (I14-V2F-01)
        const signal = screen.getByTestId('attention-go-w-signal');
        expect(signal).toHaveTextContent('चाचण्या नियुक्त करा');
        fireEvent.click(signal);
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'tests' }, expect.objectContaining({ cardId: 'w-signal' }));
        expect(onGo).not.toHaveBeenCalledWith({ kind: 'route', route: 'compliance' }, expect.anything());
        fireEvent.click(screen.getByTestId('attention-go-w-sync'));
        await waitFor(() => expect(triggerNow).toHaveBeenCalled());
        // a dispute (3) still has nowhere to be resolved
        expect(screen.queryByTestId('attention-go-w-dispute')).toBeNull();
    });

    it('a Critical card (0) says "गंभीर" with the red edge — never "नजर ठेवा"; most serious first', async () => {
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक w-signal')).toBeInTheDocument());
        const critical = screen.getByTestId('attention-card-w-signal');
        expect(within(critical).getByTestId('attention-rank')).toHaveTextContent('गंभीर');
        expect(critical.className).toContain('border-l-rose-500');
        expect(within(screen.getByTestId('attention-card-w-watch')).getByTestId('attention-rank')).toHaveTextContent('नजर ठेवा');
        expect(within(screen.getByTestId('attention-card-w-sync')).getByTestId('attention-rank')).toHaveTextContent('ठीक');
        const order = Array.from(document.querySelectorAll('[data-testid^="attention-card-"]')).map(e => e.getAttribute('data-testid'));
        expect(order[0]).toBe('attention-card-w-signal');
        expect(order).not.toContain('attention-card-w-dispute');
        expect(order.at(-1)).toBe('attention-card-w-sync');
    });

    it('the server\'s English stage names are said in Marathi; "unstated" / "Unknown" / an unknown name show no stage', async () => {
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक w-test')).toBeInTheDocument());
        const stageOf = (id: string) => within(screen.getByTestId(`attention-card-${id}`)).queryByTestId('attention-stage');
        expect(stageOf('w-test')).toHaveTextContent('कांदा पोसणे');
        expect(stageOf('w-owed')).toHaveTextContent('झाडाची वाढ');
        expect(stageOf('w-watch')).toBeNull();
        expect(stageOf('w-compare')).toBeNull();
        expect(stageOf('w-signal')).toBeNull();
        // no English anywhere on the page (the fixture's own card ids "w-…" aside)
        expect((screen.getByTestId('attention-page').textContent ?? '').replace(/w-[a-z]+/g, '')).not.toMatch(/[A-Za-z]/);
    });
});

/*
 * Compliance-signal cards (I14 verifier MAJOR I14-V2F-01). The server gives every one the label "अनुपालन सिग्नल
 * पहा" whatever its action (`GetAttentionBoardHandler.cs`); the चेतावण्या page that label names is still English,
 * so each goes by its mapped action, and its button says the server's own words for THAT action.
 */
const signalCard = (id: string, action: number) =>
    card(id, 1, action, 'अनुपालन सिग्नल पहा', { suggestedActionLabelEn: 'View compliance signal', stageName: null });
const SIGNAL_CARDS = [
    signalCard('w-sigplot', 0), signalCard('w-sigcompare', 1), signalCard('w-sigtest', 2),
    signalCard('w-sigdispute', 3), signalCard('w-sigowed', 4),
];

describe('लक्ष द्या — compliance-signal cards go where their action can be done (I14-V2F-01)', () => {
    beforeEach(() => { board.cards = SIGNAL_CARDS; });

    it('each opens its action\'s real place, labelled with that place; none opens चेतावण्या', async () => {
        const onGo = vi.fn();
        render(<AttentionPage onGo={onGo} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक w-sigtest')).toBeInTheDocument());
        const go = (id: string) => screen.getByTestId(`attention-go-${id}`);

        expect(go('w-sigtest')).toHaveTextContent('चाचण्या नियुक्त करा');
        fireEvent.click(go('w-sigtest'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'tests' }, expect.anything());

        expect(go('w-sigcompare')).toHaveTextContent('टप्पा तुलना पहा');
        fireEvent.click(go('w-sigcompare'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'compare' }, expect.anything());

        expect(go('w-sigowed')).toHaveTextContent('थकलेली कामे पहा');
        fireEvent.click(go('w-sigowed'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'route', route: 'schedule' }, expect.anything());

        expect(go('w-sigplot')).toHaveTextContent('तुकडा पहा');
        fireEvent.click(go('w-sigplot'));
        expect(onGo).toHaveBeenLastCalledWith({ kind: 'view', view: 'reflect', plotId: 'plot-w-sigplot' }, expect.anything());

        // a signal that maps to a dispute has nowhere to go: no button
        expect(screen.queryByTestId('attention-go-w-sigdispute')).toBeNull();
        expect(onGo.mock.calls.some(([t]) => t.kind === 'route' && t.route === 'compliance')).toBe(false);
        expect(screen.getByTestId('attention-page')).not.toHaveTextContent('अनुपालन सिग्नल पहा');
    });

    it('a worker (तुलना hidden) gets no button on a signal card that maps to तुलना', async () => {
        render(<AttentionPage onGo={vi.fn()} hiddenViews={['compare']} />);
        await waitFor(() => expect(screen.getByText('मराठी शीर्षक w-sigcompare')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-go-w-sigcompare')).toBeNull();
        expect(screen.getByTestId('attention-go-w-sigtest')).toBeInTheDocument();
    });
});

const CROPS = [{ id: 'grape', name: 'द्राक्ष', color: 'bg-purple-500', plots: [{ id: 'g1', name: 'सोनाका' }] }] as unknown as CropProfile[];
const t = (id: string, title: string, extra: Partial<PlannedTask> = {}): PlannedTask => ({
    id, title, plotId: 'g1', cropId: 'grape', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-10-20T05:00:00.000Z', ...extra,
});
const TASKS = [
    t('late', 'ठिबकची नळी तपासायची', { dueDate: '2026-10-24' }),
    t('today', 'फवारणी', { dueDate: '2026-10-26' }),
    t('done-late', 'बांधणी', { dueDate: '2026-10-20', status: 'done' }),
    t('nodate', 'खत आणायचं'),
];

const step = (id: string, activityName: string, daysLate: number, isMissed = false, plotName = 'सोनाका') => ({
    plannedActivityId: id, farmId: 'f1', plotId: 'g1', plotName, cropCycleId: 'cc1', activityName, stage: 'Flowering',
    plannedDate: `2026-10-${String(26 - daysLate).padStart(2, '0')}`, daysLate, isMissed,
});
const STEPS = [step('s-late', 'Foliar Spray', 1), step('s-today', 'Drip Irrigation', 0), step('s-missed', 'Pruning', 6, true)];
const withSteps = (items: unknown[] = STEPS) => { board.meta[SCHEDULED_WORK_META_KEY] = { items, asOfUtc: '2026-10-26T03:30:00.000Z' }; };
const groupText = (key: string) => screen.getByTestId(`attention-group-${key}`);
const rowIds = (key: string) => Array.from(groupText(key).querySelectorAll('[data-testid^="attention-step-"], [data-testid^="attention-reminder-"], [data-testid^="attention-card-"]'))
    .map(e => e.getAttribute('data-testid'));

describe('लक्ष द्या — founder D-1: three groups from one list (I22)', () => {
    it('late, today and decide groups, most urgent first; the step list replaces the late-work cards; a dispute never shows', async () => {
        withSteps();
        render(<AttentionPage onGo={vi.fn()} tasks={TASKS} crops={CROPS} onUpdateTask={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-group-decide')).toBeInTheDocument());

        expect(groupText('late')).toHaveTextContent('वेळ निघून गेली (2)');
        expect(rowIds('late')).toEqual(['attention-reminder-late', 'attention-step-s-late']); // 2 days late, then 1
        expect(groupText('today')).toHaveTextContent('आज करायचे (2)');
        expect(rowIds('today')).toEqual(['attention-step-s-today', 'attention-reminder-today']);
        expect(groupText('decide')).toHaveTextContent('निर्णय घ्यायचा');
        expect(rowIds('decide')[0]).toBe('attention-step-s-missed');
        // the overdue-count card is itemised by the steps now; the dispute stays in मंजुरी
        expect(screen.queryByTestId('attention-card-owed')).toBeNull();
        expect(screen.queryByTestId('attention-card-dispute')).toBeNull();
        expect(screen.getByTestId('attention-card-test')).toBeInTheDocument();

        // the schedule's English is said in Marathi, with when
        expect(screen.getByTestId('attention-step-s-late')).toHaveTextContent('फवारणी');
        expect(screen.getByTestId('attention-step-s-late')).toHaveTextContent('काल');
        expect(screen.getByTestId('attention-step-s-today')).toHaveTextContent('ठिबकने पाणी');
        expect(screen.getByTestId('attention-step-s-missed')).toHaveTextContent('6 दिवस उशीर');
        expect((screen.getByTestId('attention-page').textContent ?? '')).not.toMatch(/Foliar|Drip|Pruning/);
    });

    it('a server that sends no step list (older server): the late-work card keeps its place, nothing is guessed', async () => {
        render(<AttentionPage onGo={vi.fn()} />);
        await waitFor(() => expect(screen.getByTestId('attention-card-owed')).toBeInTheDocument());
        expect(screen.queryByTestId(/^attention-step-/)).toBeNull();
    });

    it('nothing at all: "सध्या लक्ष देण्यासारखे काही नाही." with when it is from — never a crop-health claim', async () => {
        board.cards = [];
        withSteps([]);
        render(<AttentionPage tasks={[]} />);
        await waitFor(() => expect(screen.getByTestId('attention-all-clear')).toHaveTextContent('सध्या लक्ष देण्यासारखे काही नाही.'));
        expect(screen.getByTestId('attention-as-of')).toBeInTheDocument();
        expect(screen.getByTestId('attention-page')).not.toHaveTextContent('व्यवस्थित');
    });

    it('while a late reminder is listed, there is no all-clear above it', async () => {
        board.cards = [];
        render(<AttentionPage tasks={TASKS} crops={CROPS} onUpdateTask={vi.fn()} />);
        await waitFor(() => expect(screen.queryByTestId('attention-loading')).toBeNull());
        expect(screen.queryByTestId('attention-all-clear')).toBeNull();
        expect(screen.getByTestId('attention-reminder-late')).toBeInTheDocument();
    });

    it('the farm on screen only: a step or a card of another farm is not listed', async () => {
        board.cards = [card('other', 'NeedsAttention', 'AssignTest', 'चाचण्या नियुक्त करा', { farmId: 'f2' }), card('mine', 'Watch', 'OpenPlot', 'तुकडा पहा')];
        withSteps([{ ...step('s-other', 'Foliar Spray', 1), farmId: 'f2' }, step('s-mine', 'Foliar Spray', 1)]);
        const { buildAttentionModel } = await import('../../attentionItems');
        const model = buildAttentionModel({
            cards: board.cards as AttentionCardCacheRecord[], scheduledWork: board.meta[SCHEDULED_WORK_META_KEY] as never,
            todos: { late: [], today: [] }, farmId: 'f1', todayKey: '2026-10-26',
        });
        expect([...model.late, ...model.decide].map(i => i.id)).toEqual(['step-s-mine', 'card-mine']);
    });
});

describe('लक्ष द्या — a reminder: झाले / वेळ बदला, in the one store करायची कामे uses (D-1, H15 / T3)', () => {
    it('झाले on लक्ष द्या clears it from करायची कामे too, and a tick there clears it here', async () => {
        const Both: React.FC = () => {
            const [tasks, setTasks] = useState<PlannedTask[]>(TASKS);
            const update = (task: PlannedTask) => setTasks(prev => prev.map(x => (x.id === task.id ? task : x)));
            const list = buildTodoList({ tasks, storeIds: new Set(tasks.map(x => x.id)), crops: CROPS, scope: { viewCrops: ['grape'], viewPlots: { grape: ['g1'] } }, wholeFarm: true, todayKey: '2026-10-26' });
            return (
                <>
                    <AttentionPage tasks={tasks} crops={CROPS} onUpdateTask={update} />
                    <div data-testid="todo-page"><TodoSection list={list} onToggle={item => update(toggledTask(item.task))} /></div>
                </>
            );
        };
        render(<Both />);
        const todoPage = () => screen.getByTestId('todo-page');
        expect(within(todoPage()).getByTestId('todo-group-late')).toHaveTextContent('ठिबकची नळी तपासायची');

        fireEvent.click(screen.getByTestId('attention-done-late'));
        expect(screen.queryByTestId('attention-reminder-late')).toBeNull();
        expect(within(todoPage()).queryByTestId('todo-group-late')).toBeNull();

        // re-open it in करायची कामे → back on लक्ष द्या; tick it there → gone here
        fireEvent.click(within(todoPage()).getByTestId('todo-done-toggle'));
        fireEvent.click(within(todoPage()).getByTestId('todo-tick-late'));
        expect(screen.getByTestId('attention-reminder-late')).toHaveTextContent('ठिबकची नळी तपासायची');
        fireEvent.click(within(within(todoPage()).getByTestId('todo-group-late')).getByTestId('todo-tick-late'));
        expect(screen.queryByTestId('attention-reminder-late')).toBeNull();
        await waitFor(() => expect(screen.queryByTestId('attention-loading')).toBeNull());
    });

    it('वेळ बदला moves the SAME task to the day he picks (उद्या), in the same store; nothing else changes', async () => {
        const onUpdateTask = vi.fn();
        render(<AttentionPage tasks={TASKS} crops={CROPS} onUpdateTask={onUpdateTask} />);
        fireEvent.click(screen.getByTestId('attention-move-late'));
        fireEvent.click(screen.getByTestId('attention-move-choices-late-tomorrow'));
        expect(onUpdateTask).toHaveBeenCalledWith({ ...TASKS[0], dueDate: '2026-10-27' });
        await waitFor(() => expect(screen.queryByTestId('attention-loading')).toBeNull());
    });

    it('"सगळी करायची कामं पाहा" opens the list', async () => {
        const onOpenTodos = vi.fn();
        render(<AttentionPage tasks={TASKS} crops={CROPS} onUpdateTask={vi.fn()} onOpenTodos={onOpenTodos} />);
        fireEvent.click(screen.getByTestId('attention-open-todos'));
        expect(onOpenTodos).toHaveBeenCalled();
        await waitFor(() => expect(screen.queryByTestId('attention-loading')).toBeNull());
    });
});

describe('लक्ष द्या — a scheduled step: काम नोंदवा / पुढे ठरवा (D-1)', () => {
    it('काम नोंदवा opens the recorder for THAT step and clears nothing', async () => {
        withSteps();
        const onRecordWork = vi.fn();
        render(<AttentionPage onRecordWork={onRecordWork} />);
        await waitFor(() => expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attention-record-s-late'));
        expect(onRecordWork).toHaveBeenCalledWith(expect.objectContaining({ plannedActivityId: 's-late', plotId: 'g1' }));
        expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument();
    });

    it('no "पुढे ठरवा" for a person the farm has not given planning to; no "काम नोंदवा" without a recorder (P5)', async () => {
        withSteps();
        render(<AttentionPage />);
        await waitFor(() => expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument());
        expect(screen.queryByTestId('attention-later-s-late')).toBeNull();
        expect(screen.queryByTestId('attention-record-s-late')).toBeNull();
    });

    it('पुढे ठरवा: the server keeps the new day (the existing override endpoint); once it says yes, the step leaves every view', async () => {
        withSteps();
        apiFetch.mockResolvedValue({ ok: true, status: 200 });
        render(<AttentionPage canReschedule />);
        await waitFor(() => expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attention-later-s-late'));
        fireEvent.click(screen.getByTestId('attention-later-choices-s-late-day_after'));
        await waitFor(() => expect(screen.queryByTestId('attention-step-s-late')).toBeNull());
        const [path, init] = apiFetch.mock.calls[0] as [string, RequestInit];
        expect(path).toBe('/shramsafal/planned-activities/s-late/override');
        expect(JSON.parse(String(init.body))).toEqual(expect.objectContaining({ farmId: 'f1', newPlannedDate: '2026-10-28', reason: expect.any(String) }));
        await waitFor(() => expect(triggerNow).toHaveBeenCalled()); // the server's own answer comes with the next pull
        expect(screen.getByTestId('attention-step-s-today')).toBeInTheDocument();
    });

    it('पुढे ठरवा that the server did not confirm: the step stays, and he is told', async () => {
        withSteps();
        apiFetch.mockResolvedValue({ ok: false, status: 503 });
        render(<AttentionPage canReschedule />);
        await waitFor(() => expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument());
        fireEvent.click(screen.getByTestId('attention-later-s-late'));
        fireEvent.click(screen.getByTestId('attention-later-choices-s-late-tomorrow'));
        await waitFor(() => expect(screen.getByTestId('attention-later-failed-s-late')).toBeInTheDocument());
        expect(screen.getByTestId('attention-step-s-late')).toBeInTheDocument();
    });
});
