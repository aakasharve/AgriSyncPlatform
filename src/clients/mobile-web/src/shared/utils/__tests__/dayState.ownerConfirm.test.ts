/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * dayState — the progress ring must actually count the owner's confirmed log.
 *
 * spec: dfes-companion-2026-07-11 (wave-1.2)
 *
 * EMPIRICAL FINDING (Step 1, recorded before any code change):
 *   Task 1.1 (commit 4d1f4cb9) makes `LogFactory` stamp the owner's own log
 *   with `LogVerificationStatus.APPROVED` — see LogFactory.ts:289-295,
 *   430-434, and every "(a) THE OWNER" case in LogFactory.ownConfirm.test.ts.
 *   It NEVER produces `CONFIRMED`.
 *
 *   `dayState.ts`'s `VERIFIED_STATUSES` (:77-80) already contains
 *   `LogVerificationStatus.APPROVED` (alongside `VERIFIED`). So the ring
 *   ALREADY counts the owner's confirmed log correctly — this is a
 *   no-op-plus-regression-test task (Option A from the task-1.2 brief), not
 *   a code change. `CONFIRMED` is added to nothing here because nothing on
 *   this path produces it (YAGNI).
 *
 *   Gate for task 1.3: the server FSM's outbound edge from Draft is
 *   `→Confirmed`. If a future sync path ever writes the server's literal
 *   `CONFIRMED` into `DailyLog.verification.status`, `VERIFIED_STATUSES`
 *   will NOT count it (it only holds `VERIFIED` and `APPROVED`) and this
 *   exact 70%-forever bug reappears. Task 1.3 must reconcile that, not this
 *   task — this file exists to catch a regression on the LogFactory.APPROVED
 *   path this task actually verified.
 */
import { describe, it, expect } from 'vitest';
import { computeDayState } from '../dayState';
import { LogVerificationStatus } from '../../../types';
import type { DailyLog, CropProfile } from '../../../types';

const TODAY = '2026-08-16';

/** A single plot with NO schedule — plannedFromSchedule stays 0, isolating the verification-score half of the closurePercent formula. */
function makeCrops(): CropProfile[] {
    return [
        {
            id: 'crop-grapes',
            name: 'Grapes',
            iconName: 'grapes',
            color: 'purple',
            plots: [{ id: 'plot-a', name: 'Plot A', baseline: { unit: 'Acre' } }] as CropProfile['plots'],
            supportedTasks: [],
            workflow: [],
        } as CropProfile,
    ];
}

function makeLog(status: LogVerificationStatus): DailyLog {
    return {
        id: 'log-1',
        date: TODAY,
        context: {
            selection: [{ cropId: 'crop-grapes', cropName: 'Grapes', selectedPlotIds: ['plot-a'], selectedPlotNames: ['Plot A'] }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [{ id: 'ca1', title: 'Pruning', status: 'completed', targetPlotName: 'Plot A' }],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        verification: { status, required: status !== LogVerificationStatus.APPROVED },
    };
}

describe('computeDayState — the ring reflects the owner-confirm outcome of task 1.1', () => {
    it('one owner-confirmed (APPROVED) log, no planned tasks: closurePercent is 100 and isClosed is true', () => {
        const state = computeDayState({
            logs: [makeLog(LogVerificationStatus.APPROVED)],
            crops: makeCrops(),
            tasks: [],
            date: TODAY,
        });

        expect(state.closurePercent).toBe(100);
        expect(state.isClosed).toBe(true);
    });

    it('a MUKADAM\'s still-PENDING log: closurePercent stays 70 and isClosed stays false — the queue still shows work waiting', () => {
        const state = computeDayState({
            logs: [makeLog(LogVerificationStatus.PENDING)],
            crops: makeCrops(),
            tasks: [],
            date: TODAY,
        });

        expect(state.closurePercent).toBe(70);
        expect(state.isClosed).toBe(false);
    });
});
