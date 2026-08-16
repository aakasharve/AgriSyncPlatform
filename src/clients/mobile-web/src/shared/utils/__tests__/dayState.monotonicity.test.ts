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
 * ============================================================================
 * WHAT THIS FILE DOES AND DOES NOT ASSERT (wave-1.6 review, I3)
 * ============================================================================
 * The headline above is the LAW. It is not, on its own, a description of this
 * file's coverage, and for one round it was read as if it were.
 *
 *   ASSERTED as law (`assertNonDecreasing`): a log saved, a log confirmed, an
 *   answer credited, a task appearing mid-day, a log re-opened — every
 *   scenario in this file, in every combination of owner/mukadam and planned/
 *   unplanned below. All nine are green and are the live regression tripwire.
 *
 * As of the 2026-08-16 rulings there is no longer a "measured but unruled"
 * tier in this file. The last two transitions that had one — a task appearing
 * mid-day and a human re-opening a log — were ruled DEFECTS and fixed; see
 * the RULINGS 21 & 22 block below.
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
 *
 * ============================================================================
 * WAVE 2.4 UPDATE — the defect above is FIXED (spec: dfes-companion-2026-07-11)
 * ============================================================================
 * The trails quoted in the EMPIRICAL FINDING are the HISTORICAL record of the
 * defect, kept verbatim so the diagnosis is not lost. They no longer describe
 * this file's behaviour. `dayState.ts` no longer scores a day with nothing in
 * it as vacuously complete: both halves of `closurePercent` are now built from
 * what HAS happened (the 70 needs a plan done or a record made; the 30 is
 * EARNED by a confirmation and is never revoked by unreviewed work landing).
 * All 7 scenarios below are green, `assertNonDecreasing` is untouched, and the
 * three formerly-red trails are re-pinned to their fixed values with the same
 * exact `toEqual` — see the block comment above them for why the old literals
 * and `assertNonDecreasing` could never both hold.
 *
 * ============================================================================
 * FOUNDER RULINGS 21 & 22 (2026-08-16) — decision 6 is now ABSOLUTE
 * ============================================================================
 * The two transitions this file MEASURED and declined to decide (a task
 * appearing mid-day, a log re-opened) have been ruled on. Both are defects.
 *
 *   RULING 21 — AI has NO role in scoring. Founder's words: "AI has no role in
 *   it. AI is only being used for parsing and sorting." Sathi turning what the
 *   farmer SAID into a task must not create an obligation he is then measured
 *   against, so an AI-authored task no longer enters the denominator the score
 *   is computed from. It is still counted in `plannedCount`/`pendingCount` and
 *   still appears in his task list — this is about the score, not the UI.
 *
 *   RULING 22 — the number preserves or improves, never takes back. Founder's
 *   words: "it must preserve or improve, nothing to take back, only append if
 *   the context is same, treat each log separate, only the re-talk on same log
 *   treat that append." Re-opening a log withdraws its CURRENT confirmation,
 *   not the fact that a confirmation was earned. The 30 stays.
 *
 * HISTORICAL RECORD — the trails those two scenarios measured before the
 * rulings, preserved verbatim the way the EMPIRICAL FINDING block above was
 * (they no longer describe this file's behaviour):
 *
 *   0 logs, 0 tasks                                  -> closurePercent   0
 *   + owner's own log (auto-APPROVED)                 -> closurePercent 100
 *   + an AI-extracted task appears, due today          -> closurePercent  30  ◄ DROP
 *
 *   0 logs, 0 tasks                                  -> closurePercent   0
 *   + owner's own log (auto-APPROVED)                 -> closurePercent 100
 *   that same log re-opened by a human                 -> closurePercent  70  ◄ DROP
 *
 * Both are now [0, 100, 100] and both call `assertNonDecreasing`, like the
 * other seven. Nothing was loosened to get there: each trail is still pinned
 * as an exact sequence with the same `toEqual`, and the law assertion was
 * ADDED to them, not removed from anything.
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

/** The instant a confirmation is stamped onto a log. `LogFactory` writes
 * `verifiedAtISO: isOwner ? nowISO : undefined` (LogFactory.ts:341/479/712/846)
 * — a confirmation leaves a timestamp, an unreviewed log has none. Ruling 22
 * turns on exactly that distinction, so the fixtures carry it. */
const CONFIRMED_AT = `${TODAY}T09:00:00.000Z`;

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
        // (non-owner) log starts PENDING until the owner reviews it. Only the
        // auto-confirmed one carries `verifiedAtISO`, exactly as LogFactory
        // writes it.
        verification: {
            status,
            required: status !== LogVerificationStatus.APPROVED,
            ...(status === LogVerificationStatus.APPROVED ? { verifiedAtISO: CONFIRMED_AT } : {}),
        },
    };
}

/** `sourceType` defaults to `'manual'` — a task the FARMER put on his own day,
 * which is what every scenario titled "planned task" below means. The one
 * scenario about an AI-authored task passes `'ai_extracted'` explicitly (see
 * `taskAppeared`), so ruling 21's exclusion is exercised where it belongs and
 * nowhere else. Before the rulings every fixture task here was `ai_extracted`,
 * which was incidental — nothing read `sourceType`. It is read now. */
function makeTask(
    id: string,
    status: PlannedTask['status'],
    sourceType: PlannedTask['sourceType'] = 'manual',
): PlannedTask {
    return {
        id,
        title: `task-${id}`,
        plotId: 'plot-a',
        cropId: 'crop-grapes',
        priority: 'normal',
        status,
        sourceType,
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
        logs: logs.map(log => (log.id === id
            ? { ...log, verification: { status: LogVerificationStatus.VERIFIED, required: false, verifiedAtISO: CONFIRMED_AT } }
            : log)),
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

// ---- The two transitions walk() could not reach (wave-1.6 review, I3) -------
//
// Until these existed, `walk()` only ever ADDED logs, confirmed logs and
// credited answers — every step it could take moved a numerator up. So the
// headline of this file ("the number never goes backwards within a day") was
// broader than what it actually tested: two real paths lower `closurePercent`
// and neither could be expressed. Both are legitimate things that happen on a
// farmer's day, and both are inside the day, not across days:
//
//   • a task APPEARS mid-day. `plannedCount` is not fixed at dawn —
//     `getTaskCompletion` counts every task due today, and Sathi creates
//     `ai_extracted` tasks from what the farmer says (dayState.ts:415-417).
//     A task landing widens `taskScore`'s denominator after the numerator has
//     already been counted.
//   • a log is RE-OPENED. `verifiedCount` is not a ratchet: an owner who
//     re-opens a day he had confirmed (the same act `DailyLog.Edit` performs
//     server-side, which walks an attested day back to Draft) removes the
//     confirmation the 30 was earned by.

const taskAppeared = (id: string): DayStep => ({
    label: `AI-extracted task appeared mid-day [${id}]`,
    apply: (logs, tasks) => ({ logs, tasks: [...tasks, makeTask(id, 'pending', 'ai_extracted')] }),
});

/** A re-open walks the STATUS back to DRAFT. It does not un-happen the
 * confirmation: `verifiedAtISO` (the stamp the confirmation left) survives,
 * because the sync path rebuilds `verification` from the log's append-only
 * `verificationEvents` (logsReconciler.ts:153-157, 261-267) and an earlier
 * confirmation is still one of them. That surviving stamp is the whole
 * difference between "re-opened" and "never reviewed" — a log that was never
 * confirmed has no stamp at all (see `makeLog`), so ruling 22 cannot hand out
 * credit for a confirmation that never existed. */
const logReopened = (id: string): DayStep => ({
    label: `log re-opened by a human [${id}]`,
    apply: (logs, tasks) => ({
        logs: logs.map(log => (log.id === id
            ? {
                ...log,
                verification: {
                    status: LogVerificationStatus.DRAFT,
                    required: true,
                    verifiedAtISO: log.verification?.verifiedAtISO,
                },
            }
            : log)),
        tasks,
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
        assertNonDecreasing(afterConfirm);
    });

    it('mixed operators, multiple answers credited then owner logs, zero mukadam activity: non-decreasing', () => {
        const trail = walk(
            [makeTask('t1', 'pending'), makeTask('t2', 'pending')],
            [answerCredited('t1'), answerCredited('t2'), logSaved('o1', true), logSaved('o2', true)],
        );
        assertNonDecreasing(trail);
    });

    // ---- The three sequences that PROVED the defect (wave-1.6) — now fixed --
    //
    // WAVE 2.4 UPDATE (spec: dfes-companion-2026-07-11). These three scenarios
    // each carried TWO assertions, and they were mutually unsatisfiable by
    // construction:
    //
    //   1. `toEqual([100, 70, 100])` etc. — a literal SNAPSHOT of the trail the
    //      defect produced. The documentation half.
    //   2. `assertNonDecreasing(trail)` — founder decision 6. The law half.
    //
    // `[100, 70, 100]` is not a non-decreasing sequence, so no implementation
    // could ever satisfy both. The literals recorded the defect; the
    // `assertNonDecreasing` forbade it. Fixing the defect necessarily means the
    // literals move — they are re-pinned below to the FIXED trail, exactly as
    // tightly as before (same `toEqual`, same length, every value spelled out).
    // Nothing is loosened: not one `assertNonDecreasing` is removed or relaxed,
    // no assertion is deleted, and each new trail is stated as an exact
    // sequence, so any future regression still fails here. The old numbers are
    // preserved above in the EMPIRICAL FINDING header as the historical record.
    //
    // Root cause removed (dayState.ts): a day with nothing in it no longer
    // scores a vacuous 100 — `taskScore`/`verificationScore` are now built from
    // what HAS happened, so the number starts at 0 and only ever fills.

    it('zero planned tasks, a mukadam saves the day\'s first log (PENDING): 0 -> 70 -> 100, never backwards', () => {
        const trail = walk([], [logSaved('m1', false), logConfirmed('m1')]);
        // Was [100, 70, 100] — the empty day claimed completeness, then the
        // mukadam's first log knocked 30 off the OWNER's ring. Now the empty
        // day scores nothing (0), recording the day earns the 70, and the
        // owner confirming it earns the remaining 30.
        expect(trail.map(t => t.closurePercent)).toEqual([0, 70, 100]);
        assertNonDecreasing(trail);
    });

    it('a planned task is answered, then a mukadam log lands PENDING: 0 -> 70 -> 70 -> 100, never backwards', () => {
        const trail = walk([makeTask('t1', 'pending')], [answerCredited('t1'), logSaved('m1', false), logConfirmed('m1')]);
        // Was [30, 100, 70, 100] — the 30 was a free "nothing to verify" credit
        // that got REPLACED (not floored) the moment a real log arrived. Now
        // the untouched task scores 0, answering it earns the 70, the mukadam's
        // pending log is work IN FLIGHT (neither adds nor subtracts — the flat
        // 70 -> 70 step IS the fix), and confirming it earns the 30.
        expect(trail.map(t => t.closurePercent)).toEqual([0, 70, 70, 100]);
        assertNonDecreasing(trail);
    });

    it('owner already logged, then a mukadam log arrives PENDING: 0 -> 100 -> 100 -> 100, never backwards', () => {
        const trail = walk([], [logSaved('o1', true), logSaved('m1', false), logConfirmed('m1')]);
        // Was [100, 100, 85, 100]. The owner's own auto-APPROVED log still
        // takes the day to 100 (wave-1.2's guarantee, dayState.ownerConfirm).
        // A mukadam's log arriving no longer dilutes that: verification credit
        // is EARNED and never revoked by unreviewed work landing. The day is
        // still not `isClosed` and the review queue still shows the one waiting
        // log — completeness is carried there, not by pulling the ring down.
        expect(trail.map(t => t.closurePercent)).toEqual([0, 100, 100, 100]);
        assertNonDecreasing(trail);
    });

    // ---- The two paths walk() could not reach until wave-1.6 measured them
    // ---- (review I3), and the founder ruled on 2026-08-16. Both were defects.
    //
    // These were never regressions from wave 2.4 — both predate it and both
    // survived it, because 2.4 only ever changed what an EMPTY day scores. They
    // were pinned here with `toEqual` + `toBeLessThan` and deliberately WITHOUT
    // `assertNonDecreasing`, because that helper IS founder decision 6 and
    // decision 6 had not been extended to them; picking the assertion would
    // have been this file deciding a founder question. It has now been decided,
    // so both call the helper like the other seven and the drop assertions are
    // gone — there is no drop left to assert.
    //
    // RULING 21 — an AI-authored task is not an obligation. It no longer enters
    // the denominator the score is built from (`dayState.ts` — `isScoredObligation`).
    // The farmer did nothing but SPEAK; Sathi sorting his words into a task
    // cannot cost him 70 points. The task is NOT hidden: `plannedCount`,
    // `pendingCount`, `isClosed` and the task list all still carry it, so a
    // genuinely un-started AI task is still visible — just not scored.
    //
    // RULING 22 — a re-open withdraws the current confirmation, not the fact
    // that one was earned. The 30 stays. A log that was never confirmed still
    // earns nothing (the mukadam-PENDING scenarios above stay at 70), so this
    // cannot make the ring claim a day is verified when nothing ever was.

    it('an AI-extracted task appears mid-day: 0 -> 100 -> 100, never backwards (ruling 21)', () => {
        const trail = walk([], [logSaved('o1', true), taskAppeared('t-new')]);
        // Was [0, 100, 30] — the owner recorded his day (70 for the record +
        // 30 for his own auto-approved confirmation), then Sathi extracted a
        // task from what he had just said, `plannedCount` went 0 -> 1 with
        // `completedCount` still 0, taskScore collapsed 1 -> 0 and the 70
        // evaporated. Nothing the farmer did got worse; the denominator moved.
        // AI now has no vote in the denominator, so the step is flat.
        expect(trail.map(t => t.closurePercent)).toEqual([0, 100, 100]);
        assertNonDecreasing(trail);
    });

    it('an owner re-opens the day he had confirmed: 0 -> 100 -> 100, never backwards (ruling 22)', () => {
        const trail = walk([], [logSaved('o1', true), logReopened('o1')]);
        // Was [0, 100, 70] — the 30 was earned by a confirmation being CURRENT,
        // so walking the status back took the credit with it. The credit is now
        // earned by a confirmation having HAPPENED, which a re-open cannot
        // un-happen. The day is still openly unfinished elsewhere: `isClosed`
        // goes back to false and the re-opened log returns to the review queue.
        expect(trail.map(t => t.closurePercent)).toEqual([0, 100, 100]);
        assertNonDecreasing(trail);
    });
});
