/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-OWN-b; founder D-132 Q3 = 1 "three things: काम, कधी, किती वेळा", Q4 note, D-136/D-137)
 *
 * The pure model of a person's own schedule on the phone: read the pulled rows (only those that name an owner), chain the versions,
 * derive the days from the stages (never typed), and check a draft the way the server's edit does BEFORE it is queued.
 */
import { describe, expect, it } from 'vitest';
import { buildOwnChains, derivedDays, parseOwnVersions, validateSchedule } from '../ownScheduleModel';
import { OWNER, STAGES_A, TYPIST, WORKS_A, id, ownRow } from './ownFixtures';

describe('parseOwnVersions: only a row that names an owner is a person\'s own schedule', () => {
    it('Only_rows_with_an_owner_are_own: a Public sample, a plain Team copy (no owner) and a built-in are left out', () => {
        const rows = [
            ownRow({ id: id(1), stages: STAGES_A, activities: WORKS_A }),
            { ...ownRow({ id: id(2), stages: STAGES_A, activities: WORKS_A }), ownerUserId: null },
            { id: id(3), name: 'Grapes - Standard Seasonal Template', cropType: 'Grapes', totalDays: 40, stages: [{ name: 'a', startDay: 0, endDay: 5 }], activities: [], versionHash: 'h' },
            'not a row', null, 7,
        ];
        expect(parseOwnVersions(rows).map(v => v.id)).toEqual([id(1)]);
    });

    it('Stored_row_reads_its_stages_and_its_works_with_the_part_in_lower_case', () => {
        const [v] = parseOwnVersions([ownRow({ id: id(1), version: 3, stages: STAGES_A, activities: WORKS_A, variety: 'Thompson Seedless', soilType: 'black', region: 'mh_nashik', climate: 'dry' })]);
        expect(v.stages).toHaveLength(4);
        expect(v.works.map(w => [w.name, w.part, w.startDay, w.endDay, w.mode, w.intervalDays])).toEqual([
            ['ठिबक सिंचन', 'irrigation', 31, 60, 'every_n_days', 5],
            ['बुरशीनाशक फवारणी', 'spray', 34, 55, 'every_n_days', 7],
            ['घड विरळणी', 'work', 38, 38, 'one_time', 1],
        ]);
        expect(v.version).toBe(3);
        expect(v.madeFor).toEqual({ variety: 'Thompson Seedless', soilType: 'black', region: 'mh_nashik', climate: 'dry' });
        expect(v.ownerUserId).toBe(OWNER);
        expect(v.madeByUserId).toBe(OWNER);
        expect(v.madeAtUtc).toBe('2026-11-04T05:00:00Z');
    });

    it('A_version_with_stages_but_no_works_reads_its_stages_from_draftStages (the wire keeps stages [] for old phones: M004)', () => {
        const [v] = parseOwnVersions([ownRow({ id: id(1), stages: STAGES_A, activities: [] })]);
        expect(v.hasStoredDays).toBe(false);
        expect(v.stages).toEqual(STAGES_A);
        expect(v.works).toEqual([]);
    });

    it('An_empty_version_has_no_stage_and_no_work', () => {
        const [v] = parseOwnVersions([ownRow({ id: id(1) })]);
        expect(v.stages).toEqual([]);
        expect(v.works).toEqual([]);
        expect(derivedDays(v.stages)).toBe(0);
    });

    it('An_unreadable_work_or_stage_is_left_out_never_guessed', () => {
        const row = ownRow({ id: id(1), stages: STAGES_A, activities: WORKS_A }) as { activities: Array<Record<string, unknown>>; stages: Array<Record<string, unknown>> };
        row.activities.push({ name: '', startDay: 1, endDay: 2 }, { startDay: 1 } as never);
        row.stages.push({ name: '  ', startDay: 1, endDay: 2 });
        const [v] = parseOwnVersions([row]);
        expect(v.works).toHaveLength(3);
        expect(v.stages).toHaveLength(4);
    });

    it('A_work_keeps_a_well_formed_operation_key_and_drops_any_other (the server refuses a key of the wrong shape)', () => {
        const [v] = parseOwnVersions([ownRow({
            id: id(1), stages: STAGES_A,
            activities: [
                { name: 'छाटणी', startDay: 0, endDay: 0, operationKey: 'op_pruning' },
                { name: 'काहीतरी', startDay: 1, endDay: 1, operationKey: 'Pruning' },
                { name: 'तिसरं', startDay: 2, endDay: 2, operationKey: `op_${'x'.repeat(38)}` },
            ],
        })]);
        expect(v.works.map(w => w.operationKey)).toEqual(['op_pruning', undefined, undefined]);
    });
});

describe('buildOwnChains: the versions of one schedule follow previousVersionId', () => {
    it('Chain_has_its_versions_oldest_first_and_the_newest_is_the_latest', () => {
        const rows = [
            ownRow({ id: id(3), version: 3, previousVersionId: id(2), stages: STAGES_A, activities: WORKS_A }),
            ownRow({ id: id(1), version: 1, stages: STAGES_A, activities: WORKS_A.slice(0, 1) }),
            ownRow({ id: id(2), version: 2, previousVersionId: id(1), stages: STAGES_A, activities: WORKS_A.slice(0, 2) }),
        ];
        const chains = buildOwnChains(parseOwnVersions(rows));
        expect(chains).toHaveLength(1);
        expect(chains[0].versions.map(v => v.id)).toEqual([id(1), id(2), id(3)]);
        expect(chains[0].latest.id).toBe(id(3));
        expect(chains[0].versions.map(v => v.version)).toEqual([1, 2, 3]);
    });

    it('Two_schedules_make_two_chains_and_each_keeps_its_crop', () => {
        const chains = buildOwnChains(parseOwnVersions([
            ownRow({ id: id(1), name: 'अ', cropType: 'Grapes', stages: STAGES_A, activities: WORKS_A }),
            ownRow({ id: id(2), name: 'ब', cropType: 'Tomato', stages: STAGES_A, activities: WORKS_A }),
        ]));
        expect(chains.map(c => [c.latest.name, c.cropType]).sort()).toEqual([['अ', 'Grapes'], ['ब', 'Tomato']]);
    });

    it('A_missing_previous_version_starts_the_chain_at_the_first_row_the_phone_holds (no crash, no invented row)', () => {
        const chains = buildOwnChains(parseOwnVersions([
            ownRow({ id: id(5), version: 5, previousVersionId: id(4), stages: STAGES_A, activities: WORKS_A }),
        ]));
        expect(chains).toHaveLength(1);
        expect(chains[0].versions.map(v => v.id)).toEqual([id(5)]);
        expect(chains[0].versions[0].version).toBe(5);
        expect(chains[0].missingBefore).toBe(true);
    });

    it('The_version_number_falls_back_to_the_place_in_the_chain_when_the_row_has_no_tag', () => {
        const a = ownRow({ id: id(1), stages: STAGES_A, activities: WORKS_A }) as Record<string, unknown>;
        const b = ownRow({ id: id(2), previousVersionId: id(1), stages: STAGES_A, activities: WORKS_A }) as Record<string, unknown>;
        delete a.rowVersionTag; delete b.rowVersionTag;
        const chain = buildOwnChains(parseOwnVersions([b, a]))[0];
        expect(chain.versions.map(v => v.version)).toEqual([1, 2]);
    });

    it('A_branch_picks_the_row_made_last_as_the_latest', () => {
        const chain = buildOwnChains(parseOwnVersions([
            ownRow({ id: id(1), stages: STAGES_A, activities: WORKS_A }),
            ownRow({ id: id(2), version: 2, previousVersionId: id(1), madeAtUtc: '2026-11-05T05:00:00Z', madeByUserId: TYPIST, stages: STAGES_A, activities: WORKS_A }),
            ownRow({ id: id(3), version: 2, previousVersionId: id(1), madeAtUtc: '2026-11-06T05:00:00Z', stages: STAGES_A, activities: WORKS_A }),
        ]))[0];
        expect(chain.latest.id).toBe(id(3));
    });
});

describe('derivedDays: the days come from the stages, never a box', () => {
    it('Days_are_the_last_stage_day_plus_one_like_the_server_counts_them', () => {
        expect(derivedDays(STAGES_A)).toBe(101);
    });
    it('No_stage_means_no_number', () => {
        expect(derivedDays([])).toBe(0);
    });
    it('Stages_out_of_order_still_give_the_largest_end', () => {
        expect(derivedDays([{ name: 'b', startDay: 10, endDay: 40 }, { name: 'a', startDay: 0, endDay: 9 }])).toBe(41);
    });
});

describe('validateSchedule: the server\'s day rules, asked before anything is queued', () => {
    const stages = [{ name: 'फुलोरा', startDay: 31, endDay: 60 }];
    const ok = { name: 'ठिबक सिंचन', part: 'irrigation' as const, startDay: 31, endDay: 60, mode: 'every_n_days' as const, intervalDays: 5 };

    it('A_good_schedule_has_no_problem', () => {
        expect(validateSchedule(stages, [ok])).toBeNull();
    });
    it('No_stage_is_a_problem (a schedule needs at least one stage)', () => {
        expect(validateSchedule([], [])?.code).toBe('noStage');
    });
    it('A_stage_that_ends_before_it_starts_is_a_problem', () => {
        expect(validateSchedule([{ name: 'x', startDay: 10, endDay: 5 }], [])?.code).toBe('stageDays');
    });
    it('A_stage_with_no_name_or_a_name_over_80_is_a_problem', () => {
        expect(validateSchedule([{ name: ' ', startDay: 0, endDay: 5 }], [])?.code).toBe('stageName');
        expect(validateSchedule([{ name: 'x'.repeat(81), startDay: 0, endDay: 5 }], [])?.code).toBe('stageName');
    });
    it('A_work_that_ends_before_it_starts_is_a_problem (errEnd)', () => {
        expect(validateSchedule(stages, [{ ...ok, startDay: 40, endDay: 35 }])?.code).toBe('workDays');
    });
    it('A_work_that_starts_outside_every_stage_or_runs_past_the_last_stage_is_a_problem', () => {
        expect(validateSchedule(stages, [{ ...ok, startDay: 5, endDay: 40 }])?.code).toBe('workOutside');
        expect(validateSchedule(stages, [{ ...ok, startDay: 40, endDay: 61 }])?.code).toBe('workOutside');
    });
    it('A_work_may_cross_from_one_stage_into_the_next (the server asks only that it starts in a stage and ends by the last day)', () => {
        const two = [{ name: 'a', startDay: 0, endDay: 15 }, { name: 'b', startDay: 16, endDay: 30 }];
        expect(validateSchedule(two, [{ ...ok, startDay: 10, endDay: 25 }])).toBeNull();
    });
    it('A_repeat_below_1_or_a_week_count_over_7_is_a_problem', () => {
        expect(validateSchedule(stages, [{ ...ok, intervalDays: 0 }])?.code).toBe('repeat');
        expect(validateSchedule(stages, [{ ...ok, mode: 'per_week', intervalDays: 8 }])?.code).toBe('repeat');
        expect(validateSchedule(stages, [{ ...ok, mode: 'per_week', intervalDays: 3 }])).toBeNull();
    });
    it('A_work_name_shorter_than_2_or_longer_than_120_is_a_problem', () => {
        expect(validateSchedule(stages, [{ ...ok, name: 'अ' }])?.code).toBe('workName');
        expect(validateSchedule(stages, [{ ...ok, name: 'x'.repeat(121) }])?.code).toBe('workName');
    });
    it('More_than_40_stages_or_300_works_or_a_day_over_3650_is_a_problem (the contract\'s bounds)', () => {
        const many = Array.from({ length: 41 }, (_, i) => ({ name: `s${i}`, startDay: i, endDay: i }));
        expect(validateSchedule(many, [])?.code).toBe('tooMany');
        expect(validateSchedule(stages, Array.from({ length: 301 }, () => ok))?.code).toBe('tooMany');
        expect(validateSchedule([{ name: 'x', startDay: 0, endDay: 3651 }], [])?.code).toBe('stageDays');
    });
});
