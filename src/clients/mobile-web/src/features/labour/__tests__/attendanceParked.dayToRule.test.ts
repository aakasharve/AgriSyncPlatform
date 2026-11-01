// @vitest-environment jsdom
/**
 * spec: plr-d10 lane PRV fix pass 3 (M-B) — a day the server names for his ruling is answered through the EXISTING ruling
 * (an attendance.mark carrying the chosen record's fact and `resolvedLabourAssignmentId`, which the server takes as the
 * answer to the question), and is not asked again while that answer is on its way. Real queue, fake-indexeddb.
 */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabase } from '../../../infrastructure/storage/DexieDatabase';
import { SyncMutationName } from '../../../infrastructure/sync/SyncMutationCatalog';
import { answerDayToRule, dayToRulePark, isDayToRule, listAnsweredDaysToRule } from '../data/attendanceParked';

const FARM = 'aaaaaaaa-0000-4000-8000-00000000000a';
const DAY = { fieldOperatorId: 'bbbbbbbb-0000-4000-8000-00000000000b', workDate: '2026-10-30' };
const CREW = 'cccccccc-0000-4000-8000-00000000000c';

beforeEach(async () => {
    await getDatabase().open();
    await Promise.all(getDatabase().tables.map(t => t.clear()));
});

describe('the ruling of a day the server names', () => {
    it('is sent as the answer to the question, and the day is not asked again while it is on its way', async () => {
        const park = dayToRulePark(FARM, DAY);
        expect(isDayToRule(park)).toBe(true);
        expect(await listAnsweredDaysToRule(FARM)).toEqual(new Set());

        await answerDayToRule(park, { shift: 'half', labourAssignmentId: CREW });

        const rows = (await getDatabase().mutationQueue.toArray()).filter(r => r.mutationType === SyncMutationName.AttendanceMark);
        expect(rows.map(r => r.payload)).toEqual([expect.objectContaining({
            farmId: FARM, ...DAY, dayMark: 'Half', resolvedLabourAssignmentId: CREW,
        })]);
        expect(await listAnsweredDaysToRule(FARM)).toEqual(new Set([`${DAY.fieldOperatorId}:${DAY.workDate}`]));
        expect(await listAnsweredDaysToRule('another-farm')).toEqual(new Set());
    });
});
