/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1) — C# ↔ TS TASK-LINE PARITY, the TS half.
 *
 * A phone that sends `content` sends no `add_log_task`: the SERVER writes the task lines from the stored
 * document (`LogTaskProjection.cs`), and every server reader of `LogTask` (schedule matching, compliance,
 * the exports, the DFES day root) and every OLDER phone reads them. They must therefore be word for word
 * what this phone's `buildTaskPayloads` would have sent.
 *
 * ONE shared fixture pins both sides: `sync-contract/tests/fixtures/log-task-projection.json` — two REAL parse
 * responses of the founder's live test (2026-10-30) run through `normalizeParsedLog` + `LogFactory`, and one
 * set of edge values (JS truthiness, number formatting, the label rules, every bucket). This file proves the
 * phone produces `expected` from `content`; `LogTaskProjectionParityTests.cs` proves the server does. Change
 * either side and one of the two goes red.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { DailyLog } from '../../../../types';
import { buildTaskPayloads } from '../logTaskPayloads';
import { LogContentSchema } from '../../../../../../../../sync-contract/schemas/payloads/_log_content.zod';

interface ParityCase {
    name: string;
    logId: string;
    content: Record<string, unknown>;
    expected: Array<{ activityType: string; notes: string | null }>;
}

const fixturePath = resolve(__dirname, '../../../../../../../../sync-contract/tests/fixtures/log-task-projection.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { cases: ParityCase[] };

/** The log a document stands for: its buckets, everything else empty. */
const logOf = (c: ParityCase): DailyLog => ({
    id: c.logId,
    date: '2026-10-30',
    context: { selection: [] },
    dayOutcome: null,
    cropActivities: [], irrigation: [], labour: [], inputs: [], machinery: [], activityExpenses: [], observations: [], plannedTasks: [],
    meta: { createdAtISO: c.content.capturedAtUtc as string },
    ...c.content,
} as unknown as DailyLog);

describe('lane F1 — the phone\'s task lines for a stored document (shared C#↔TS fixture)', () => {
    it('the fixture carries the real parse shapes and the edge cases', () => {
        expect(fixture.cases.map(c => c.name)).toEqual([
            expect.stringContaining('real parse — typed Marathi'),
            expect.stringContaining('real parse — spoken English'),
            expect.stringContaining('edge values'),
        ]);
    });

    for (const c of fixture.cases) {
        it(`${c.name}: the document is a valid content payload`, () => {
            expect(LogContentSchema.safeParse(c.content).success).toBe(true);
        });

        it(`${c.name}: buildTaskPayloads produces exactly the expected lines`, () => {
            const lines = buildTaskPayloads(logOf(c)).map(t => ({ activityType: t.activityType, notes: t.notes ?? null }));
            expect(lines).toEqual(c.expected);
        });
    }
});
