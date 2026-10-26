/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I15; inventory S2, S15, S16)
 *
 *   1. S16 — the grid guessed the crop from the template id's TEXT, so a GUID id fell back to a made-up
 *      schedule: the schedule now comes from the real crop, and a made-up stand-in is never shown (P4);
 *      the page also knows when nobody chose the schedule (the app's first one for the crop).
 *   2. Changing a schedule REALLY takes effect: the library's adopt and the editor's save are pure functions
 *      over the crop list; the editor's choice becomes the crop's schedule (the page reads that first) and
 *      sets the plot's day 0. An old phone's extra fields in the stored schedule are kept (P11).
 *   3. The schedule's own names in Marathi for the schedules the app ships; a person's own words as written.
 * (S16's list route is NOT changed: see the KNOWN GAP note on `getCropScheduleTemplates`.)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { isFallbackTemplate, setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import type { Plot } from '../../../../types';
import { adoptForCrop, applyEditorChoice, resolvePlotSchedule } from '../resolveSchedule';
import { scheduleNameMr, taskNameMr } from '../scheduleNames';
import { REF, SERVER_TEMPLATE, SPRAY_TEMPLATE, SPRAY_TEMPLATE_ID, TEMPLATE_ID, TODAY, crop, plot } from './scheduleFixtures';

beforeAll(() => setScheduleTemplatesFromReferenceData([SERVER_TEMPLATE, SPRAY_TEMPLATE]));

describe('S16 — the schedule comes from the real crop, never from the id text', () => {
    it('a GUID-id schedule resolves to the real server schedule (the old guess gave a stand-in)', () => {
        const r = resolvePlotSchedule(crop(), plot(), TODAY)!;
        expect(r.template.id).toBe(TEMPLATE_ID);
        expect(isFallbackTemplate(r.template)).toBe(false);
        expect(r.instance.referenceDate).toBe(REF);
        expect(r.source).toBe('adopted');
    });

    it('a crop with no real schedule gets null, so the page says "no schedule" instead of inventing one', () => {
        const bare = plot({ schedule: undefined as never });
        expect(resolvePlotSchedule(crop([bare], { name: 'Tomato', activeScheduleId: null }), bare, TODAY)).toBeNull();
    });

    it('nobody chose it: no adopted schedule and the plot holds only the crop\'s default → source "default"', () => {
        expect(resolvePlotSchedule(crop(undefined, { activeScheduleId: null }), plot(), TODAY)!.source).toBe('default');
        const own = plot({ schedule: { ...plot().schedule, templateId: SPRAY_TEMPLATE_ID } });
        const r = resolvePlotSchedule(crop([own], { activeScheduleId: null }), own, TODAY)!;
        expect([r.template.id, r.source]).toEqual([SPRAY_TEMPLATE_ID, 'plot']);
    });
});

describe('adopting from the library', () => {
    it('the crop\'s schedule, on every plot of the crop; a new schedule starts without the old stage changes', () => {
        const a = plot({ schedule: { ...plot().schedule, stageOverrides: [{ stageId: 's', customDayEnd: 20 }] } });
        const b = plot({ id: 'plot-2', name: 'B', schedule: undefined as never });
        const other = crop([plot({ id: 'plot-9' })], { id: 'crop-2', name: 'Onion' });
        const next = adoptForCrop([crop([a, b]), other], 'crop-1', SPRAY_TEMPLATE_ID, TODAY);
        expect(next[0].activeScheduleId).toBe(SPRAY_TEMPLATE_ID);
        expect(next[0].plots.map(p => [p.schedule.templateId, p.schedule.stageOverrides.length])).toEqual([[SPRAY_TEMPLATE_ID, 0], [SPRAY_TEMPLATE_ID, 0]]);
        expect(next[1]).toBe(other);
    });

    it('re-adopting the SAME schedule keeps the plot\'s own stage changes; an unknown id changes nothing', () => {
        const a = plot({ schedule: { ...plot().schedule, stageOverrides: [{ stageId: 's', customDayEnd: 20 }] } });
        expect(adoptForCrop([crop([a])], 'crop-1', TEMPLATE_ID, TODAY)[0].plots[0].schedule.stageOverrides).toEqual([{ stageId: 's', customDayEnd: 20 }]);
        const before = [crop([a])];
        expect(adoptForCrop(before, 'crop-1', 'no-such-id', TODAY)).toEqual(before);
    });
});

describe('the editor\'s save takes effect', () => {
    it('a different schedule becomes the crop\'s schedule (so the page shows it) and the plot\'s day 0 moves', () => {
        const next = applyEditorChoice([crop()], { cropId: 'crop-1', plotId: 'plot-1', templateId: SPRAY_TEMPLATE_ID, startDate: '2026-10-20' }, TODAY);
        expect(next[0].activeScheduleId).toBe(SPRAY_TEMPLATE_ID);
        expect(next[0].plots[0].schedule).toMatchObject({ templateId: SPRAY_TEMPLATE_ID, referenceDate: '2026-10-20', stageOverrides: [], expectationOverrides: [] });
        const shown = resolvePlotSchedule(next[0], next[0].plots[0], TODAY)!;
        expect([shown.template.id, shown.instance.referenceDate, shown.source]).toEqual([SPRAY_TEMPLATE_ID, '2026-10-20', 'adopted']);
    });

    it('the same schedule only moves the chosen plot\'s day 0; the other plot is untouched', () => {
        const b = plot({ id: 'plot-2', name: 'B' });
        const next = applyEditorChoice([crop([plot(), b])], { cropId: 'crop-1', plotId: 'plot-2', templateId: TEMPLATE_ID, startDate: '2026-10-19' }, TODAY);
        expect(next[0].plots[0]).toEqual(plot());
        expect(next[0].plots[1].schedule.referenceDate).toBe('2026-10-19');
    });

    it('an old phone\'s wizard object: its extra fields are kept, its stale plantationDate is not; nothing real → no change', () => {
        const wizard = { cropId: 'crop-1', plotId: 'plot-1', plantationDate: REF, stages: [{ name: 'x' }], prepActivities: [{ id: 'p' }], name: 'My New Schedule', selectedTemplateId: TEMPLATE_ID };
        const old = plot({ schedule: wizard as unknown as Plot['schedule'] });
        const next = applyEditorChoice([crop([old])], { cropId: 'crop-1', plotId: 'plot-1', templateId: TEMPLATE_ID, startDate: '2026-10-18' }, TODAY);
        const saved = next[0].plots[0].schedule as unknown as Record<string, unknown>;
        expect(saved).toMatchObject({ templateId: TEMPLATE_ID, referenceDate: '2026-10-18', stageOverrides: [], name: 'My New Schedule', prepActivities: [{ id: 'p' }] });
        expect(saved).not.toHaveProperty('plantationDate');
        const before = [crop()];
        expect(applyEditorChoice(before, { cropId: 'crop-1', plotId: 'plot-1', templateId: TEMPLATE_ID, startDate: 'not a date' }, TODAY)).toEqual(before);
        expect(applyEditorChoice(before, { cropId: 'crop-1', plotId: 'nope', templateId: TEMPLATE_ID, startDate: '2026-10-18' }, TODAY)).toEqual(before);
    });
});

describe('the schedule\'s own names (S15, V1-03)', () => {
    it('the schedules the app ships read in Marathi; a person\'s own name is shown as written', () => {
        expect(scheduleNameMr('Grapes - Standard Seasonal Template')).toBe('द्राक्ष — हंगामी शेड्यूल');
        expect(scheduleNameMr('Pomegranate - Mrig Bahar Template')).toBe('डाळिंब — मृग बहार शेड्यूल');
        expect(scheduleNameMr('Sugarcane - Pest Spray')).toBe('ऊस — कीड फवारणी शेड्यूल');
        expect(scheduleNameMr('Grapes - Spray')).toBe('द्राक्ष — फवारणी शेड्यूल');
        expect(scheduleNameMr('डॉ. पाटील यांचं द्राक्ष शेड्यूल')).toBe('डॉ. पाटील यांचं द्राक्ष शेड्यूल');
        expect(scheduleNameMr('Grapes - Test schedule')).toBe('Grapes - Test schedule');
    });

    it('task names: shipped ones in Marathi (any case / spacing), anything else as written', () => {
        expect(taskNameMr('Powdery Mildew Spray')).toBe('भुरीसाठी फवारणी');
        expect(taskNameMr('  thrips control  spray ')).toBe('थ्रिप्ससाठी फवारणी');
        expect(taskNameMr('Spraying')).toBe('फवारणी');
        expect(taskNameMr('GA3 Dose 1')).toBe('GA3 Dose 1');
    });
});
