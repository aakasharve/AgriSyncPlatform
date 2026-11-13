/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1 Task 5; founder D-78, D-84 = 1; P4, P11) - the additive fields of a reminder on the pull
 * reach the card and nothing else: the row keeps what the server said (maker's name, source, the voice and money answers, the two D-84 = 1 facts); an
 * older server that sends none leaves each as "not told" (never "no" and never a guess); a word it does not know is dropped; and the list view
 * (`plannedWorkAsTasks`) carries them to the card, with the source read from the door's own words when the server did not say it.
 */
import { describe, expect, it } from 'vitest';
import { plannedWorkRowFromDto } from '../../sync/pull/reconcilers/plannedWorkReconciler';
import type { PlannedWorkDto } from '../../../infrastructure/api/plannedWorkDtos';
import { plannedWorkAsTasks } from '../data/plannedWorkAsTasks';
import type { LocalPlannedWork } from '../data/plannedWorkStore';

const ME = '22222222-2222-4222-8222-222222222222';

const dto = (over: Partial<PlannedWorkDto> = {}): PlannedWorkDto => ({
    id: 't1', farmId: 'f1', title: 'पाईप बघायचा', scope: 'Unspecified', status: 'Open', source: 'VoiceLog', sourceKind: 'Spoken', recordedOn: '2026-11-08',
    sourceDailyLogId: 'log-1', createdByUserId: ME, createdAtUtc: '2026-11-08T05:45:00.000Z', modifiedAtUtc: '2026-11-08T05:45:01.000Z', plots: [], ...over,
});

describe('the pull row', () => {
    it('keeps what the server said about who made it and where it comes from', () => {
        const row = plannedWorkRowFromDto(dto({
            createdByName: 'राजू', category: 'FromLogs', mayPlayVoice: true, wordsWithheld: false, makerAlwaysShown: true, fromChosenPeopleRecord: false,
        }))!;
        expect(row.createdByName).toBe('राजू');
        expect(row.category).toBe('FromLogs');
        expect(row.mayPlayVoice).toBe(true);
        expect(row.wordsWithheld).toBe(false);
        expect(row.makerAlwaysShown).toBe(true);
        expect(row.fromChosenPeopleRecord).toBe(false);
        expect(row.createdAtUtc).toBe('2026-11-08T05:45:00.000Z');
    });

    it('an older server sends none: every one is "not told", never "no" (P11, P4)', () => {
        const row = plannedWorkRowFromDto(dto())!;
        expect(row.createdByName).toBeNull();
        expect(row.category).toBeNull();
        expect(row.mayPlayVoice).toBeNull();
        expect(row.wordsWithheld).toBeNull();
        expect(row.makerAlwaysShown).toBeNull();
        expect(row.fromChosenPeopleRecord).toBeNull();
    });

    it('a category it does not know, an empty name and a flag that is not a flag are dropped', () => {
        const row = plannedWorkRowFromDto(dto({ createdByName: '', category: 'FromElsewhere', mayPlayVoice: 'yes' as unknown as boolean }))!;
        expect(row.createdByName).toBeNull();
        expect(row.category).toBeNull();
        expect(row.mayPlayVoice).toBeNull();
    });
});

const local = (over: Partial<LocalPlannedWork> = {}): LocalPlannedWork => ({
    id: 't1', farmId: 'f1', title: 'पाईप बघायचा', scope: 'Unspecified', plotIds: [], plannedDate: null, looseWhen: null, plannedTime: null, assigneeUserId: null, crewText: null,
    expectedHeadcount: null, quantityText: null, payMode: null, note: null, status: 'Open', sourceKind: 'Spoken', sourcePlotId: null, sourceDailyLogId: 'log-1',
    recordedOn: '2026-11-08', createdByUserId: ME, modifiedAtUtc: '2026-11-08T05:45:01.000Z', source: 'server', keptOnPhone: false, pendingSteps: [], refused: false, plots: [],
    confirmationState: null, createdAtUtc: '2026-11-08T05:45:00.000Z', createdByName: 'राजू', category: 'FromLogs', mayPlayVoice: false, wordsWithheld: false,
    makerAlwaysShown: false, fromChosenPeopleRecord: true, ...over,
});

describe('the list view carries them to the card', () => {
    it('as listSource.reminder, with the voice answer as the server gave it', () => {
        const [task] = plannedWorkAsTasks([local()], ME);
        expect(task.listSource!.reminder).toEqual({
            category: 'FromLogs', kind: 'Spoken', createdByUserId: ME, createdByName: 'राजू', createdAtUtc: '2026-11-08T05:45:00.000Z', sourceDailyLogId: 'log-1',
            mayPlayVoice: false, wordsWithheld: false, makerAlwaysShown: false, fromChosenPeopleRecord: true,
        });
        expect(plannedWorkAsTasks([local({ mayPlayVoice: null })], ME)[0].listSource!.reminder!.mayPlayVoice).toBeNull();
    });

    it('with no category from the server, the door\'s own words say it: spoken and left over are records, the rest is planning', () => {
        const cat = (sourceKind: LocalPlannedWork['sourceKind']) => plannedWorkAsTasks([local({ category: null, sourceKind })], ME)[0].listSource!.reminder!.category;
        expect(cat('Spoken')).toBe('FromLogs');
        expect(cat('Leftover')).toBe('FromLogs');
        expect(cat('Typed')).toBe('FromPlanning');
        expect(cat('PlanForm')).toBe('FromPlanning');
        expect(cat(null)).toBe('FromPlanning');
    });

    it('a reminder made on this phone and not yet answered claims nothing the server did not say', () => {
        const [task] = plannedWorkAsTasks([local({ source: 'queue', keptOnPhone: true, createdAtUtc: undefined, createdByName: undefined, category: undefined, mayPlayVoice: undefined, wordsWithheld: undefined, makerAlwaysShown: undefined, fromChosenPeopleRecord: undefined })], ME);
        const r = task.listSource!.reminder!;
        expect(r.createdByName).toBeNull();
        expect(r.createdAtUtc).toBeNull();
        expect(r.mayPlayVoice).toBeNull();
        expect(r.makerAlwaysShown).toBe(false);
        expect(r.fromChosenPeopleRecord).toBe(false);
        expect(r.wordsWithheld).toBe(false);
    });
});
