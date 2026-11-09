/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 2; founder D-78 = 1, P3) - the phone's half of the id pin.
 *
 * A spoken reminder is shown on this phone the moment he saves, under the id the SERVER will give it (a UUIDv5 of the log and the item),
 * so the pull replaces the mirror and never doubles it. One shared fixture of vectors pins both sides:
 * `sync-contract/tests/fixtures/planned-work-ids.json` (the C# half is `PlannedWorkIdsTests`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LEGACY_TODO_PREFIX, SPOKEN_TASK_NAMESPACE, jobTaskId, legacyTodoTaskId, spokenTaskId } from '../data/plannedWorkIds';

interface Fixture {
    namespace: string;
    spoken: Array<{ logId: string; itemId: string; id: string }>;
    job: Array<{ logId: string; index: number; id: string }>;
    legacyTodo: Array<{ oldId: string; id: string }>;
}

const fixture = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../../../../sync-contract/tests/fixtures/planned-work-ids.json'), 'utf8')) as Fixture;

describe('the ids of a spoken reminder (one fixture, the server and the phone)', () => {
    it('uses the fixture\'s namespace', () => {
        expect(SPOKEN_TASK_NAMESPACE).toBe(fixture.namespace);
    });

    it.each(fixture.spoken)('a content item %# gets the server\'s id', ({ logId, itemId, id }) => {
        expect(spokenTaskId(logId, itemId)).toBe(id);
    });

    it.each(fixture.job)('an item of a confirmed voice parse %# gets the server\'s id', ({ logId, index, id }) => {
        expect(jobTaskId(logId, index)).toBe(id);
    });

    it.each(fixture.legacyTodo)('an old local to-do %# gets one fixed id (the one-time upload)', ({ oldId, id }) => {
        expect(legacyTodoTaskId(oldId)).toBe(id);
        expect(legacyTodoTaskId(oldId)).toBe(legacyTodoTaskId(oldId));
        expect(LEGACY_TODO_PREFIX).toBe('legacy-todo:');
    });

    it('is the same every time, differs per log and per item, and never shares an id between a content item and a parse item', () => {
        const a = '0f1f0000-0000-4000-8000-000000000001';
        const b = '0f1f0000-0000-4000-8000-000000000002';
        expect(spokenTaskId(a, 't1')).toBe(spokenTaskId(a, 't1'));
        expect(spokenTaskId(a, 't1')).not.toBe(spokenTaskId(b, 't1'));
        expect(spokenTaskId(a, 't1')).not.toBe(spokenTaskId(a, 't2'));
        expect(spokenTaskId(a, '0')).not.toBe(jobTaskId(a, 0));
    });
});
