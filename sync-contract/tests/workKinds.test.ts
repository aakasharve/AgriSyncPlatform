// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM; founder 27 Nov, CTO ruling Q2) - the kinds of work the farm's owner may limit a
// person to recording live in ONE file, schemas/work-kinds.json: the record's own bucket names (one vocabulary with the record, never a second list).
// Six can be limited (पीक काम, पाणी, औषध / खत, मजूर, यंत्र, खर्च); observations and reminders are always open. The server's WorkKinds and the phone's
// constant are pinned to this file by their own parity tests.
import { describe, expect, it } from 'vitest';
import kinds from '../schemas/work-kinds.json';
import { LOG_CONTENT_BUCKETS } from '../schemas/payloads/_log_content.zod';

describe('work-kinds.json', () => {
    it('is version 1 with exactly the limitable and always-open lists', () => {
        expect(Object.keys(kinds).sort()).toEqual(['alwaysOpen', 'limitable', 'version']);
        expect(kinds.version).toBe(1);
        expect(kinds.limitable).toEqual(['cropActivities', 'irrigation', 'inputs', 'labour', 'machinery', 'activityExpenses']);
        expect(kinds.alwaysOpen).toEqual(['observations', 'plannedTasks']);
    });

    it('has no name twice and no name in both lists', () => {
        const all = [...kinds.limitable, ...kinds.alwaysOpen];
        expect(new Set(all).size).toBe(all.length);
    });

    it('names every bucket of the record content exactly once, plus labour (its own list on the record)', () => {
        const contentBuckets: string[] = [...LOG_CONTENT_BUCKETS];
        expect([...kinds.limitable, ...kinds.alwaysOpen].filter((k) => k !== 'labour').sort()).toEqual(contentBuckets.sort());
    });
});
