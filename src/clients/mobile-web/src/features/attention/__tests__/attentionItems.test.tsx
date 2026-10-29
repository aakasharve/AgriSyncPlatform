// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — ONE list behind लक्ष द्या, the bottom-bar
 * count and the आढावा strip: the groups, the count every surface shows (only items that are on the page, P4),
 * the strip's words (the founder's own example), and the rows the server sends being read, never guessed.
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import type { PlannedTask } from '../../../types';

const board = vi.hoisted(() => ({ cards: [] as unknown[], meta: {} as Record<string, unknown> }));
vi.mock('../../../infrastructure/storage/DexieDatabase', () => ({
    getDatabase: () => ({
        attentionCards: { orderBy: () => ({ toArray: async () => board.cards }) },
        syncCursors: { get: async () => ({ tableName: 'shramsafal', lastSyncAt: '2026-10-26T03:30:00.000Z', version: 1 }) },
        appMeta: { get: async (key: string) => (key in board.meta ? { key, value: board.meta[key] } : undefined) },
    }),
}));
vi.mock('../../../infrastructure/sync/BackgroundSyncWorker', () => ({ backgroundSyncWorker: { triggerNow: vi.fn() } }));

import { attentionSummaryMr, buildAttentionModel, mostUrgentLineMr } from '../attentionItems';
import { SCHEDULED_WORK_META_KEY, clearRescheduledForTests, markRescheduled, scheduledWorkItemOf, stepDueTextMr, stepLabelMr, storedScheduledWorkOf, type ScheduledWorkItem } from '../scheduledWork';
import { AttentionStrip } from '../components/AttentionStrip';
import { buildTodoList } from '../../reflect/overview/todoModel';

const TODAY = '2026-10-26';
const step = (id: string, activityName: string, daysLate: number, extra: Partial<ScheduledWorkItem> = {}): ScheduledWorkItem => ({
    plannedActivityId: id, farmId: 'f1', plotId: 'p1', plotName: 'प्लॉट 2', cropCycleId: 'cc1', activityName, stage: '',
    plannedDate: '2026-10-25', daysLate, isMissed: daysLate > 3, ...extra,
});
const task = (id: string, title: string, dueDate?: string, extra: Partial<PlannedTask> = {}): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending', sourceType: 'manual', createdAt: '2026-10-20T05:00:00.000Z', dueDate, ...extra,
});
const todosOf = (tasks: PlannedTask[]) => {
    const list = buildTodoList({ tasks, storeIds: new Set(tasks.map(t => t.id)), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: TODAY });
    return { late: list.late, today: list.today };
};
const card = (id: string, suggestedAction: string | number, extra: Partial<AttentionCardCacheRecord> = {}): AttentionCardCacheRecord => ({
    cardId: id, farmId: 'f1', farmName: 'शेत', plotId: 'p1', plotName: 'प्लॉट 2', rank: 1, computedAtUtc: '2026-10-26T03:30:00.000Z',
    titleEn: 'x', titleMr: `शीर्षक ${id}`, descriptionEn: 'x', descriptionMr: 'x', suggestedAction, suggestedActionLabelEn: 'x', suggestedActionLabelMr: 'x', ...extra,
});
const stored = (items: ScheduledWorkItem[], asOfUtc = '2026-10-26T03:30:00.000Z') => ({ items, asOfUtc });

beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-26T06:00:00.000Z'));
    board.cards = [];
    board.meta = {};
    clearRescheduledForTests();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('buildAttentionModel — the one list', () => {
    it('the founder\'s example: "2 कामे उशिराची · 1 आठवण आज", and the count is exactly the items listed', () => {
        const model = buildAttentionModel({
            cards: [], scheduledWork: stored([step('a', 'Foliar Spray', 1), step('b', 'Drip Irrigation', 2)]),
            todos: todosOf([task('r', 'पंप दुरुस्तीसाठी फोन करा', TODAY)]), farmId: 'f1', todayKey: TODAY,
        });
        expect(attentionSummaryMr(model.counts)).toBe('2 कामे उशिराची · 1 आठवण आज');
        expect(model.total).toBe(model.late.length + model.today.length + model.decide.length);
        expect(model.total).toBe(3);
        expect(mostUrgentLineMr(model)).toBe('ठिबकने पाणी · प्लॉट 2 — 2 दिवस उशीर');
    });

    it('a done reminder is not counted anywhere; a missed step asks for a decision', () => {
        const model = buildAttentionModel({
            cards: [], scheduledWork: stored([step('m', 'Pruning', 9)]),
            todos: todosOf([task('d', 'बांधणी', '2026-10-20', { status: 'done' })]), farmId: null, todayKey: TODAY,
        });
        expect(model.late).toHaveLength(0);
        expect(model.decide.map(i => i.id)).toEqual(['step-m']);
        expect(attentionSummaryMr(model.counts)).toBe('1 निर्णय बाकी');
    });

    it('disputes never; late-work cards only when the server sent no step list', () => {
        const cards = [card('dispute', 'ResolveDispute'), card('owed', 'ReviewOverdueTasks', { overdueTaskCount: 3 }),
            card('behind', 'OpenPlot', { overdueTaskCount: 1 }), card('test', 'AssignTest')];
        const known = buildAttentionModel({ cards, scheduledWork: stored([]), todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY });
        expect(known.decide.map(i => i.id)).toEqual(['card-test']);
        const unknown = buildAttentionModel({ cards, scheduledWork: null, todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY });
        expect(unknown.decide.map(i => i.id).sort()).toEqual(['card-behind', 'card-owed', 'card-test']);
    });

    it('a move the server confirmed hides the step until a NEWER list answers for itself', () => {
        markRescheduled('a', Date.parse('2026-10-26T05:00:00.000Z'));
        const at = (asOfUtc: string) => buildAttentionModel({
            cards: [], scheduledWork: stored([step('a', 'Foliar Spray', 1)], asOfUtc), todos: { late: [], today: [] }, farmId: 'f1', todayKey: TODAY,
        }).total;
        expect(at('2026-10-26T03:30:00.000Z')).toBe(0); // the list on the phone is older than the move
        expect(at('2026-10-26T05:30:00.000Z')).toBe(1); // a later pull still lists it: the server's word wins
    });
});

describe('scheduledWork — read, never guessed', () => {
    it('a whole row is read; a broken row is dropped, not repaired', () => {
        expect(scheduledWorkItemOf({ plannedActivityId: 'a', farmId: 'f', plotId: 'p', activityName: 'Spray', plannedDate: '2026-10-25T00:00:00', daysLate: 1, isMissed: false }))
            .toEqual(expect.objectContaining({ plannedDate: '2026-10-25', daysLate: 1 }));
        expect(scheduledWorkItemOf({ plannedActivityId: 'a', farmId: 'f', plotId: 'p', activityName: 'Spray', plannedDate: '2026-10-25', daysLate: -1 })).toBeNull();
        expect(scheduledWorkItemOf({ farmId: 'f' })).toBeNull();
        expect(storedScheduledWorkOf(undefined)).toBeNull();
        expect(storedScheduledWorkOf({ items: [{ nope: 1 }], asOfUtc: 'x' })).toEqual({ items: [], asOfUtc: 'x' });
    });

    it('the schedule\'s English is said in Marathi; an unknown name falls back to its kind of work', () => {
        expect(stepLabelMr({ activityName: 'Foliar Spray' })).toBe('फवारणी');
        expect(stepLabelMr({ activityName: 'Drip Irrigation #3' })).toBe('ठिबकने पाणी');
        expect(stepLabelMr({ activityName: 'Fungicide round B' })).toBe('फवारणी');
        expect(stepLabelMr({ activityName: 'Something new' })).toBe('काम');
        expect([0, 1, 4].map(stepDueTextMr)).toEqual(['आज', 'काल', '4 दिवस उशीर']);
    });
});

describe('AttentionStrip — लक्ष द्या\'s preview on आढावा', () => {
    it('the most urgent item and the count line; a tap opens लक्ष द्या', async () => {
        board.meta[SCHEDULED_WORK_META_KEY] = stored([step('a', 'Foliar Spray', 1), step('b', 'Foliar Spray', 1)]);
        const onOpen = vi.fn();
        render(<AttentionStrip tasks={[task('r', 'फोन करा', TODAY)]} crops={[]} onOpen={onOpen} />);
        await waitFor(() => expect(screen.getByTestId('attention-strip')).toBeInTheDocument());
        expect(screen.getByTestId('attention-strip-summary')).toHaveTextContent('2 कामे उशिराची · 1 आठवण आज');
        expect(screen.getByTestId('attention-strip-total')).toHaveTextContent('3');
        expect(screen.getByTestId('attention-strip-first')).toHaveTextContent('फवारणी · प्लॉट 2 — काल');
        fireEvent.click(screen.getByTestId('attention-strip'));
        expect(onOpen).toHaveBeenCalled();
    });

    it('nothing on the list: no strip at all (no unprovable "all fine" here)', async () => {
        board.meta[SCHEDULED_WORK_META_KEY] = stored([]);
        render(<AttentionStrip tasks={[]} crops={[]} onOpen={vi.fn()} />);
        await new Promise(r => setTimeout(r, 0));
        expect(screen.queryByTestId('attention-strip')).toBeNull();
    });
});
