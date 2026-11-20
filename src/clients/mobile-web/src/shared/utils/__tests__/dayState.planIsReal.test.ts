// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane HONESTY-1, item H1; doctrine P4 - no fabricated numbers)
 *
 * "{done} पूर्ण, {left} बाकी" is a computed count of what a schedule expects today. When that schedule is the app's invented
 * stand-in (`tpl_fallback_*`) or an unchecked SAMPLE nobody chose, the count is a made-up number. `computeDayState` therefore
 * publishes `planIsReal`: false the moment one planned item in the counts came from such a plan. THE COUNTS THEMSELVES ARE NOT
 * CHANGED - only the flag is new - and the screens that print the two numbers draw nothing when it is false.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { computeDayState } from '../dayState';
import { getTemplatesForCrop, setScheduleTemplatesFromReferenceData } from '../../../infrastructure/reference/TemplateCatalog';
import { SERVER_TEMPLATE, TODAY, crop, plot } from '../../../features/scheduler/schedulePage/__tests__/scheduleFixtures';
import type { CropProfile, PlannedTask } from '../../../types';

const ID = {
    sample: '20000000-0000-4000-8000-000000000001',
    checked: '20000000-0000-4000-8000-000000000002',
    uncheckedWithDays: '20000000-0000-4000-8000-000000000003',
    team: '20000000-0000-4000-8000-000000000004',
    own: '20000000-0000-4000-8000-000000000005',
} as const;
const checkedMark = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, extra: Record<string, unknown> = {}) => ({ ...SERVER_TEMPLATE, id, name: `Grapes - ${id.slice(-1)}`, cropType: 'Grapes', versionHash: 'h', ...extra });

/** One plot, on schedule day 9 of `templateId`, whose crop names `templateId` as its schedule. */
const onSchedule = (templateId: string, cropOverrides: Partial<CropProfile> = {}): CropProfile[] => {
    const base = plot();
    return [crop([plot({ schedule: { ...base.schedule!, templateId } })], { activeScheduleId: templateId, ...cropOverrides })];
};
const stateOf = (crops: CropProfile[], tasks: PlannedTask[] = []) => computeDayState({ logs: [], crops, tasks, date: TODAY });

beforeEach(() => setScheduleTemplatesFromReferenceData([]));

describe('H1 - the day count says whether it stands on a real plan', () => {
    it('a CHECKED schedule: planIsReal is true and the plan counts', () => {
        setScheduleTemplatesFromReferenceData([row(ID.checked, { check: checkedMark, hasStoredDays: true, ownerType: 'INSTITUTION' })]);
        const s = stateOf(onSchedule(ID.checked));
        expect(s.plannedCount).toBeGreaterThan(0);
        expect(s.planIsReal).toBe(true);
    });

    it('an unchecked row that STORES its days (somebody follows it): real', () => {
        setScheduleTemplatesFromReferenceData([row(ID.uncheckedWithDays, { check: null, hasStoredDays: true })]);
        expect(stateOf(onSchedule(ID.uncheckedWithDays)).planIsReal).toBe(true);
    });

    it('the farm\'s own (Team) schedule and a person\'s own schedule: real - no check applies to them', () => {
        setScheduleTemplatesFromReferenceData([
            row(ID.team, { scope: 'Team', ownerType: 'USER', check: null, hasStoredDays: true }),
            row(ID.own, { scope: 'Private', ownerType: 'USER', ownerUserId: '30000000-0000-4000-8000-000000000001', check: null }),
        ]);
        expect(stateOf(onSchedule(ID.team)).planIsReal).toBe(true);
        expect(stateOf(onSchedule(ID.own)).planIsReal).toBe(true);
    });

    it('the unchecked SAMPLE (nobody chose it, ShramSafal checked nothing): planIsReal is false, the counts are unchanged', () => {
        setScheduleTemplatesFromReferenceData([row(ID.sample, { check: null, ownerType: null })]);
        const s = stateOf(onSchedule(ID.sample));
        expect(s.plannedCount).toBeGreaterThan(0); // counting works exactly as before ...
        expect(s.pendingCount).toBe(s.plannedCount);
        expect(s.planIsReal).toBe(false); // ... but it is flagged as not built on a real plan
    });

    it('the sample reached only as the crop\'s DEFAULT (the plot names nothing real): false', () => {
        setScheduleTemplatesFromReferenceData([row(ID.sample, { check: null, ownerType: null })]);
        const p = plot();
        const crops = [crop([plot({ schedule: { ...p.schedule!, templateId: '' } })], { activeScheduleId: null })];
        const s = stateOf(crops);
        expect(s.plannedCount).toBeGreaterThan(0);
        expect(s.planIsReal).toBe(false);
    });

    it('the app\'s invented stand-in (tpl_fallback_*): planIsReal is false, and the invented work is still counted as before', () => {
        // A crop added before the catalog arrived: the catalog builds its stand-in and the plot stores the stand-in's id.
        const standIn = getTemplatesForCrop('Grapes')[0];
        expect(standIn.id.startsWith('tpl_fallback_')).toBe(true);
        const s = stateOf(onSchedule(standIn.id));
        expect(s.plannedCount).toBeGreaterThan(0);
        expect(s.planIsReal).toBe(false);
    });

    it('no schedule on any plot: only real tasks are counted, so the count is believable', () => {
        const task: PlannedTask = {
            id: 't1', title: 'फवारणी', plotId: 'plot-1', cropId: 'crop-1', priority: 'normal', status: 'pending',
            sourceType: 'ai_extracted', createdAt: `${TODAY}T06:00:00.000Z`, dueDate: TODAY,
        } as PlannedTask;
        const noSchedule = [crop([plot({ schedule: undefined })])];
        const s = stateOf(noSchedule, [task]);
        expect(s.plannedCount).toBe(1);
        expect(s.planIsReal).toBe(true);
    });

    it('a stand-in that puts NOTHING into today\'s count does not taint it', () => {
        const standIn = getTemplatesForCrop('Grapes')[0];
        // Day 95 of the stand-in: its late stage has only a one-time harvest on day 100, so no item is due today.
        const p = plot();
        const crops = [crop([plot({ startDate: '2026-07-23', schedule: { ...p.schedule!, templateId: standIn.id, referenceDate: '2026-07-23' } })], { activeScheduleId: standIn.id })];
        const s = stateOf(crops);
        expect(s.plannedCount).toBe(0);
        expect(s.planIsReal).toBe(true);
    });
});
