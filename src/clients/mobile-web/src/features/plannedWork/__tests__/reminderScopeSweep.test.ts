/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 Task 5; founder D-84 = 1, D-24e1, D-26; MU-3 "what you may no longer see leaves your phone",
 * L8c-3 lesson: anything the phone must stop showing needs the scope sweep) - the phone's removal sweep (`visiblePlotIds`) must not take away a reminder the
 * SERVER sent under the owner's settings (the plot team, a marked maker), and must still take away what the reader's place no longer covers:
 *   - a reminder the server names a category for is kept for a seat on every plot, and for a chosen-plots seat only with one of his plots (or the plot of its record);
 *   - never for a seat on his own work, never for work given to someone else, never on an older server that names no category (the old rule, unchanged);
 *   - a change of the settings reaches the phone as a withdrawn record, which removes it (the existing reconciler), so nothing here guesses the settings.
 */
import { describe, expect, it } from 'vitest';
import { visiblePlotIds } from '../../sync/pull/reconcilers/plannedWorkReconciler';
import type { PlannedWorkRow } from '../../../infrastructure/storage/plannedWorkRow';

const ME = '22222222-2222-4222-8222-222222222222';
const RAJU = '33333333-3333-4333-8333-333333333333';
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';

const row = (over: Partial<PlannedWorkRow> = {}): PlannedWorkRow => ({
    id: 't1', farmId: 'f1', title: 'पाईप बघायचा', scope: 'Plot', plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
    expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', source: 'VoiceLog', sourceKind: 'Spoken', sourceDailyLogId: 'log-1',
    sourceLogTaskId: null, sourcePlotId: A, recordedOn: '2026-11-08', linkedDailyLogIds: [], createdByUserId: RAJU, createdAtUtc: 'x', modifiedAtUtc: 'x',
    seenAtUtc: null, acceptedAtUtc: null, doneAtUtc: null, doneByUserId: null, cancelledAtUtc: null, cancelledByUserId: null, cancelReason: null,
    plots: [{ plotId: A, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }], category: 'FromLogs', ...over,
});

const all = { farmId: 'f1', seeAllTasks: false, plotScope: 'AllPlots' } as never;
const chosen = (...ids: string[]) => ({ farmId: 'f1', seeAllTasks: false, plotScope: 'ChosenPlots', plotIds: ids }) as never;
const own = { farmId: 'f1', seeAllTasks: false, plotScope: 'OwnWork' } as never;

describe('a reminder the server sent under the owner\'s settings stays while its place is his', () => {
    it('a seat on every plot keeps it', () => {
        expect(visiblePlotIds(row(), ME, all)).toEqual([A]);
    });

    it('a chosen-plots seat keeps it only with one of his plots, and only those rows', () => {
        expect(visiblePlotIds(row(), ME, chosen(A))).toEqual([A]);
        expect(visiblePlotIds(row(), ME, chosen(B))).toBeNull();
        const both = row({ plots: [{ plotId: A, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }, { plotId: B, status: 'Pending', doneAtUtc: null, doneByUserId: null, linkedDailyLogIds: [] }] });
        expect(visiblePlotIds(both, ME, chosen(B))).toEqual([B]);
    });

    it('a reminder with no plot row takes the plot of its record; with none it is the whole farm\'s (a chosen-plots seat does not keep it)', () => {
        const spoken = row({ scope: 'Unspecified', plots: [] });
        expect(visiblePlotIds(spoken, ME, chosen(A))).toEqual([]);
        expect(visiblePlotIds(spoken, ME, chosen(B))).toBeNull();
        const wholeFarm = row({ scope: 'Farm', plots: [], sourcePlotId: null });
        expect(visiblePlotIds(wholeFarm, ME, all)).toEqual([]);
        expect(visiblePlotIds(wholeFarm, ME, chosen(A))).toBeNull();
    });

    it('never for a seat on his own work', () => {
        expect(visiblePlotIds(row(), ME, own)).toBeNull();
    });

    it('never for work given to someone else (an assignment is not a reminder), and the assignee keeps his own', () => {
        const given = row({ assigneeUserId: '44444444-4444-4444-8444-444444444444' });
        expect(visiblePlotIds(given, ME, all)).toBeNull();
        expect(visiblePlotIds({ ...given, assigneeUserId: ME }, ME, all)).toEqual([A]);
    });

    it('an older server names no category: the old rule, unchanged (removed unless the base shows it)', () => {
        const old = row({ category: null });
        expect(visiblePlotIds(old, ME, all)).toBeNull();
        expect(visiblePlotIds(old, ME, { ...(all as object), seeAllTasks: true } as never)).toEqual([A]);
    });

    it('his own reminder and the base are untouched', () => {
        expect(visiblePlotIds(row({ createdByUserId: ME, category: null }), ME, chosen(B))).toEqual([A]);
    });
});
