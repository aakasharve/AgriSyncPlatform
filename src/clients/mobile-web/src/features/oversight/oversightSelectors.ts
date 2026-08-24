/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * Owner Oversight Loop — pure selectors (Task 1).
 *
 * Derives the "what happened since I last checked" model an owner sees,
 * purely from already-loaded `DailyLog` records plus a handful of
 * pre-computed counts (unverified / dayNotClosed / failedSend) that belong
 * to other subsystems and are handed in rather than recomputed here.
 *
 * PURITY CONTRACT (binding):
 *  - No Dexie, no React, no `infrastructure/` imports.
 *  - No `new Date()` anywhere — `nowISO` is always a caller-supplied
 *    parameter, never read from the system clock inside this module.
 *  - Every number here is derived from the passed-in records; nothing is
 *    invented. Records whose creator was never captured go to
 *    `unattributed` and are NEVER folded into `people`, so the named-people
 *    tally stays honest (a person can only be counted if they were named).
 *
 * UNKNOWN IS NOT NONE (finding F8 — read before touching `waitingCount`):
 *  Keeping `unattributed` out of `people` is right for the PEOPLE tally
 *  (spec §P-F / DoD #6) and was wrong for the WAITING count. Every
 *  `createdByOperatorId` write site in this app is optional at the type
 *  level — `LogFactory.ts:238`/`:456` and `log-partition-builders.ts:279`/
 *  `:424` all copy `profile.activeOperatorId`, declared `activeOperatorId?:
 *  string` (`domain/types/farm.types.ts:325`) — so a farm can legitimately
 *  hold nothing but unattributed records. That farm used to produce
 *  `people = []`, `decisions = []` and therefore `waitingCount = 0`, which
 *  `CanonicalStrip` renders as the REST state: a green tick and "आज पर्यन्त
 *  सर्व कामे पूर्ण आहेत" ("all work is complete as of today") over records
 *  the owner had never seen, with no badge giving him a reason to open the
 *  drawer that was holding an `अज्ञात` row the whole time. A zero meaning
 *  UNKNOWN was being reported as NONE.
 *
 *  `waitingCount` therefore counts the unattributed BUCKET as the one row
 *  it actually renders as, exactly the way each named person counts as the
 *  one row they render as — derived from the records, never a literal, and
 *  never a fabricated person (the row stays nameless: `अज्ञात`, spec §P-F).
 *  The consequence that matters: `waitingCount === 0` is now reachable only
 *  when there are no decisions AND no unseen records of any kind.
 *
 * SERVER-TIMESTAMP DECISION (read before touching the "unseen" filter):
 *  The pure domain type `DailyLog` carries no server-received timestamp —
 *  that field (`serverModifiedAtUtc`) exists only on the Dexie *storage*
 *  record (`DexieLogRecord`, in `infrastructure/storage/DexieDatabase.ts`),
 *  which this module may not import (purity contract above). The function
 *  signature mandated for this task (see the task-1 brief) also carries no
 *  separate server-time lookup parameter — only `logs`, `checkpointISO` and
 *  `nowISO`. Given that signature, there is no path to a true server-received
 *  time here, so this selector always falls back to `log.meta?.createdAtISO`
 *  as the best-available "arrival" signal, and `boundaryApproximate` is
 *  therefore unconditionally `true` on every model this function returns.
 *  That is still a real, non-fabricated signal — it is the actual recorded
 *  creation time, just not provable server-receipt order — which is exactly
 *  why the flag exists: so the UI can soften its claim instead of the
 *  selector inventing one. A later task that threads a real server-time
 *  lookup through can flip this per-log without changing this field's
 *  meaning.
 */

import type { DailyLog } from '../../domain/types/log.types';

export interface OversightPerson {
    operatorId: string | null; // null = creator not captured
    name: string; // resolved name, or '' when operatorId is null
    recordCount: number;
    plotNames: string[]; // distinct, in first-seen order
    workCategories: OversightWorkCategory[];
}

export type OversightWorkCategory =
    | 'irrigation' | 'labour' | 'machinery' | 'inputs' | 'cropActivity' | 'observation';

export interface OversightDecision {
    kind: 'approval' | 'dayNotClosed' | 'failedSend';
    count: number;
    holderName: string | null; // non-null ONLY when approval is delegated away
}

export interface OversightModel {
    people: OversightPerson[]; // named people only
    unattributed: OversightPerson | null;
    totalRecords: number; // includes unattributed
    totalPlots: number; // distinct across everything
    decisions: OversightDecision[];
    /**
     * How many rows the drawer is holding for the owner: one per decision,
     * one per named person, and one for the unattributed bucket when it
     * exists. NOT a record count — `totalRecords` is that — and NOT a
     * people count, which is `people.length` and still excludes
     * `unattributed` (spec §P-F, DoD #6).
     *
     * The `unattributed` term is finding F8's fix: see the module header's
     * "UNKNOWN IS NOT NONE". Zero here must mean "genuinely nothing
     * outstanding", because zero is what turns the canonical strip into the
     * rest state — a positive claim that all work is complete.
     */
    waitingCount: number;
    sinceDays: number | null; // null when no checkpoint yet
    /**
     * Ruling 1 (controller override, task-1 brief §Controller rulings): the
     * brief's abbreviated TypeScript block omitted this field, but its rules
     * text mandates it, and the rules text wins. True whenever the "unseen"
     * boundary was computed from a fallback timestamp rather than a proven
     * server-received time. See the module-level SERVER-TIMESTAMP DECISION
     * comment — under this task's mandated function signature that fallback
     * is the only path available, so this is always `true` today.
     */
    boundaryApproximate: boolean;
}

/** The best "did this arrive after the checkpoint" signal available on the
 * pure domain type. See the module-level SERVER-TIMESTAMP DECISION comment —
 * `DailyLog` has no server-received timestamp, so this is `meta.createdAtISO`
 * (or `null` when even that was never recorded). */
function effectiveArrivalISO(log: DailyLog): string | null {
    return log.meta?.createdAtISO ?? null;
}

/** A log is unseen when its arrival signal is strictly after `checkpointISO`
 * (spec §P-C), OR when there is no checkpoint yet, OR when the log has no
 * arrival signal at all — an untimestamped record can never be proven
 * "already seen", so it stays visible rather than being silently dropped. */
function isUnseen(log: DailyLog, checkpointISO: string | null): boolean {
    if (checkpointISO === null) return true;
    const arrivalISO = effectiveArrivalISO(log);
    if (arrivalISO === null) return true;
    // ISO-8601 timestamps of consistent format compare lexicographically in
    // the same order as chronologically.
    return arrivalISO > checkpointISO;
}

/** Work categories present on a single log — only for arrays that are
 * actually non-empty, per the brief's rule. */
function categoriesForLog(log: DailyLog): OversightWorkCategory[] {
    const categories: OversightWorkCategory[] = [];
    if (log.irrigation && log.irrigation.length > 0) categories.push('irrigation');
    if (log.labour && log.labour.length > 0) categories.push('labour');
    if (log.machinery && log.machinery.length > 0) categories.push('machinery');
    if (log.inputs && log.inputs.length > 0) categories.push('inputs');
    if (log.cropActivities && log.cropActivities.length > 0) categories.push('cropActivity');
    if (log.observations && log.observations.length > 0) categories.push('observation');
    return categories;
}

/** Plot names a log touches, from `context.selection[].selectedPlotNames`,
 * in the order they appear on the log (duplicates handled by callers). */
function plotNamesForLog(log: DailyLog): string[] {
    const names: string[] = [];
    for (const selection of log.context?.selection ?? []) {
        for (const name of selection.selectedPlotNames ?? []) {
            names.push(name);
        }
    }
    return names;
}

/** Folds one log's contribution into a person bucket (named or
 * unattributed), keeping `plotNames` / `workCategories` distinct and in
 * first-seen order. */
function mergePersonRecord(
    person: OversightPerson,
    plotNames: string[],
    categories: OversightWorkCategory[],
): void {
    person.recordCount += 1;
    for (const name of plotNames) {
        if (!person.plotNames.includes(name)) person.plotNames.push(name);
    }
    for (const category of categories) {
        if (!person.workCategories.includes(category)) person.workCategories.push(category);
    }
}

/** Whole days between two ISO instants, floored, never negative. Only
 * called when `checkpointISO` is non-null (see `sinceDays` rule). */
function daysBetween(fromISO: string, toISO: string): number {
    const fromMs = Date.parse(fromISO);
    const toMs = Date.parse(toISO);
    return Math.max(0, Math.floor((toMs - fromMs) / 86_400_000));
}

export function buildOversightModel(input: {
    logs: DailyLog[]; // already filtered to the active farm
    checkpointISO: string | null;
    nowISO: string;
    operatorNameById: Record<string, string>;
    unverifiedCount: number;
    yesterdayNotClosed: boolean;
    failedSendCount: number;
    approvalHolderName: string | null;
}): OversightModel {
    const {
        logs,
        checkpointISO,
        nowISO,
        operatorNameById,
        unverifiedCount,
        yesterdayNotClosed,
        failedSendCount,
        approvalHolderName,
    } = input;

    const unseenLogs = logs.filter((log) => isUnseen(log, checkpointISO));

    const peopleOrder: string[] = [];
    const peopleById = new Map<string, OversightPerson>();
    let unattributed: OversightPerson | null = null;
    const allPlotNames = new Set<string>();

    for (const log of unseenLogs) {
        const logPlotNames = plotNamesForLog(log);
        for (const name of logPlotNames) allPlotNames.add(name);

        const logCategories = categoriesForLog(log);
        const operatorId = log.meta?.createdByOperatorId;

        if (!operatorId) {
            // Rule: absent creator -> unattributed, NEVER `people` (never
            // inflates the named-people tally).
            if (unattributed === null) {
                unattributed = {
                    operatorId: null,
                    name: '',
                    recordCount: 0,
                    plotNames: [],
                    workCategories: [],
                };
            }
            mergePersonRecord(unattributed, logPlotNames, logCategories);
            continue;
        }

        let person = peopleById.get(operatorId);
        if (!person) {
            person = {
                operatorId,
                name: operatorNameById[operatorId] ?? '',
                recordCount: 0,
                plotNames: [],
                workCategories: [],
            };
            peopleById.set(operatorId, person);
            peopleOrder.push(operatorId);
        }
        mergePersonRecord(person, logPlotNames, logCategories);
    }

    const people = peopleOrder.map((id) => peopleById.get(id) as OversightPerson);

    const decisions: OversightDecision[] = [];
    if (unverifiedCount > 0) {
        decisions.push({ kind: 'approval', count: unverifiedCount, holderName: approvalHolderName });
    }
    if (yesterdayNotClosed) {
        decisions.push({ kind: 'dayNotClosed', count: 1, holderName: null });
    }
    if (failedSendCount > 0) {
        decisions.push({ kind: 'failedSend', count: failedSendCount, holderName: null });
    }

    return {
        people,
        unattributed,
        totalRecords: unseenLogs.length,
        totalPlots: allPlotNames.size,
        decisions,
        // Finding F8 — the unattributed bucket is ONE waiting row, counted
        // like any other row, so unseen work with no captured creator can
        // never leave the strip claiming the rest state. See the module
        // header's "UNKNOWN IS NOT NONE".
        waitingCount: decisions.length + people.length + (unattributed === null ? 0 : 1),
        sinceDays: checkpointISO === null ? null : daysBetween(checkpointISO, nowISO),
        boundaryApproximate: true, // see module-level SERVER-TIMESTAMP DECISION
    };
}
