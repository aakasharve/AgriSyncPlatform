/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * computeDayState — Founder decision 6: "the number never goes backwards
 * within a day." Adding a log, confirming a log, or crediting an answered
 * question must never LOWER the ring/closurePercent the farmer is looking
 * at, for a fixed day.
 *
 * spec: dfes-companion-2026-07-11 (wave-1.6)
 *
 * SCOPE NOTE — this is the FRONTEND half of the guarantee only.
 * `ShramSafal.Domain.Dfes.DayUnderstandingScore` (backend, `src/apps/**`) is
 * out of this role's editable surface (frontend implementor). Its own
 * monotonicity is covered by `DayUnderstandingScoreMonotonicityTests.cs`.
 * This file is the analogous tripwire for `computeDayState`'s `closurePercent`
 * — the number actually rendered as the ring in `mainView.tsx` (the conic
 * gradient) and in `DailyLoopHero`. This is the ONLY "understanding number"
 * this role can guarantee; the server's separate `/10` Day Understanding
 * Score already carries its own DOCUMENTED non-monotonicity defect (see
 * `DayUnderstandingCard.tsx` "NOTE the score's monotonicity defect" comment)
 * which is backend-owned and out of scope here.
 *
 * This is WHY it needs to be a property test over a spread of scenarios, not
 * one happy path — see the EMPIRICAL FINDING below.
 *
 * ============================================================================
 * EMPIRICAL FINDING (Step 2, recorded before any code change — NOT weakened):
 * ============================================================================
 * `closurePercent = round(taskScore*70 + verificationScore*30)`, where
 * `verificationScore = dayLogs.length === 0 ? 1 : verifiedCount/dayLogs.length`
 * (dayState.ts:420-425). Treating a LOG-FREE day as "fully verified" (score 1)
 * is a MEAN-OVER-ITEMS formula with a vacuous baseline — structurally the
 * same shape as the backend's own documented flaw ("From is a mean over
 * applicable lenses, so telling Sathi more can LOWER it"). Probed directly
 * against `computeDayState` (not simulated):
 *
 *   0 logs, 0 planned tasks                        -> closurePercent 100
 *   + a MUKADAM's first log of the day (PENDING)    -> closurePercent  70  ◄ DROP
 *   that log confirmed (VERIFIED)                   -> closurePercent 100
 *
 *   1 planned task pending                          -> closurePercent  30
 *   task answered/closed (done)                     -> closurePercent 100
 *   + a mukadam's first log of the day (PENDING)     -> closurePercent  70  ◄ DROP
 *   that log confirmed (VERIFIED)                    -> closurePercent 100
 *
 *   0 logs, 0 planned tasks                          -> closurePercent 100
 *   + owner's own log (auto-APPROVED, Task 1.1)       -> closurePercent 100
 *   + a mukadam's log arrives (PENDING)               -> closurePercent  85  ◄ DROP
 *
 * This IS a real defect: the moment a non-owner's log lands PENDING on a day
 * that previously had zero unverified logs, `verificationScore`'s denominator
 * widens before its numerator does, and the ring the OWNER is looking at
 * falls — the exact thing founder decision 6 forbids. It is NOT hidden by
 * weakening assertions below; the scenarios that reproduce it are named
 * "DEFECT:" and left failing so `pnpm test` reports them honestly. Reported,
 * not fixed — this task's steps are test-authorship only (see task brief).
 * Every other scenario (owner-only sequences, answer-credited sequences,
 * log-confirmed alone) IS monotonic today and stays a real regression
 * tripwire for Wave 3 (3.4 work-by-product, 3.5 weather retirement, 3.11
 * filler answers).
 */
import { describe, it, expect } from 'vitest';
import { computeDayState } from '../dayState';
import { LogVerificationStatus } from '../../../types';
import type { DailyLog, CropProfile, PlannedTask } from '../../../types';

const TODAY = '2026-08-16';

/** Single plot, no schedule — plannedFromSchedule stays 0 so pendingCount/
 * plannedCount are driven purely by the `tasks` fixture, isolating the
 * addition sequence from ClientPlanEngine's schedule math (irrelevant here). */
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

function makeLog(id: string, status: LogVerificationStatus): DailyLog {
    return {
        id,
        date: TODAY,
        context: {
            selection: [{ cropId: 'crop-grapes', cropName: 'Grapes', selectedPlotIds: ['plot-a'], selectedPlotNames: ['Plot A'] }],
        },
        dayOutcome: 'WORK_RECORDED',
        cropActivities: [{ id: `ca-${id}`, title: 'Pruning', status: 'completed', targetPlotName: 'Plot A' }],
        irrigation: [],
        labour: [],
        inputs: [],
        machinery: [],
        financialSummary: { totalLabourCost: 0, totalInputCost: 0, totalMachineryCost: 0, grandTotal: 0 },
        // Owner logs are auto-stamped APPROVED by LogFactory (Task 1.1) the
        // instant they're created — they are never PENDING. A mukadam
        // (non-owner) log starts PENDING until the owner reviews it.
        verification: { status, required: status !== LogVerificationStatus.APPROVED },
    };
}

function makeTask(id: string, status: PlannedTask['status']): PlannedTask {
    return {
        id,
        title: `task-${id}`,
        plotId: 'plot-a',
        cropId: 'crop-grapes',
        priority: 'normal',
        status,
        sourceType: 'ai_extracted',
        createdAt: `${TODAY}T06:00:00.000Z`,
        dueDate: TODAY,
    };
}

/** One step of a farmer's day. Each produces the NEXT (logs, tasks) pair
 * from the previous one — a log saved, a log confirmed, or a task's answer
 * credited (Sathi's gap question closing a task). */
type DayStep = {
    label: string;
    apply: (logs: DailyLog[], tasks: PlannedTask[]) => { logs: DailyLog[]; tasks: PlannedTask[] };
};

const logSaved = (id: string, owner: boolean): DayStep => ({
    label: `log saved (${owner ? 'owner, auto-APPROVED' : 'mukadam, PENDING'}) [${id}]`,
    apply: (logs, tasks) => ({
        logs: [...logs, makeLog(id, owner ? LogVerificationStatus.APPROVED : LogVerificationStatus.PENDING)],
        tasks,
    }),
});

const logConfirmed = (id: string): DayStep => ({
    label: `log confirmed [${id}]`,
    apply: (logs, tasks) => ({
        logs: logs.map(log => (log.id === id ? { ...log, verification: { status: LogVerificationStatus.VERIFIED, required: false } } : log)),
        tasks,
    }),
});

const answerCredited = (id: string): DayStep => ({
    label: `answer credited (task closed) [${id}]`,
    apply: (logs, tasks) => ({
        logs,
        tasks: tasks.map(task => (task.id === id ? { ...task, status: 'done' } : task)),
    }),
});

/** Walks a sequence of steps for a fixed day and returns the closurePercent
 * trail (index 0 = before any step). Asserts nothing itself — callers decide
 * whether the trail must be monotonic (so the DEFECT scenarios can show
 * their actual, non-monotonic trail instead of a weakened assertion). */
function walk(initialTasks: PlannedTask[], steps: DayStep[]) {
    let logs: DailyLog[] = [];
    let tasks = initialTasks;
    const trail: { label: string; closurePercent: number }[] = [
        { label: 'start', closurePercent: computeDayState({ logs, crops: makeCrops(), tasks, date: TODAY }).closurePercent },
    ];
    for (const step of steps) {
        ({ logs, tasks } = step.apply(logs, tasks));
        trail.push({ label: step.label, closurePercent: computeDayState({ logs, crops: makeCrops(), tasks, date: TODAY }).closurePercent });
    }
    return trail;
}

function assertNonDecreasing(trail: { label: string; closurePercent: number }[]) {
    for (let i = 1; i < trail.length; i += 1) {
        expect(
            trail[i].closurePercent,
            `closurePercent fell from ${trail[i - 1].closurePercent} to ${trail[i].closurePercent} ` +
            `after "${trail[i].label}" (full trail: ${trail.map(t => `${t.label}=${t.closurePercent}`).join(' -> ')})`,
        ).toBeGreaterThanOrEqual(trail[i - 1].closurePercent);
    }
}

describe('computeDayState — closurePercent never falls within a day (founder decision 6)', () => {
    // ---- Scenarios that ARE monotonic today: the tripwire for Wave 3 -------

    it('owner-only day, zero planned tasks: two owner logs saved in sequence', () => {
        const trail = walk([], [logSaved('o1', true), logSaved('o2', true)]);
        assertNonDecreasing(trail);
    });

    it('owner-only day, non-zero planned tasks: answer credited then an owner log saved', () => {
        const trail = walk([makeTask('t1', 'pending')], [answerCredited('t1'), logSaved('o1', true)]);
        assertNonDecreasing(trail);
    });

    it('a mukadam log confirmed in isolation is itself non-decreasing (the confirm step alone)', () => {
        // Isolates JUST the confirm transition (VERIFIED never lowers the
        // score vs. staying PENDING) — the save itself is covered by the
        // DEFECT scenarios below.
        const trail = walk([], [logSaved('m1', false)]);
        const beforeConfirm = trail[trail.length - 1].closurePercent;
        const afterConfirm = walk([], [logSaved('m1', false), logConfirmed('m1')]);
        expect(afterConfirm[afterConfirm.length - 1].closurePercent).toBeGreaterThanOrEqual(beforeConfirm);
    });

    it('mixed operators, multiple answers credited then owner logs, zero mukadam activity: non-decreasing', () => {
        const trail = walk(
            [makeTask('t1', 'pending'), makeTask('t2', 'pending')],
            [answerCredited('t1'), answerCredited('t2'), logSaved('o1', true), logSaved('o2', true)],
        );
        assertNonDecreasing(trail);
    });

    // ---- DEFECT scenarios: closurePercent actually FALLS. Reported, not ---
    // ---- weakened (task brief Step 2). See EMPIRICAL FINDING above. -------

    it('DEFECT: zero planned tasks, a mukadam saves the day\'s first log (PENDING) — closurePercent falls 100 -> 70', () => {
        const trail = walk([], [logSaved('m1', false), logConfirmed('m1')]);
        expect(trail.map(t => t.closurePercent)).toEqual([100, 70, 100]);
        assertNonDecreasing(trail); // fails at step 1 (100 -> 70) — intentionally, see header.
    });

    it('DEFECT: a planned task is answered to 100, then a mukadam log lands PENDING — closurePercent falls 100 -> 70', () => {
        const trail = walk([makeTask('t1', 'pending')], [answerCredited('t1'), logSaved('m1', false), logConfirmed('m1')]);
        expect(trail.map(t => t.closurePercent)).toEqual([30, 100, 70, 100]);
        assertNonDecreasing(trail); // fails at step 2 (100 -> 70) — intentionally, see header.
    });

    it('DEFECT: owner already logged (100), then a mukadam log arrives PENDING — closurePercent falls 100 -> 85', () => {
        const trail = walk([], [logSaved('o1', true), logSaved('m1', false), logConfirmed('m1')]);
        expect(trail.map(t => t.closurePercent)).toEqual([100, 100, 85, 100]);
        assertNonDecreasing(trail); // fails at step 2 (100 -> 85) — intentionally, see header.
    });
});
