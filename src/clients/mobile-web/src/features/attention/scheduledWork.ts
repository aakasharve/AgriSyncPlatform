/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — the scheduled steps the server says
 * need the farmer today: due today, or late (`GetAttentionBoardHandler` + `ScheduledWorkMatcher`: matched to
 * recorded work one-to-one, by kind of work and by the farm's India date).
 *
 * The list rides the sync pull (`attentionBoard.scheduledWork`) and is kept in `appMeta` under one key
 * (`attentionBoardReconciler.ts`). `null` = this phone holds no list from the server (never pulled, or an
 * older server that does not send one) — never read as "nothing is late".
 *
 * A step clears only when the server says so (the work was recorded and matched, or the step was moved to a
 * new day). The one local exception: a "पुढे ठरवा" the server has CONFIRMED (HTTP 200) hides that step at
 * once, until the next pull brings the server's own answer (`markRescheduled`). Opening a step clears nothing.
 */
import type { CompareCategory } from '../compare/comparePageHelpers';
import { plannedLabelMr } from '../compare/compareText';

export const SCHEDULED_WORK_META_KEY = 'shramsafal_attention_scheduled_work_v1';

export interface ScheduledWorkItem {
    plannedActivityId: string;
    farmId: string;
    plotId: string;
    plotName: string;
    cropCycleId: string;
    activityName: string;
    stage: string;
    /** "yyyy-MM-dd" — the farm's own day. */
    plannedDate: string;
    /** 0 = today's step. */
    daysLate: number;
    /** Past its on-time window (the server's rule): a decision is needed. */
    isMissed: boolean;
}

export interface StoredScheduledWork {
    items: ScheduledWorkItem[];
    /** When the server computed the list (the board's `asOfUtc`, else the pull time). */
    asOfUtc: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

/** One wire / stored row, or `null` when it is not a whole row (never guessed into one). */
export function scheduledWorkItemOf(value: unknown): ScheduledWorkItem | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (!isText(v.plannedActivityId) || !isText(v.farmId) || !isText(v.plotId) || !isText(v.activityName) || !isText(v.plannedDate)) return null;
    if (typeof v.daysLate !== 'number' || !Number.isInteger(v.daysLate) || v.daysLate < 0) return null;
    return {
        plannedActivityId: v.plannedActivityId,
        farmId: v.farmId,
        plotId: v.plotId,
        plotName: typeof v.plotName === 'string' ? v.plotName : '',
        cropCycleId: typeof v.cropCycleId === 'string' ? v.cropCycleId : '',
        activityName: v.activityName,
        stage: typeof v.stage === 'string' ? v.stage : '',
        plannedDate: v.plannedDate.slice(0, 10),
        daysLate: v.daysLate,
        isMissed: v.isMissed === true,
    };
}

/** The stored list, or `null` when nothing (or nothing readable) is stored. */
export function storedScheduledWorkOf(value: unknown): StoredScheduledWork | null {
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (!Array.isArray(v.items)) return null;
    return {
        items: v.items.map(scheduledWorkItemOf).filter((x): x is ScheduledWorkItem => x !== null),
        asOfUtc: typeof v.asOfUtc === 'string' ? v.asOfUtc : '',
    };
}

/**
 * The server's kind-of-work words (`CompareEngine.Categorize`), mirrored ONLY to choose the Marathi fallback
 * word when the step's English name is not one the app knows. It never decides anything.
 */
export function categoryOfStep(name: string): CompareCategory {
    const n = name.trim().toLowerCase();
    if (n.includes('spray') || n.includes('pesticide') || n.includes('fungicide')) return 'SPRAY';
    if (n.includes('fert') || n.includes('urea') || n.includes('dap') || n.includes('nutri')) return 'NUTRITION';
    if (n.includes('irrig') || n.includes('water')) return 'IRRIGATION';
    return 'ACTIVITY';
}

/** The step in Marathi: "फवारणी", "ठिबकने पाणी" — never the schedule's English (language-strict rule). */
export const stepLabelMr = (item: Pick<ScheduledWorkItem, 'activityName'>): string =>
    plannedLabelMr(item.activityName, categoryOfStep(item.activityName));

/** "आज" / "काल" / "5 दिवस उशीर". PROPOSED (Marathi) */
export function stepDueTextMr(daysLate: number): string {
    if (daysLate <= 0) return 'आज';
    if (daysLate === 1) return 'काल';
    return `${daysLate} दिवस उशीर`;
}

// ── "पुढे ठरवा" the server confirmed, hidden until the next pull answers for itself ──────────────────────
const rescheduledAt = new Map<string, number>();
const listeners = new Set<() => void>();

export function markRescheduled(plannedActivityId: string, at: number = Date.now()): void {
    rescheduledAt.set(plannedActivityId, at);
    listeners.forEach(l => l());
}

/** Hidden only while the list on the phone is OLDER than the confirmed move; a newer pull is the truth. */
export function isRescheduledLocally(plannedActivityId: string, listAsOfUtc: string): boolean {
    const at = rescheduledAt.get(plannedActivityId);
    if (at === undefined) return false;
    const asOf = Date.parse(listAsOfUtc);
    return Number.isNaN(asOf) || asOf < at;
}

export function onRescheduledChange(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Tests only. */
export function clearRescheduledForTests(): void {
    rescheduledAt.clear();
}
