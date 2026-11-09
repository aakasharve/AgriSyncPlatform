/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane L8c-4 Task 2; founder D-78 = 1, D-29, D-31) - the phone's half of the
 * projection pin: which planned items become a spoken reminder, and exactly what each carries. One shared fixture
 * (`sync-contract/tests/fixtures/planned-work-projection.json`); the C# half is `PlannedWorkProjectionParityTests`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { capReminderTitle, projectSpokenReminders, REMINDER_TITLE_MAX } from '../data/spokenReminders';
import { spokenTaskId } from '../data/plannedWorkIds';

interface Case {
    name: string;
    content: Record<string, unknown>;
    expected: Array<{ itemKey: string; id: string | null; title: string; dueDate: string | null; namedPlotId: string | null; itemSourceType: string | null }>;
}
const fixture = JSON.parse(readFileSync(
    resolve(__dirname, '../../../../../../../sync-contract/tests/fixtures/planned-work-projection.json'), 'utf8')) as { logId: string; logDay: string; cases: Case[] };

describe('spoken reminders from a log (one fixture, the server and the phone)', () => {
    it.each(fixture.cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
        const found = projectSpokenReminders(fixture.logId, fixture.logDay, c.content);
        expect(found).toEqual(c.expected.map(e => ({ ...e, id: e.id ?? spokenTaskId(fixture.logId, e.itemKey) })));
    });

    it('carries no transcript, source text or interpretation (D-31)', () => {
        const found = projectSpokenReminders(fixture.logId, fixture.logDay, fixture.cases[0].content);
        const text = JSON.stringify(found);
        expect(text).not.toContain('फवारणी केली');
        expect(text).not.toContain('pipeline');
    });

    it('a document that is not an object, or has no planned items, makes nothing', () => {
        expect(projectSpokenReminders(fixture.logId, fixture.logDay, null)).toEqual([]);
        expect(projectSpokenReminders(fixture.logId, fixture.logDay, { plannedTasks: 'x' })).toEqual([]);
        expect(projectSpokenReminders(fixture.logId, fixture.logDay, {})).toEqual([]);
    });

    it('cuts a long title at the cap and a single endless word hard at the cap', () => {
        expect(capReminderTitle('x'.repeat(500))).toHaveLength(REMINDER_TITLE_MAX);
        expect(capReminderTitle('short one')).toBe('short one');
    });
});
