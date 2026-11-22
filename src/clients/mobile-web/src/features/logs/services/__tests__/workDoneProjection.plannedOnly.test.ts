/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-PARSE-FIX) - a future task is not work done.
 *
 * The founder's real log (TEST stack, 2026-11-20 23:08) said "आज घड बांधायचं काम झालं आणि शेंडा मारला ... खुरपणी पण करायची आहे": the
 * tying and topping are done, the weeding is still to be done. The model stored both as crop activities; the server now tags the
 * second one `plannedOnly`. These two activities are his REAL stored rows. The tagged one stays in the log with his words; it is just
 * not a "work done" row, and not a done-work task line.
 */
import { describe, expect, it } from 'vitest';
import type { CropActivityEvent } from '../../../../types';
import { buildWorkDoneProjection, buildWorkDoneTitles, isPlannedOnly } from '../workDoneProjection';
import { buildTaskPayloads } from '../logTaskPayloads';
import { deriveVisibleBucketsFromParseResult } from '../bucketDerivation';
import { AgriLogResponseSchema } from '../../../../domain/ai/contracts/AgriLogResponseSchema';
import type { DailyLog } from '../../../../types';

const tying: CropActivityEvent = {
    id: 'a1',
    title: 'घड बांधणी आणि शेंडा मारणे',
    workTypes: ['Trellising', 'Topping'],
    sourceText: 'आज घड बांधायचं काम झालं आणि शेंडा मारला',
};

const weedingStillToDo: CropActivityEvent = {
    id: 'a2',
    title: 'खुरपणी',
    workTypes: ['Weeding'],
    status: 'pending',
    plannedOnly: true,
    sourceText: 'खुरपणी पण करायची आहे',
};

describe('lane AI-PARSE-FIX - a crop activity tagged plannedOnly is not work done', () => {
    it('isPlannedOnly is true only for the explicit tag (an older parse has no key and is never coerced)', () => {
        expect(isPlannedOnly(weedingStillToDo)).toBe(true);
        expect(isPlannedOnly(tying)).toBe(false);
        expect(isPlannedOnly({ ...tying, plannedOnly: false })).toBe(false);
    });

    it('the work-done rows list the tying and topping and not the weeding still to be done', () => {
        const rows = buildWorkDoneProjection({ cropActivities: [tying, weedingStillToDo] });

        expect(rows.map(r => r.title)).toEqual(['Trellising']);
        expect(buildWorkDoneTitles([{ cropActivities: [tying, weedingStillToDo] }])).toEqual(['Trellising']);
    });

    it('a day with only a future task has no work-done rows', () => {
        expect(buildWorkDoneProjection({ cropActivities: [weedingStillToDo] })).toEqual([]);
    });

    it('the phone writes no done-work task line for the future task (mirror of the server LogTaskProjection)', () => {
        const log = {
            id: 'log-1',
            date: '2026-11-20',
            cropActivities: [tying, weedingStillToDo],
            irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [], plannedTasks: [],
            meta: { createdAtISO: '2026-11-20T17:38:00.000Z' },
        } as unknown as DailyLog;

        expect(buildTaskPayloads(log).map(t => t.activityType)).toEqual(['Trellising']);
    });

    it('the tag survives the response schema (an extra key on a nested event passes through, the declared one is typed)', () => {
        const parsed = AgriLogResponseSchema.safeParse({
            summary: '',
            dayOutcome: 'WORK_RECORDED',
            cropActivities: [tying, weedingStillToDo],
            irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [],
            missingSegments: [],
        });

        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.cropActivities[1]?.plannedOnly).toBe(true);
            expect(parsed.data.cropActivities[0]?.plannedOnly).toBeUndefined();
        }
    });

    it('the visible buckets do not show "work done" for a day with only a future task', () => {
        const empty = { irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [], plannedTasks: [] };
        const futureOnly = { ...empty, cropActivities: [weedingStillToDo] } as unknown as Parameters<typeof deriveVisibleBucketsFromParseResult>[0];
        const withDoneWork = { ...empty, cropActivities: [tying, weedingStillToDo] } as unknown as Parameters<typeof deriveVisibleBucketsFromParseResult>[0];

        expect(deriveVisibleBucketsFromParseResult(futureOnly)).not.toContain('workDone');
        expect(deriveVisibleBucketsFromParseResult(withDoneWork)).toContain('workDone');
    });
});
