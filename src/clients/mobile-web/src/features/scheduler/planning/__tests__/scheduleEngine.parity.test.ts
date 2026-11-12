/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2 Cross-cutting; Review Focus 11; R28, R33; P11) - C# <-> TS SCHEDULE-DAYS PARITY,
 * the TS half.
 *
 * The शेड्यूल page's tabs (झालं / आज / पुढे) still count with the phone's `ClientPlanEngine`, while the stage panel and तुलना count with the server's
 * `ScheduleFollowEngine`. They must put a routine on the SAME days. ONE shared fixture pins both:
 * `sync-contract/tests/fixtures/schedule-engine-parity.json` holds, for the four built-in schedules (as the server sends them) and one schedule that
 * stores its days (start, end, repeat), the library JSON and the day numbers each activity falls on in each stage. This file proves the phone's engine
 * produces exactly those days; `ScheduleEngineParityTests.cs` proves the server's engine does. Change either engine and one goes red.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getTemplateById, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { derivePlannedItemsForStage } from '../ClientPlanEngine';
import type { PlotScheduleInstance } from '../../../../domain/types/scheduler.types';

interface FixtureSchedule {
    key: string;
    reference: { id: string; stages: Array<{ name: string }>; activities: unknown[] };
    dates: Array<{ stage: string; activities: Array<{ index: number; days: number[] }> }>;
}

const fixturePath = resolve(__dirname, '../../../../../../../../sync-contract/tests/fixtures/schedule-engine-parity.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
    schedules: FixtureSchedule[];
    knownDivergences?: Array<{
        label: string;
        reference: { id: string };
        server: Array<{ stage: string; days: number[] }>;
        phone: Array<{ stage: string; days: number[] }>;
    }>;
};

const DIVERGENCE_LABEL = 'KNOWN DIVERGENCE (server counts overrun in the later stage, phone clips to its own stage): CTO call pending';

describe('ClientPlanEngine puts every routine on the days the shared fixture says (parity with ScheduleFollowEngine)', () => {
    beforeEach(() => {
        // every stage is over, so the phone's "up to today" cap hides nothing
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-12-31T06:00:00Z'));
        setScheduleTemplatesFromReferenceData(fixture.schedules.map(s => s.reference));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it(`${DIVERGENCE_LABEL} - the phone half: a routine that overruns its stage is clipped to the stage it is written under`, () => {
        // P002 (review CMPD2-REVIEW-1): pinned from the SAME fixture entry the server half reads. Neither engine is changed by this lane: if the
        // phone starts counting the overrun in the later stage (or the server starts clipping) one of the two halves turns red.
        const entry = fixture.knownDivergences?.[0];
        expect(entry, 'the fixture carries the overrun case').toBeDefined();
        expect(entry!.label).toBe(DIVERGENCE_LABEL);
        setScheduleTemplatesFromReferenceData([...fixture.schedules.map(s => s.reference), entry!.reference]);
        const template = getTemplateById(entry!.reference.id)!;
        const instance: PlotScheduleInstance = {
            id: 'inst', plotId: 'plot', templateId: template.id, referenceType: template.referenceType,
            referenceDate: '2026-01-01', stageOverrides: [], expectationOverrides: [],
        };

        const mine = template.stages.map(stage => ({
            stage: stage.name,
            days: derivePlannedItemsForStage(template, instance, stage.id).map(i => i.dueDate as number).sort((a, b) => a - b),
        }));

        expect(mine).toEqual(entry!.phone);
        expect(mine).not.toEqual(entry!.server); // the divergence is real today
    });

    it('holds the four built-in schedules and one that stores its days', () => {
        expect(fixture.schedules).toHaveLength(5);
    });

    it.each([0, 1, 2, 3, 4])('schedule %i: every stage, every activity, the same days', scheduleIndex => {
        const entry = fixture.schedules[scheduleIndex];
        const template = getTemplateById(entry.reference.id);
        expect(template, entry.key).toBeDefined();
        const instance: PlotScheduleInstance = {
            id: 'inst', plotId: 'plot', templateId: entry.reference.id, referenceType: template!.referenceType,
            referenceDate: '2026-01-01', stageOverrides: [], expectationOverrides: [],
        };

        for (const stageEntry of entry.dates) {
            const stage = template!.stages.find(s => s.name === stageEntry.stage);
            expect(stage, `${entry.key} / ${stageEntry.stage}`).toBeDefined();
            const items = derivePlannedItemsForStage(template!, instance, stage!.id);
            for (const activity of stageEntry.activities) {
                const mine = items
                    .filter(i => i.originalId.endsWith(`_${activity.index + 1}`))
                    .map(i => i.dueDate as number)
                    .sort((a, b) => a - b);
                expect(mine, `${entry.key} / ${stageEntry.stage} / activity ${activity.index}`).toEqual(activity.days);
            }
        }
    });
});
