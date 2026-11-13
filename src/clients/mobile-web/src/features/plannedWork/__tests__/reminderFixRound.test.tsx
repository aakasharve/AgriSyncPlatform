// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 FIX ROUND; review M1, M4, m4, m6; doctrine: one language at a time, no emoji):
 *   - M4: a left-over reminder's title is the work's own word as the server kept it (the parser's English work type, e.g. "Spraying"); the card shows it
 *     through the app's own work-name map (फवारणी in Marathi mode, Spraying in English mode) at display time; a word the map does not know is never
 *     shown in the other language (the card says the left-over word instead); a reminder he said himself is shown as he said it;
 *   - m4: the pending removal is sent when the app is hidden or closed (visibilitychange to hidden, pagehide), not only when the page is left;
 *   - m6: no emoji on the late group's title;
 *   - M1: a reminder the server withdraws from this phone (given to someone else, moved off his plots, a setting changed) is removed even though the
 *     phone's own scope sweep would have kept the stale widened copy.
 */
import 'fake-indexeddb/auto';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { PlannedTask } from '../../../types';
import { reconcileSyncPull } from '../../sync/pull/SyncPullReconciler';
import { getDatabase, resetDatabase } from '../../../infrastructure/storage/DexieDatabase';
import type { SyncPullResponse } from '../../../infrastructure/api/AgriSyncClient';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';

const h = vi.hoisted(() => ({ language: 'mr' as 'mr' | 'en' }));
vi.mock('../../../i18n/LanguageContext', () => ({
    useLanguage: () => ({ language: h.language, setLanguage: () => {}, t: (k: string) => k }),
    useOptionalLanguage: () => ({ language: h.language }),
}));
vi.mock('../../../infrastructure/storage/AuthTokenStore', async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    getAuthSession: () => ({ accessToken: 'test-token', userId: '22222222-2222-4222-8222-222222222222' }),
}));
vi.mock('../../logs/components/originalVoice/OriginalVoiceButton', () => ({
    default: () => <button type="button">play</button>,
}));

import { TodoSection } from '../../reflect/overview/TodoSection';
import { buildTodoList, tickableIds } from '../../reflect/overview/todoModel';
import { reminderTitleIn } from '../reminders/reminderModel';
import { plannedWorkWords } from '../plannedWorkWords';

afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => { h.language = 'mr'; });

type Reminder = NonNullable<NonNullable<PlannedTask['listSource']>['reminder']>;
const reminder = (over: Partial<Reminder> = {}): Reminder => ({
    category: 'FromLogs', kind: 'Leftover', createdByUserId: 'u-raju', createdByName: 'राजू', createdAtUtc: '2026-11-08T05:45:00.000Z',
    sourceDailyLogId: null, mayPlayVoice: null, wordsWithheld: false, makerAlwaysShown: false, fromChosenPeopleRecord: false, ...over,
});
const task = (id: string, title: string, r: Reminder, over: Partial<PlannedTask> = {}): PlannedTask => ({
    id, title, plotId: 'FARM_GLOBAL', cropId: 'FARM_GLOBAL', priority: 'normal', status: 'pending',
    sourceType: r.kind === 'Spoken' ? 'ai_extracted' : 'observation_derived', createdAt: '2026-11-08',
    listSource: { scope: 'Unspecified', tickable: true, keptOnPhone: false, farmId: '55555555-5555-4555-8555-555555555551', reminder: r }, ...over,
} as PlannedTask);

const draw = (tasks: PlannedTask[], onRemove = vi.fn()) => {
    const list = buildTodoList({ tasks, storeIds: tickableIds(tasks), crops: [], scope: { viewCrops: [], viewPlots: {} }, wholeFarm: true, todayKey: '2026-11-08' });
    render(<TodoSection list={list} onToggle={vi.fn()} onRemove={onRemove} />);
    return onRemove;
};

describe('M4 - a left-over reminder shows the work in the language of the screen', () => {
    it('the parser\'s English work type reads as the app\'s Marathi word in Marathi mode, and back again in English mode', () => {
        const english = task('t-left', 'Spraying', reminder());
        expect(reminderTitleIn(english, 'mr')).toBe('फवारणी');
        expect(reminderTitleIn(task('t2', 'फवारणी', reminder()), 'en')).toBe('Spraying');
        expect(reminderTitleIn(english, 'en')).toBe('Spraying');
    });

    it('a work word the map does not know is never shown in the other language: the card says the left-over word instead', () => {
        const unknown = task('t3', 'Vine tonic round', reminder());
        expect(reminderTitleIn(unknown, 'mr')).toBe(plannedWorkWords('mr').reminders.leftover);
        expect(reminderTitleIn(task('t4', 'द्राक्षाला टॉनिक', reminder()), 'en')).toBe(plannedWorkWords('en').reminders.leftover);
        // A word already in the screen's own language is his, shown as it is.
        expect(reminderTitleIn(task('t5', 'द्राक्षाला टॉनिक', reminder()), 'mr')).toBe('द्राक्षाला टॉनिक');
    });

    it('a reminder he said himself, and anything that is not a left-over, is shown exactly as kept', () => {
        expect(reminderTitleIn(task('t6', 'Check the pipe', reminder({ kind: 'Spoken' })), 'mr')).toBe('Check the pipe');
        expect(reminderTitleIn(task('t7', 'Spraying', reminder({ kind: 'Typed' })), 'mr')).toBe('Spraying');
    });

    it('the card on करायची कामे draws it so (Marathi mode has no Latin word on the title)', () => {
        draw([task('t-left', 'Spraying', reminder())]);
        const row = screen.getByTestId('todo-row-t-left');
        expect(row).toHaveTextContent('फवारणी');
        expect(row.querySelector('p')?.textContent).not.toMatch(/[A-Za-z]/);
    });

    it('English mode draws the English word', () => {
        h.language = 'en';
        draw([task('t-left', 'फवारणी', reminder())]);
        expect(screen.getByTestId('todo-row-t-left').querySelector('p')?.textContent).toBe('Spraying');
    });
});

describe('m4 - a pending removal is sent when the app goes to the background or closes', () => {
    const lateTask = task('t-left', 'फवारणी', reminder());

    it('visibilitychange to hidden sends it now, once', () => {
        vi.useFakeTimers();
        const onRemove = draw([lateTask]);
        fireEvent.click(screen.getByTestId('todo-remove-t-left'));
        expect(onRemove).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(onRemove).toHaveBeenCalledTimes(1);
        cleanup();
        expect(onRemove).toHaveBeenCalledTimes(1);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    });

    it('pagehide sends it now, once', () => {
        vi.useFakeTimers();
        const onRemove = draw([lateTask]);
        fireEvent.click(screen.getByTestId('todo-remove-t-left'));
        act(() => { window.dispatchEvent(new Event('pagehide')); });
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onRemove.mock.calls[0][0].id).toBe('t-left');
        act(() => { vi.advanceTimersByTime(10000); });
        expect(onRemove).toHaveBeenCalledTimes(1);
    });

    it('becoming visible again sends nothing, and nothing pending sends nothing', () => {
        const onRemove = draw([lateTask]);
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
        act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
        expect(onRemove).not.toHaveBeenCalled();
    });
});

describe('m6 - no emoji on the screen of the list', () => {
    it('the late group has words only', () => {
        const late = task('t-late', 'फवारणी', reminder(), { dueDate: '2026-11-01' });
        draw([late]);
        const group = screen.getByTestId('todo-group-late');
        expect(group.textContent).toContain('वेळ उलटून गेली');
        expect(group.textContent).not.toMatch(/[☀-➿⏩-⏿\u{1F300}-\u{1FAFF}]/u);
    });
});

// ── M1: the server's withdrawn word removes a stale widened copy ────────────────────────────────────────────────────────

const FARM = '55555555-5555-4555-8555-555555555551';
const RAJU = '11111111-1111-4111-8111-111111111111';
const T1 = '33333333-3333-4333-8333-333333333331';
const PLOT = '44444444-4444-4444-8444-444444444441';

const widened = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: T1, farmId: FARM, title: 'पाईप बघायचा', scope: 'Plot', plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
    expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'Planning', sourceKind: 'Typed', recordedOn: '2026-11-08',
    linkedDailyLogIds: [], createdByUserId: RAJU, createdAtUtc: '2026-11-08T06:00:00.000Z', modifiedAtUtc: '2026-11-08T06:00:00.000Z',
    plots: [{ plotId: PLOT, status: 'Pending', linkedDailyLogIds: [] }], category: 'FromPlanning', ...over,
});

const pull = (over: Partial<SyncPullResponse> = {}): SyncPullResponse => ({
    serverTimeUtc: '2026-11-08T07:00:00.000Z', nextCursorUtc: '2026-11-08T07:00:00.000Z',
    farms: [], plots: [], cropCycles: [], dailyLogs: [], attachments: [], costEntries: [], financeCorrections: [], dayLedgers: [],
    priceConfigs: [], plannedActivities: [], auditEvents: [], operators: [], scheduleTemplates: [], activityCategories: [],
    costCategories: [], referenceDataVersionHash: 'h',
    accessScopes: [{ farmId: FARM, ownRecordsOnly: false, seeMoney: false, seeWages: false, seeAllTasks: false, plotScope: 'AllPlots' }],
    ...over,
} as SyncPullResponse);

describe('M1 - the withdrawn word removes the stale copy of a reminder that left the widening', () => {
    beforeEach(async () => {
        await resetDatabase();
        const db = getDatabase();
        await Promise.all([db.plannedWork.clear(), db.mutationQueue.clear(), db.appMeta.clear()]);
    });

    it('the phone\'s own sweep keeps a widened reminder it still thinks is his; the server\'s withdrawn entry removes it (given away, or moved off his plots)', async () => {
        await reconcileSyncPull(pull({ plannedWork: [widened()] }));
        expect(await getDatabase().plannedWork.get(T1)).toBeDefined();

        // A later pull carries the task no more (it is assigned work of someone else now) but names it: content-free, kind PlannedWork.
        await reconcileSyncPull(pull({ withdrawnRecords: [{ kind: 'PlannedWork', id: T1 }] }));
        expect(await getDatabase().plannedWork.get(T1)).toBeUndefined();
    });

    it('without the word the stale copy stays (the sweep reads the phone\'s own old row): the server\'s word is what removes it', async () => {
        await reconcileSyncPull(pull({ plannedWork: [widened()] }));
        await reconcileSyncPull(pull());
        expect(await getDatabase().plannedWork.get(T1)).toBeDefined();
    });
});
