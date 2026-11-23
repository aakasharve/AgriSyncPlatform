/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) - Review Focus 4: a phone from release 1.0.17 reads a library that holds a reference schedule in the
 * task format. `schedule-listing-slice7.json` is what the REAL server answered (GET /shramsafal/reference/schedule-templates, as a farm owner) in
 * ReferenceScheduleRealPostgresTests.Release1017Listing_IsCapturedFromTheRealServer, after two references were imported in format 2 and checked by another
 * person: one with seven tasks of every kind, one whose only task is dayless (test ids, test names and test words only - never the grape year file).
 * 1.0.17's own parser (a frozen copy) reads it without crashing; it sees the day tasks the old rules hold and nothing else: no task before pruning printed as
 * day 0, no dayless task given a day, and the dayless-only reference not at all (no stage, so 1.0.17 drops it: never a sample it could adopt).
 */
import { describe, expect, it } from 'vitest';
import listing from './fixtures/schedule-listing-slice7.json';
import { release1017Templates } from './fixtures/templateCatalog.release1017';

type Row = { id: string; name: string; stages: unknown[]; activities: Array<{ name: string; startDay: number }>; hasTaskFormat?: boolean };

const rows = listing as unknown as Row[];
const reference = rows.find(r => r.activities.length > 0)!;
const daylessOnly = rows.find(r => r.activities.length === 0)!;

describe('release 1.0.17 reads a library with a reference in the task format', () => {
    it('the captured server response holds both references, in the task format', () => {
        expect(rows).toHaveLength(2);
        expect(reference.hasTaskFormat).toBe(true);
        expect(daylessOnly.hasTaskFormat).toBe(true);
        expect(JSON.stringify(rows)).not.toContain('"tasks"');
    });

    it('Release1017Parser_ReadsTheNewListing', () => {
        const parsed = release1017Templates(rows);

        // It reads the reference (no throw), with its two stages and only its two stored day works: the pruning on day 0 and the spray every 7 days.
        expect(parsed).toHaveLength(1);
        const template = parsed[0];
        expect(template.id).toBe(reference.id);
        expect(template.cropCode).toBe('grape');
        expect(template.stages.map(s => [s.name, s.dayStart, s.dayEnd])).toEqual([
            ['छाटणी आणि फूट', 0, 40],
            ['मण्यांची वाढ', 41, 99],
        ]);
        expect(template.oneTimeExpectations.map(e => [e.notes, e.targetDayFromRef])).toEqual([['फळछाटणी', 0]]);
        expect(template.periodicExpectations.map(e => [e.notes, e.frequencyMode, e.frequencyValue])).toEqual([['बुरशीनाशक फवारणी', 'EVERY_N_DAYS', 7]]);

        // Nothing it would show on an invented day: not the work 5 days before pruning (1.0.17 clamps a negative day to 0), not the dayless, after, sign or observe work.
        const notes = [...template.oneTimeExpectations, ...template.periodicExpectations].map(e => e.notes);
        for (const hidden of ['छाटणीपूर्व पाणी', 'गरजेनुसार खत', 'पेस्ट लावणे', 'फुलोऱ्यात पाणी कमी', 'मणी पाहणी']) {
            expect(notes).not.toContain(hidden);
        }

        // The dayless-only reference has no stage: 1.0.17 drops it, so it is never a sample that release could list or adopt.
        expect(parsed.find(t => t.id === daylessOnly.id)).toBeUndefined();
    });
});
