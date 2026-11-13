/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane REM-1; founder D-79, R14; P3) - the phone's half of the leftover id pin.
 * `sync-contract/tests/fixtures/planned-work-leftover-ids.json` holds the vectors; the C# half is `PlannedWorkLeftoverIdsTests`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SPOKEN_TASK_NAMESPACE, jobTaskId, leftoverJobTaskId, leftoverTaskId, spokenTaskId } from '../data/plannedWorkIds';

interface Fixture {
    namespace: string;
    leftover: Array<{ logId: string; taskId: string; id: string }>;
    job: Array<{ logId: string; index: number; id: string }>;
}

const fixture = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../../../../sync-contract/tests/fixtures/planned-work-leftover-ids.json'), 'utf8')) as Fixture;

describe('the id of a leftover reminder (one fixture, the server and the phone)', () => {
    it('lives in the same namespace as every spoken reminder', () => {
        expect(fixture.namespace).toBe(SPOKEN_TASK_NAMESPACE);
    });

    it.each(fixture.leftover)('a log task %# gets the server\'s id', ({ logId, taskId, id }) => {
        expect(leftoverTaskId(logId, taskId)).toBe(id);
    });

    it.each(fixture.job)('an item of a confirmed voice parse %# gets the server\'s id', ({ logId, index, id }) => {
        expect(leftoverJobTaskId(logId, index)).toBe(id);
    });

    it('is the same every time and never shares an id with a spoken reminder of the same log', () => {
        const log = '0f1f0000-0000-4000-8000-000000000001';
        const task = '0f1f0000-0000-4000-8000-000000000002';
        expect(leftoverTaskId(log, task)).toBe(leftoverTaskId(log.toUpperCase(), task.toUpperCase()));
        expect(leftoverTaskId(log, task)).not.toBe(spokenTaskId(log, task));
        expect(leftoverJobTaskId(log, 0)).not.toBe(jobTaskId(log, 0));
        expect(leftoverTaskId(log, task)).not.toBe(leftoverTaskId(log, '0f1f0000-0000-4000-8000-000000000003'));
    });
});
