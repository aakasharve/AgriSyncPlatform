/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 1 — pins the rules `buildOversightModel` must honour. Pure module,
 * no Dexie / React / infrastructure — fixtures are hand-built `DailyLog`
 * objects, not fetched from storage.
 */
import { describe, it, expect } from 'vitest';

import { buildOversightModel } from '../oversightSelectors';
import type { DailyLog, FarmContext } from '../../../domain/types/log.types';

function makeContext(plotNames: string[]): FarmContext {
    if (plotNames.length === 0) return { selection: [] };
    return {
        selection: [
            {
                cropId: 'crop-1',
                cropName: 'Grapes',
                selectedPlotIds: plotNames.map((_, i) => `plot-${i}`),
                selectedPlotNames: plotNames,
            },
        ],
    };
}

function makeLog(overrides: Partial<DailyLog> & { id: string }): DailyLog {
    return {
        id: overrides.id,
        date: overrides.date ?? '2026-08-10',
        context: overrides.context ?? makeContext([]),
        dayOutcome: overrides.dayOutcome ?? 'WORK_RECORDED',
        cropActivities: overrides.cropActivities ?? [],
        irrigation: overrides.irrigation ?? [],
        labour: overrides.labour ?? [],
        inputs: overrides.inputs ?? [],
        machinery: overrides.machinery ?? [],
        observations: overrides.observations,
        meta: overrides.meta,
        financialSummary: overrides.financialSummary ?? {
            totalLabourCost: 0,
            totalInputCost: 0,
            totalMachineryCost: 0,
            grandTotal: 0,
        },
    };
}

const baseInput = {
    checkpointISO: null as string | null,
    nowISO: '2026-08-15T00:00:00.000Z',
    operatorNameById: {} as Record<string, string>,
    unverifiedCount: 0,
    yesterdayNotClosed: false,
    failedSendCount: 0,
    unqueueableCount: 0,
    approvalHolderName: null as string | null,
};

describe('buildOversightModel', () => {
    it('counts_only_named_people_in_the_people_tally', () => {
        const logs: DailyLog[] = [
            makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z', createdByOperatorId: 'op-1' } }),
            makeLog({ id: 'l2', meta: { createdAtISO: '2026-08-11T00:00:00.000Z', createdByOperatorId: 'op-1' } }),
            makeLog({ id: 'l3', meta: { createdAtISO: '2026-08-12T00:00:00.000Z', createdByOperatorId: 'op-2' } }),
        ];

        const model = buildOversightModel({
            ...baseInput,
            logs,
            operatorNameById: { 'op-1': 'Ramesh', 'op-2': 'Sunita' },
        });

        expect(model.people).toHaveLength(2);
        const opOne = model.people.find((p) => p.operatorId === 'op-1');
        const opTwo = model.people.find((p) => p.operatorId === 'op-2');
        expect(opOne?.name).toBe('Ramesh');
        expect(opOne?.recordCount).toBe(2);
        expect(opTwo?.name).toBe('Sunita');
        expect(opTwo?.recordCount).toBe(1);
    });

    it('records_with_no_creator_become_the_unattributed_bucket', () => {
        const logs: DailyLog[] = [
            makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z' } }), // no createdByOperatorId
            makeLog({ id: 'l2' }), // no meta at all
            makeLog({ id: 'l3', meta: { createdAtISO: '2026-08-12T00:00:00.000Z', createdByOperatorId: 'op-1' } }),
        ];

        const model = buildOversightModel({
            ...baseInput,
            logs,
            operatorNameById: { 'op-1': 'Ramesh' },
        });

        expect(model.unattributed).not.toBeNull();
        expect(model.unattributed?.operatorId).toBeNull();
        expect(model.unattributed?.name).toBe('');
        expect(model.unattributed?.recordCount).toBe(2);
        // Named people tally must stay honest: only the 1 named record counts.
        expect(model.people).toHaveLength(1);
        expect(model.people[0].recordCount).toBe(1);
        // totalRecords includes the unattributed ones too.
        expect(model.totalRecords).toBe(3);
    });

    it('a_log_that_arrived_after_the_checkpoint_is_unseen_even_when_its_work_date_is_older', () => {
        const checkpointISO = '2026-08-01T00:00:00.000Z';
        const logs: DailyLog[] = [
            // Work date is old (before the checkpoint), but it was actually
            // recorded/arrived AFTER the checkpoint -> must count as unseen.
            makeLog({
                id: 'late-arrival',
                date: '2026-01-01',
                meta: { createdAtISO: '2026-08-05T00:00:00.000Z', createdByOperatorId: 'op-1' },
            }),
            // Control: genuinely arrived before the checkpoint -> must NOT count.
            makeLog({
                id: 'already-seen',
                date: '2026-08-14',
                meta: { createdAtISO: '2026-07-15T00:00:00.000Z', createdByOperatorId: 'op-1' },
            }),
        ];

        const model = buildOversightModel({
            ...baseInput,
            logs,
            checkpointISO,
        });

        expect(model.totalRecords).toBe(1);
        expect(model.people[0]?.recordCount).toBe(1);
    });

    it('a_null_checkpoint_makes_everything_unseen_and_sinceDays_null', () => {
        const logs: DailyLog[] = [
            makeLog({ id: 'l1', meta: { createdAtISO: '2020-01-01T00:00:00.000Z', createdByOperatorId: 'op-1' } }),
            makeLog({ id: 'l2', meta: { createdAtISO: '2026-08-14T00:00:00.000Z', createdByOperatorId: 'op-2' } }),
        ];

        const model = buildOversightModel({
            ...baseInput,
            logs,
            checkpointISO: null,
        });

        expect(model.totalRecords).toBe(2);
        expect(model.sinceDays).toBeNull();
    });

    it('zero_count_decisions_are_omitted', () => {
        const model = buildOversightModel({
            ...baseInput,
            logs: [],
            unverifiedCount: 0,
            yesterdayNotClosed: true,
            failedSendCount: 3,
            approvalHolderName: null,
        });

        expect(model.decisions).toHaveLength(2);
        expect(model.decisions.some((d) => d.kind === 'approval')).toBe(false);
        const dayNotClosed = model.decisions.find((d) => d.kind === 'dayNotClosed');
        const failedSend = model.decisions.find((d) => d.kind === 'failedSend');
        expect(dayNotClosed?.count).toBe(1);
        expect(failedSend?.count).toBe(3);
    });

    it('work_categories_appear_only_when_the_log_carries_that_array', () => {
        const logs: DailyLog[] = [
            makeLog({
                id: 'l1',
                meta: { createdAtISO: '2026-08-10T00:00:00.000Z', createdByOperatorId: 'op-1' },
                irrigation: [{ id: 'irr-1', method: 'drip', source: 'well' }],
                cropActivities: [],
                labour: [],
            }),
            makeLog({
                id: 'l2',
                meta: { createdAtISO: '2026-08-11T00:00:00.000Z', createdByOperatorId: 'op-1' },
                inputs: [{ id: 'inp-1', method: 'Spray', mix: [] }],
            }),
        ];

        const model = buildOversightModel({ ...baseInput, logs });

        const person = model.people[0];
        expect(person.workCategories).toContain('irrigation');
        expect(person.workCategories).toContain('inputs');
        expect(person.workCategories).not.toContain('labour');
        expect(person.workCategories).not.toContain('cropActivity');
        expect(person.workCategories).not.toContain('machinery');
        expect(person.workCategories).not.toContain('observation');
    });

    // ── Finding F8 — "a zero meaning UNKNOWN was reported as NONE" ────────
    //
    // `waitingCount === 0` is what turns `CanonicalStrip` into the REST
    // state: a green tick plus "आज पर्यन्त सर्व कामे पूर्ण आहेत" ("all work is
    // complete as of today") and no count badge. These four tests pin that
    // this claim can only be reached when it is TRUE.

    it('unattributed_work_is_counted_in_the_waiting_count', () => {
        // The exact production shape: every write site of
        // `meta.createdByOperatorId` copies an OPTIONAL value
        // (`profile.activeOperatorId`, `farm.types.ts:325`), so a farm can
        // legitimately hold nothing but creator-less records. Before F8 this
        // farm produced people=[], decisions=[] and waitingCount=0 — the
        // rest state, over records the owner had never seen.
        const logs: DailyLog[] = [
            makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z' } }),
            makeLog({ id: 'l2', meta: { createdAtISO: '2026-08-11T00:00:00.000Z' } }),
            makeLog({ id: 'l3' }), // no meta at all
        ];

        const model = buildOversightModel({ ...baseInput, logs });

        expect(model.people).toHaveLength(0);
        expect(model.decisions).toHaveLength(0);
        expect(model.unattributed?.recordCount).toBe(3);
        expect(model.totalRecords).toBe(3);
        // The whole point: NOT zero. The owner keeps a reason to look.
        expect(model.waitingCount).toBe(1);
    });

    it('the_unattributed_bucket_counts_as_one_row_not_one_per_record', () => {
        // Derived exactly the way every other term is — one per row the
        // drawer actually renders (spec §P-H, "fifty records from four
        // people produce ONE briefing"). Two fixtures of very different
        // record counts must both contribute exactly 1, which no invented
        // number would do.
        const twoRecords = buildOversightModel({
            ...baseInput,
            logs: [
                makeLog({ id: 'a1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z' } }),
                makeLog({ id: 'a2', meta: { createdAtISO: '2026-08-11T00:00:00.000Z' } }),
            ],
        });
        const nineRecords = buildOversightModel({
            ...baseInput,
            logs: Array.from({ length: 9 }, (_, i) =>
                makeLog({ id: `b${i}`, meta: { createdAtISO: '2026-08-10T00:00:00.000Z' } })),
        });

        expect(twoRecords.unattributed?.recordCount).toBe(2);
        expect(nineRecords.unattributed?.recordCount).toBe(9);
        expect(twoRecords.waitingCount).toBe(1);
        expect(nineRecords.waitingCount).toBe(1);
    });

    it('waiting_count_sums_decisions_named_people_and_the_unattributed_row', () => {
        // All three terms present at once, each a distinctive size, so a
        // dropped or double-counted term shows up as a different total.
        const logs: DailyLog[] = [
            makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z', createdByOperatorId: 'op-1' } }),
            makeLog({ id: 'l2', meta: { createdAtISO: '2026-08-11T00:00:00.000Z', createdByOperatorId: 'op-2' } }),
            makeLog({ id: 'l3', meta: { createdAtISO: '2026-08-12T00:00:00.000Z' } }),
            makeLog({ id: 'l4', meta: { createdAtISO: '2026-08-13T00:00:00.000Z' } }),
        ];

        const model = buildOversightModel({
            ...baseInput,
            logs,
            operatorNameById: { 'op-1': 'Ramesh', 'op-2': 'Sunita' },
            unverifiedCount: 6,
            yesterdayNotClosed: true,
            failedSendCount: 2,
        });

        expect(model.decisions).toHaveLength(3);
        expect(model.people).toHaveLength(2);
        expect(model.unattributed).not.toBeNull();
        expect(model.waitingCount).toBe(3 + 2 + 1);
        // The people tally itself is UNCHANGED by F8 — spec §P-F / DoD #6:
        // "records with no person" is still not a person.
        expect(model.people.length).toBe(2);
    });

    it('waiting_count_is_zero_only_when_there_is_genuinely_nothing_outstanding', () => {
        const nothing = buildOversightModel({ ...baseInput, logs: [] });
        expect(nothing.waitingCount).toBe(0);
        expect(nothing.unattributed).toBeNull();

        // A single unattributed record that the checkpoint has NOT yet
        // covered is enough to leave the rest state — and one the
        // checkpoint HAS covered correctly returns to it, so the guard is a
        // real condition rather than a constant.
        const unseen = buildOversightModel({
            ...baseInput,
            checkpointISO: '2026-08-01T00:00:00.000Z',
            logs: [makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-05T00:00:00.000Z' } })],
        });
        expect(unseen.waitingCount).toBe(1);

        const seen = buildOversightModel({
            ...baseInput,
            checkpointISO: '2026-08-10T00:00:00.000Z',
            logs: [makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-05T00:00:00.000Z' } })],
        });
        expect(seen.unattributed).toBeNull();
        expect(seen.waitingCount).toBe(0);
    });

    // -----------------------------------------------------------------
    // FINDING F6 — the record that reached NO sync queue gets its own row.
    //
    // `resolveSyncTarget` refuses some logs (a plot with no crop cycle
    // pulled down yet, a संपूर्ण शेत log) and the save writes no queue row
    // at all. `deriveSyncHonestyState` deliberately never raises
    // `NEEDS_FIX` for those — there is nothing to retry and nowhere to
    // send — so they contribute nothing to `failedSendCount`, and with the
    // sync chip deleted (spec §4.1) they reached no surface whatsoever.
    // -----------------------------------------------------------------
    it('a_record_that_reached_no_queue_gets_its_own_waiting_row', () => {
        const model = buildOversightModel({ ...baseInput, logs: [], unqueueableCount: 2 });

        const unqueueable = model.decisions.filter((d) => d.kind === 'unqueueable');
        expect(unqueueable).toHaveLength(1);
        expect(unqueueable[0].count).toBe(2);
        expect(unqueueable[0].holderName).toBeNull();
    });

    it('the_unqueueable_row_is_absent_when_nothing_was_dropped', () => {
        // Founder ruling 2026-08-24: "if there is nothing the user must
        // know, do not show it." Zero dropped records is nothing to know.
        const model = buildOversightModel({ ...baseInput, logs: [], unqueueableCount: 0 });
        expect(model.decisions.some((d) => d.kind === 'unqueueable')).toBe(false);
    });

    it('unqueueable_is_never_merged_into_the_failed_send_row', () => {
        // Two separate facts with separate evidence and separate remedies:
        // a failed send CAN be retried, an unqueueable record never can.
        // One row claiming both counts would offer one row's remedy for
        // the other row's records.
        const model = buildOversightModel({
            ...baseInput,
            logs: [],
            failedSendCount: 3,
            unqueueableCount: 2,
        });

        const failed = model.decisions.find((d) => d.kind === 'failedSend');
        const unqueueable = model.decisions.find((d) => d.kind === 'unqueueable');
        expect(failed?.count).toBe(3);
        expect(unqueueable?.count).toBe(2);
        // Neither absorbed the other's total.
        expect(failed?.count).not.toBe(5);
        expect(unqueueable?.count).not.toBe(5);
    });

    it('the_unqueueable_row_flows_into_waiting_count_through_decisions', () => {
        // `waitingCount` is `decisions.length + people.length +
        // (unattributed ? 1 : 0)`. The new kind is a DECISION, so it is
        // picked up by the existing first term — no second term was added
        // and none may be. This pins that: the delta between the two
        // models below is exactly one, and it comes from `decisions`.
        const without = buildOversightModel({ ...baseInput, logs: [], unqueueableCount: 0 });
        const with_ = buildOversightModel({ ...baseInput, logs: [], unqueueableCount: 1 });

        expect(with_.decisions.length).toBe(without.decisions.length + 1);
        expect(with_.waitingCount).toBe(without.waitingCount + 1);
        expect(with_.waitingCount).toBe(
            with_.decisions.length + with_.people.length + (with_.unattributed === null ? 0 : 1),
        );
    });

    it('missing_server_timestamps_set_boundaryApproximate_true', () => {
        // DailyLog carries no server-received timestamp on the pure domain
        // type (only the Dexie storage record does) — so the boundary this
        // selector computes is always derived from a fallback, never a
        // proven server-receipt time.
        const model = buildOversightModel({
            ...baseInput,
            logs: [makeLog({ id: 'l1', meta: { createdAtISO: '2026-08-10T00:00:00.000Z', createdByOperatorId: 'op-1' } })],
        });

        expect(model.boundaryApproximate).toBe(true);
    });
});
