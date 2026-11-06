/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Lane FX-1 — founder ATT-LOG (2026-10-31, register F81): what the log page's हजेरी card reads. The headcount is the
 * हजेरी rule itself ("No anchor → no mic", the SAME call the हजेरी route's gate makes); the work is what today's entries
 * say was done. Unknown stays unknown (P4), names are never counted into a number (P7).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DailyLog } from '../../../../../types';
import { LogVerificationStatus } from '../../../../../domain/types/log.types';
import { getDateKey } from '../../../../../core/domain/services/DateKeyService';
import { resolveLabourAnchor } from '../../../../labour/labourAnchor';
import { entryAttendance, todayAttendance, todaysLabourAnchor, workOf } from '../todayAttendance';

const TODAY = getDateKey();
const YESTERDAY = getDateKey(new Date(Date.now() - 86_400_000));
const SEL = { selection: [{ farmId: 'f1', cropId: 'grape', cropName: 'Grapes', selectedPlotIds: ['g1'], selectedPlotNames: ['G1'] }] };

let n = 0;
const log = (over: Partial<DailyLog> = {}): DailyLog => ({
    id: `L${++n}`, date: TODAY, context: SEL, dayOutcome: 'WORK_RECORDED',
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [],
    verification: { status: LogVerificationStatus.CONFIRMED },
    ...over,
} as unknown as DailyLog);
const weeding = { id: 'a1', title: 'Weeding', status: 'completed' } as DailyLog['cropActivities'][number];
const people = (count: number) => ({ id: `lab-${count}`, type: 'HIRED', count }) as DailyLog['labour'][number];

describe('ATT-LOG — today\'s work and headcount, each told or not', () => {
    it('nothing recorded today: neither is told (never 0 people)', () => {
        expect(todayAttendance([])).toEqual({ work: null, headcount: null, provisional: false });
        expect(todayAttendance([log({ date: YESTERDAY, cropActivities: [weeding], labour: [people(5)] })]))
            .toEqual({ work: null, headcount: null, provisional: false });
    });

    it('work told, no headcount: the work (with where), the count still missing', () => {
        const s = todayAttendance([log({ cropActivities: [weeding] })]);
        expect(s.work).toEqual({ names: ['Weeding'], parts: [], place: { cropId: 'grape', cropName: 'Grapes', plotNames: ['G1'] } });
        expect(s.headcount).toBeNull();
    });

    it('both told across two entries ("G1 ला खुरपणी केली", then "5 बायका होत्या"): N is the हजेरी rule\'s count', () => {
        const s = todayAttendance([log({ cropActivities: [weeding] }), log({ labour: [people(5)] })]);
        expect(s.work?.names).toEqual(['Weeding']);
        expect(s.headcount).toBe(5);
        expect(s.provisional).toBe(false);
    });

    it('several entries stating a count: exactly what the हजेरी screen does today (its own rule adds them)', () => {
        const day = [log({ cropActivities: [weeding], labour: [people(3)] }), log({ labour: [people(2)] })];
        const anchor = resolveLabourAnchor(day, TODAY);
        expect(anchor.state === 'anchored' && anchor.headcount).toBe(5);
        expect(todayAttendance(day).headcount).toBe(5);
    });

    it('names with no stated count are never counted into a number (P7): still not told', () => {
        const named = { id: 'lab-n', type: 'HIRED', workerNames: ['रमेश', 'सुनीता'] } as unknown as DailyLog['labour'][number];
        expect(todayAttendance([log({ cropActivities: [weeding], labour: [named] })]).headcount).toBeNull();
    });

    it('a count nobody has confirmed yet is carried as provisional (D-46), never shown as confirmed', () => {
        const s = todayAttendance([log({ cropActivities: [weeding], labour: [people(4)], verification: { status: LogVerificationStatus.DRAFT } as DailyLog['verification'] })]);
        expect(s).toMatchObject({ headcount: 4, provisional: true });
    });

    it('a deleted entry tells nothing', () => {
        expect(todayAttendance([log({ cropActivities: [weeding], labour: [people(5)], deletion: { deletedAt: 'x' } as unknown as DailyLog['deletion'] })]))
            .toEqual({ work: null, headcount: null, provisional: false });
    });

    it('a headcount told before any work: the count is told, the work is still missing', () => {
        expect(todayAttendance([log({ labour: [people(6)] })])).toMatchObject({ work: null, headcount: 6 });
    });
});

describe('ATT-LOG — what counts as work done', () => {
    it('a crop job still to do or missed is not work done; partial is', () => {
        expect(workOf([log({ cropActivities: [{ ...weeding, status: 'pending' }, { ...weeding, id: 'a2', status: 'gap_recorded' }] })])).toBeNull();
        expect(workOf([log({ cropActivities: [{ ...weeding, status: 'partial' }] })])?.names).toEqual(['Weeding']);
    });

    it('water, sprays / fertiliser and machines are work; so is a job named on a labour row; each name once', () => {
        const w = workOf([log({
            cropActivities: [weeding, { ...weeding, id: 'a2', title: 'weeding' }],
            irrigation: [{ id: 'i' }] as unknown as DailyLog['irrigation'],
            inputs: [{ id: 'p' }] as unknown as DailyLog['inputs'],
            machinery: [{ id: 'm' }] as unknown as DailyLog['machinery'],
            labour: [{ id: 'l', type: 'HIRED', activity: 'Pruning' } as DailyLog['labour'][number]],
        })]);
        expect(w?.names).toEqual(['Weeding', 'Pruning']);
        expect(w?.parts).toEqual(['irrigation', 'inputs', 'machinery']);
    });

    it('a crop job with no name is still work (its part), and work-type lists are read whole', () => {
        expect(workOf([log({ cropActivities: [{ id: 'x', title: '' } as DailyLog['cropActivities'][number]] })])?.parts).toEqual(['crop']);
        expect(workOf([log({ cropActivities: [{ id: 'x', title: 'Mixed', workTypes: ['Pruning', 'Weeding'] } as DailyLog['cropActivities'][number]] })])?.names)
            .toEqual(['Pruning', 'Weeding']);
    });

    it('a declared rest day, an observation, an expense or a plan alone is not work done', () => {
        expect(workOf([log({ dayOutcome: 'NO_WORK_PLANNED' as DailyLog['dayOutcome'] })])).toBeNull();
        expect(workOf([log({
            observations: [{ id: 'o' }] as unknown as DailyLog['observations'],
            activityExpenses: [{ id: 'e' }] as unknown as DailyLog['activityExpenses'],
            plannedTasks: [{ id: 't' }] as unknown as DailyLog['plannedTasks'],
        })])).toBeNull();
    });
});

describe('ATT-LOG — the result screen\'s card (this entry states work, no headcount)', () => {
    it('shown when this entry states work and neither it nor the day states a headcount', () => {
        const entry = log({ cropActivities: [weeding] });
        expect(entryAttendance([entry], [entry])).toMatchObject({ headcount: null, work: { names: ['Weeding'] } });
    });

    it('not shown when the entry states a headcount, when the day already has one, or when it states no work', () => {
        const withCount = log({ cropActivities: [weeding], labour: [people(5)] });
        expect(entryAttendance([withCount], [withCount])).toBeNull();
        const entry = log({ cropActivities: [weeding] });
        expect(entryAttendance([entry], [entry, log({ labour: [people(4)] })])).toBeNull();
        const noWork = log({ observations: [{ id: 'o' }] as unknown as DailyLog['observations'] });
        expect(entryAttendance([noWork], [noWork])).toBeNull();
    });

    it('not shown for an entry of another day (the card is about today\'s हजेरी)', () => {
        const old = log({ date: YESTERDAY, cropActivities: [weeding] });
        expect(entryAttendance([old], [old])).toBeNull();
    });
});

describe('ATT-LOG — ONE rule, two readers', () => {
    it('the हजेरी route\'s mic gate and the card make the same call', () => {
        const day = [log({ labour: [people(2)] })];
        expect(todaysLabourAnchor(day)).toEqual(resolveLabourAnchor(day, TODAY));
        const routes = readFileSync(resolve(process.cwd(), 'src/core/navigation/simpleRoutes.tsx'), 'utf-8');
        expect(routes).toContain("todaysLabourAnchor(ctx.history ?? []).state !== 'anchored'");
        expect(routes).not.toContain('resolveLabourAnchor(');
    });
});

describe('D-62 — a declared rest day is known from the day own stored log (dayOutcome NO_WORK_PLANNED)', () => {
    const rest = (over: Partial<DailyLog> = {}) => log({ dayOutcome: 'NO_WORK_PLANNED', ...over });

    it('today has a NO_WORK_PLANNED log and no work: restDay is true', () => {
        expect(todayAttendance([rest()])).toMatchObject({ restDay: true, work: null });
    });

    it('a paid rest day (people came, no work) is still a rest day', () => {
        expect(todayAttendance([rest({ labour: [people(3)] })])).toMatchObject({ restDay: true, work: null, headcount: 3 });
    });

    it('work recorded later the same day wins: not a rest day (my call)', () => {
        const s = todayAttendance([rest(), log({ cropActivities: [weeding] })]);
        expect(s.restDay).toBeFalsy();
        expect(s.work).not.toBeNull();
    });

    it('not today, or deleted, or a plain work day: not a rest day (field absent, so old shapes stay equal)', () => {
        expect(todayAttendance([rest({ date: YESTERDAY })])).toEqual({ work: null, headcount: null, provisional: false });
        expect(todayAttendance([rest({ deletion: { at: 'x' } } as unknown as Partial<DailyLog>)]).restDay).toBeFalsy();
        expect(todayAttendance([log({ cropActivities: [weeding] })]).restDay).toBeFalsy();
    });
});
