/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Task 6 (Ruling 12) — the ONLY place that reduces `AppContent`'s
 * `AppFeatureProviders`-scoped state (`data.history` / `data.crops` /
 * `data.farmerProfile.operators` / `data.plannedTasks`) down to the narrow,
 * primitive shape `AppHeader`'s `CanonicalStrip`/`WaitingDrawer` need. Pure —
 * no React, no Dexie — same "extracted from AppContent.tsx" pattern as
 * `appContentDailyCounts.ts` / `appContentContextDisplay.ts` beside it.
 *
 * WHY THIS EXISTS (Ruling 12, coordinator message 2026-08-16)
 * -------------------------------------------------------------
 * Task 6's first pass found `plotCount`/`logs`/`operatorNameById`/
 * `unverifiedCount`/`yesterdayNotClosed` genuinely unreachable from
 * `AppHeader` — it renders as a SIBLING of `<AppFeatureProviders>` in
 * `AppContent.tsx`, not a descendant. The founder ruled the preview must show
 * a real, non-empty briefing, so `AppContent.tsx` (where both trees ARE in
 * scope) now computes these and passes them down as narrow props — never a
 * second `useAppData()` instance, never `AppHeader` moved inside the provider
 * tree (both explicitly forbidden by the ruling).
 *
 * WHAT THIS DOES **NOT** SOLVE (state precisely, do not paper over — P3/P-F)
 * ----------------------------------------------------------------------------
 * `history`/`crops` come from `dataSource.{logs,crops}.getAll()`
 * (`useAppData.ts`), which return every record for the SIGNED-IN USER's
 * Dexie database (`activateDatabaseForUser(session.userId)`,
 * `DataSourceProvider.tsx`) — there is no `farmId` on `CropProfile`/`Plot`,
 * and `dataSource.{crops,logs}.getAll()` take no farm argument, so this data
 * is NOT scoped to `currentFarmId` for an account with more than one farm.
 * This is not a gap introduced here — every other consumer of
 * `data.history`/`data.crops` in this app (`getTodayCounts`,
 * `getTodayPlotData`, `ReflectPage`, `ComparePage` via `mainView.tsx`) has
 * the exact same characteristic today. Fixing true per-farm data isolation on
 * the frontend is a separate, larger change (a `farmId` field enforced at the
 * repository/query layer) that this task does not attempt. For the seeded
 * preview user (one farm), this is invisible; it becomes visible the moment
 * an account with 2+ farms exists.
 */
import type { CropProfile, DailyLog, FarmOperator, PlannedTask } from '../../types';
import { computeDayState } from '../../shared/utils/dayState';
import { getDateKey } from '../../core/domain/services/DateKeyService';
import { isOwnAutoSavedVoiceLog } from './autoSavedVoiceLog';

export interface OversightHeaderInputs {
    /** Sum of every crop's `plots.length` (spec §2.1's "४ प्लॉट" line). */
    plotCount: number;
    /** `operator.id -> operator.name`, straight off `farmerProfile.operators`
     * — the SAME list `AppHeader` already reads for `activeOperator`. */
    operatorNameById: Record<string, string>;
    // `unverifiedCount` (the phone's own tally of records awaiting approval) was here. Lane L4b fix round 1 deleted
    // it: the drawer's approval row is the farm's ONE server count (`approvalQueue`, founder D-40 §1), and nothing
    // read this one any more.
    /**
     * Mirrors `useAppRouterDerivations.ts`'s own `yesterdayDayState.isClosed`
     * computation exactly (same `computeDayState` call, same "yesterday" date
     * math, whole-farm scope) so this can never disagree with the "Day Not
     * Closed" card still on screen elsewhere in the app today.
     */
    yesterdayNotClosed: boolean;
}

/** Yesterday's date key, via the app's one `getDateKey` service — never a
 * second date-math implementation. */
function yesterdayDateKey(): string {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return getDateKey(date);
}

export function buildOversightHeaderInputs(
    history: DailyLog[],
    crops: CropProfile[],
    operators: FarmOperator[],
    plannedTasks: PlannedTask[],
    /** Who "you" are on this phone (active operator + signed-in user). Empty = nobody's own auto-saves known. */
    youIds: ReadonlySet<string> = new Set(),
): OversightHeaderInputs {
    const plotCount = crops.reduce((sum, crop) => sum + crop.plots.length, 0);

    const operatorNameById: Record<string, string> = {};
    for (const operator of operators) {
        operatorNameById[operator.id] = operator.name;
    }

    // spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — his OWN voice auto-save is not waiting on
    // anyone: it counts even if he never confirms it (founder decision 2026-09-02), and nothing behind this
    // row could confirm it for him (P5). So it does not hold a day open. Other people's logs count exactly as before.
    const reviewNotAwaited = (log: DailyLog) => isOwnAutoSavedVoiceLog(log, youIds);

    // MERGE RECONCILIATION (main <- feat/dfes-companion): `hasStarted` is now
    // part of the answer, not a refinement of it.
    //
    // This read `!isClosed` alone, which was correct while an EMPTY day counted
    // as closed — nothing to do, nothing outstanding. dfes-companion's wave-2.4
    // fix stopped an empty day scoring a vacuous 100/`isClosed`, precisely so a
    // day that never began stops being reported as a finished one. Read through
    // `!isClosed`, that same fix turns "yesterday did not happen" into
    // "yesterday is NOT CLOSED" and raises a decision row against a farmer who
    // has done nothing wrong — on day 1 of the pilot, for everyone.
    //
    // A day is one of THREE things (see `dayState.ts`), and only the middle one
    // is a decision: not started / not closed / closed. Both of this file's own
    // tests assert exactly that — the empty case raises no flag, and a day with
    // only TODAY's work raises none for yesterday.
    const yesterday = computeDayState({
        logs: history,
        crops,
        tasks: plannedTasks,
        date: yesterdayDateKey(),
        reviewNotAwaited,
    });
    const yesterdayNotClosed = yesterday.hasStarted && !yesterday.isClosed;

    return { plotCount, operatorNameById, yesterdayNotClosed };
}
