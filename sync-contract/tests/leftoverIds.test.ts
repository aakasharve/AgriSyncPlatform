// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-79, R14; P3). The vectors of the leftover reminder id
// (sync-contract/tests/fixtures/planned-work-leftover-ids.json) are well formed and live in the SAME namespace as the spoken-reminder ids
// (planned-work-ids.json), so no new namespace is ever introduced. The two sides pin themselves to it: the server in
// PlannedWorkLeftoverIdsTests (C#), the phone in plannedWorkLeftoverIds.test.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(join(here, 'fixtures', name), 'utf8'));

describe('planned-work-leftover-ids.json', () => {
  const leftover = read('planned-work-leftover-ids.json');
  const spoken = read('planned-work-ids.json');
  const uuidV5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('lives in the namespace every spoken reminder lives in', () => {
    expect(leftover.namespace).toBe(spoken.namespace);
  });

  it('every id is a version 5 id, the same logId in any case gives the same id, and no id repeats', () => {
    const ids = [...leftover.leftover, ...leftover.job].map((v: { id: string }) => v.id);
    for (const id of ids) expect(id).toMatch(uuidV5);
    expect(new Set(ids).size).toBe(ids.length - 1); // the upper-case twin of the third vector is the same id on purpose
    const [, , third, fourth] = leftover.leftover;
    expect(fourth.id).toBe(third.id);
    expect(fourth.logId).toBe(third.logId.toUpperCase());
  });

  it('never shares an id with a spoken-reminder vector', () => {
    const spokenIds = new Set([...spoken.spoken, ...spoken.job].map((v: { id: string }) => v.id));
    for (const v of [...leftover.leftover, ...leftover.job]) expect(spokenIds.has(v.id)).toBe(false);
  });
});
