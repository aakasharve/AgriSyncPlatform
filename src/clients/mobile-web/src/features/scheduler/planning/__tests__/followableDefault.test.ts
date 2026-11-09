// @vitest-environment jsdom
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-b Task 2; open point 9 (c); D-76, D-82, D-91 = 1, P4)
 *
 * ONE default for the app. The crop's default schedule is worked out in two phone readers - `resolvePlotSchedule` (the शेड्यूल
 * page) and `scheduleTemplateForPlot` (तुलना, the DFES window, the day state). Both now take it from the ONE helper
 * (`defaultScheduleForCrop`) and it names only a schedule a plot may FOLLOW:
 *   - a schedule ShramSafal has CHECKED, the Institution one first;
 *   - the unchecked sample only on a crop with no checked schedule, and then it is marked as a sample;
 *   - nothing followable: no default at all (never the app's stand-in) and the page's honest line.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { setScheduleTemplatesFromReferenceData } from '../../../../infrastructure/reference/TemplateCatalog';
import { defaultScheduleForCrop } from '../followableDefault';
import { scheduleTemplateForPlot, getTemplateForCrop } from '../ClientPlanEngine';
import { resolvePlotSchedule } from '../../schedulePage/resolveSchedule';
import { SERVER_TEMPLATE, crop, plot } from '../../schedulePage/__tests__/scheduleFixtures';

const T = {
    sample: '10000000-0000-4000-8000-000000000001',
    expert: '10000000-0000-4000-8000-000000000003',
    university: '10000000-0000-4000-8000-000000000002',
    team: '10000000-0000-4000-8000-000000000006',
    withdrawn: '10000000-0000-4000-8000-000000000007',
    returned: '10000000-0000-4000-8000-000000000008',
    uncheckedWithDays: '10000000-0000-4000-8000-000000000009',
} as const;
const checked = { state: 'Checked', checkerDisplayName: 'श्रमसफल कृषी तज्ज्ञ', checkedAtUtc: '2026-11-08T05:00:00Z', note: null };
const row = (id: string, name: string, extra: Record<string, unknown> = {}, cropType = 'Grapes') => ({ ...SERVER_TEMPLATE, id, name, cropType, versionHash: 'h', ...extra });
const SAMPLE = row(T.sample, 'Grapes - Standard Seasonal Template', { check: null, ownerType: null });
const EXPERT = row(T.expert, 'Grapes - Expert Schedule', { ownerType: 'EXPERT', check: checked, hasStoredDays: true });
const UNIVERSITY = row(T.university, 'Grapes - University Schedule', { ownerType: 'INSTITUTION', check: checked, hasStoredDays: true });

/** A plot that chose nothing and whose stored schedule is only the app's stand-in: every reader falls to the crop's default. */
const undecided = () => crop([plot({ schedule: { ...plot().schedule, templateId: 'tpl_fallback_grape' } })], { activeScheduleId: null });
const TODAY = '2026-10-26';
const defaultOf = () => {
    const c = undecided();
    return resolvePlotSchedule(c, c.plots[0], TODAY);
};

beforeEach(() => setScheduleTemplatesFromReferenceData([SAMPLE, EXPERT, UNIVERSITY]));

describe('the one helper', () => {
    it('Institution_checked_first: the checked Institution schedule wins over a checked expert one and over the sample, whatever the catalog order', () => {
        setScheduleTemplatesFromReferenceData([SAMPLE, EXPERT, UNIVERSITY]);
        const d = defaultScheduleForCrop('Grapes');
        expect(d?.template.id).toBe(T.university);
        expect(d?.kind).toBe('checked');
    });

    it('A_checked_schedule_beats_the_sample: with a checked schedule on the crop the sample is never the default', () => {
        setScheduleTemplatesFromReferenceData([SAMPLE, EXPERT]);
        expect(defaultScheduleForCrop('Grapes')).toMatchObject({ kind: 'checked', template: { id: T.expert } });
    });

    it('Sample_only_on_a_crop_with_no_checked_schedule: the sample, marked as a sample (D-91 = 1)', () => {
        setScheduleTemplatesFromReferenceData([SAMPLE]);
        expect(defaultScheduleForCrop('Grapes')).toMatchObject({ kind: 'sample', template: { id: T.sample } });
    });

    it('Nothing_followable_gives_no_default: a team row, a withdrawn or sent-back check, an unchecked row that stores its days, or no schedule at all', () => {
        setScheduleTemplatesFromReferenceData([
            row(T.team, 'Grapes - Team', { scope: 'Team', ownerType: 'USER', check: null, hasStoredDays: true }),
            row(T.withdrawn, 'Grapes - Withdrawn', { check: { ...checked, state: 'Withdrawn' }, hasStoredDays: true }),
            row(T.returned, 'Grapes - Returned', { check: { ...checked, state: 'Returned' }, hasStoredDays: true }),
            row(T.uncheckedWithDays, 'Grapes - Unchecked', { check: null, hasStoredDays: true }),
        ]);
        expect(defaultScheduleForCrop('Grapes')).toBeNull();
        setScheduleTemplatesFromReferenceData([]);
        expect(defaultScheduleForCrop('Grapes')).toBeNull();
    });

    it('The_crop_rule_is_the_apps_one: a Marathi name finds the crop; another crop\'s schedule or an unreadable name finds none', () => {
        expect(defaultScheduleForCrop('द्राक्ष')?.template.id).toBe(T.university);
        setScheduleTemplatesFromReferenceData([SAMPLE, row('10000000-0000-4000-8000-0000000000aa', 'Tomato - Checked', { check: checked, hasStoredDays: true }, 'Tomato')]);
        expect(defaultScheduleForCrop('Grapes')).toMatchObject({ kind: 'sample' });
        expect(defaultScheduleForCrop('Dragonfruit')).toBeNull();
        expect(defaultScheduleForCrop('')).toBeNull();
    });
});

describe('both readers take it from the helper (the app does not split)', () => {
    it('The_page_default_is_the_followable_one_and_says_how: checked -> kind checked; sample only -> kind sample', () => {
        const r = defaultOf();
        expect(r?.source).toBe('default');
        expect(r?.template.id).toBe(T.university);
        expect(r?.defaultKind).toBe('checked');
        setScheduleTemplatesFromReferenceData([SAMPLE]);
        const s = defaultOf();
        expect(s?.template.id).toBe(T.sample);
        expect(s?.defaultKind).toBe('sample');
    });

    it('The_other_readers_default_is_the_same_schedule: scheduleTemplateForPlot agrees with the page, for every catalog', () => {
        for (const catalog of [[SAMPLE, EXPERT, UNIVERSITY], [SAMPLE, EXPERT], [SAMPLE], []]) {
            setScheduleTemplatesFromReferenceData(catalog);
            const c = undecided();
            const page = resolvePlotSchedule(c, c.plots[0], TODAY)?.template.id;
            const other = scheduleTemplateForPlot(c, c.plots[0]);
            // the page says "no schedule" (null); the other readers must not invent one either (never the stand-in)
            expect(other?.id).toBe(page);
        }
    });

    it('A_default_is_never_an_unchecked_sample_while_a_checked_one_exists (the old first-in-catalog default picked the sample)', () => {
        setScheduleTemplatesFromReferenceData([SAMPLE, EXPERT]);
        const c = undecided();
        expect(getTemplateForCrop('Grapes').id).toBe(T.sample); // the catalog order the OLD default followed
        expect(resolvePlotSchedule(c, c.plots[0], TODAY)?.template.id).toBe(T.expert);
        expect(scheduleTemplateForPlot(c, c.plots[0])?.id).toBe(T.expert);
    });

    it('Nothing_followable: no default on the page (the honest empty state), none for the other readers, no stand-in', () => {
        setScheduleTemplatesFromReferenceData([row(T.team, 'Grapes - Team', { scope: 'Team', check: null, hasStoredDays: true })]);
        const c = undecided();
        expect(resolvePlotSchedule(c, c.plots[0], TODAY)).toBeNull();
        expect(scheduleTemplateForPlot(c, c.plots[0])).toBeUndefined();
    });

    it('A_choice_still_outranks_the_default: the crop\'s own schedule is read first, as before, and is not marked a default', () => {
        const stored = plot({ schedule: { ...plot().schedule, templateId: 'tpl_fallback_grape' } });
        const adopted = resolvePlotSchedule(crop([stored], { activeScheduleId: T.expert }), stored, TODAY);
        expect(adopted).toMatchObject({ source: 'adopted', template: { id: T.expert } });
        expect(adopted?.defaultKind).toBeUndefined();
    });
});
