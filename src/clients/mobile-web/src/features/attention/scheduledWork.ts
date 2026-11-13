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
import { z } from 'zod';
import type { CompareCategory } from '../compare/comparePageHelpers';
import { plannedLabelMr } from '../compare/compareText';
import { toDevanagariDigits } from '../../shared/utils/marathiDigits';

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
    // ── spec: plr-d10 lane ATT-W (founder L8-C1 note: "with proof and the reason") ─────────────────────────────
    // WHY the step is on the list. Present only for a step a FOLLOWED schedule asks, from a server that sends them; read WHOLE
    // or not at all (`whyOf`): one malformed member and none of them is kept, so a line is never built from half a story.
    /** The followed schedule that asks this step; a move of the step goes to the schedule-step route with it. */
    subscriptionId?: string;
    scheduleName?: string;
    /** The OTHER followed schedules that ask the same work the same day, still open (shown once, never twice). */
    alsoAskedBy?: string[];
    /** The plot's real last record of the same kind, "yyyy-MM-dd"; `null` = the server says there is none; absent = not said. */
    lastSameWorkDate?: string | null;
    /** How often the schedule stores the work: `every_n_days:N` / `per_week:N`; `null` = none stored. */
    repeatText?: string | null;
    reasonKey?: 'DueToday' | 'Late' | 'Missed';
    /** The schedule activity and the day the schedule itself asks it - what a move names. */
    activityId?: string;
    originalDate?: string;
    /** The schedule's own day number ("दिवस 34"). */
    scheduleDay?: number;
}

export interface StoredScheduledWork {
    items: ScheduledWorkItem[];
    /** When the server computed the list (the board's `asOfUtc`, else the pull time). */
    asOfUtc: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}/).transform(s => s.slice(0, 10));
const nonEmpty = z.string().trim().min(1);

/**
 * spec: plr-d10 lane ATT-W - the why-members of a step, WHOLE OR NOTHING (Zod). An older server sends none of them (absent: no line, never
 * an error); a member that is there but not the right shape drops all of them. `lastSameWorkDate` keeps its null (the server said "no
 * record") apart from its absence (the server said nothing).
 */
const WhySchema = z.object({
    scheduleName: nonEmpty,
    scheduleDay: z.number().int(),
    reasonKey: z.enum(['DueToday', 'Late', 'Missed']),
    alsoAskedBy: z.array(nonEmpty).nullish().transform(v => (v && v.length > 0 ? v : undefined)),
    lastSameWorkDate: dateKey.nullable().optional(),
    repeatText: z.string().trim().min(1).nullable().optional(),
});

export type ScheduledWhy = Pick<
    ScheduledWorkItem,
    'scheduleName' | 'scheduleDay' | 'reasonKey' | 'alsoAskedBy' | 'lastSameWorkDate' | 'repeatText'
>;

/**
 * spec: plr-d10 lane ATT-W fix round 1 (P009) - WHERE a step moves, read on its OWN, never inside the why: the three ids "पुढे ठरवा" sends
 * to the schedule-step route. A malformed why-member (a bad last-record day, say) must not send the move to the planned-activity door with
 * an id that is not a planned activity. Whole or nothing among the three themselves; `null` = not a followed schedule's step (or an older
 * server): the step goes to today's override route.
 */
const RoutingSchema = z.object({ subscriptionId: nonEmpty, activityId: nonEmpty, originalDate: dateKey });

export type ScheduledRouting = Pick<ScheduledWorkItem, 'subscriptionId' | 'activityId' | 'originalDate'>;

export function routingOf(v: Record<string, unknown>): ScheduledRouting | null {
    const parsed = RoutingSchema.safeParse(v);
    return parsed.success ? parsed.data : null;
}

/** The why-members of a wire / stored row, or `null` (an older server, or a member that is not whole) - never throws. */
export function whyOf(v: Record<string, unknown>): ScheduledWhy | null {
    const parsed = WhySchema.safeParse(v);
    if (!parsed.success) return null;
    const { alsoAskedBy, lastSameWorkDate, repeatText, ...rest } = parsed.data;
    return {
        ...rest,
        ...(alsoAskedBy ? { alsoAskedBy } : {}),
        ...(lastSameWorkDate !== undefined ? { lastSameWorkDate } : {}),
        ...(repeatText !== undefined ? { repeatText } : {}),
    };
}

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
        ...(routingOf(v) ?? {}),
        ...(whyOf(v) ?? {}),
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

/**
 * The step in Marathi: "फवारणी", "ठिबकने पाणी" — never the schedule's English (language-strict rule). A name that is ALREADY Marathi (a followed
 * schedule's own title, spec: plr-d10 lane ATT-W; a locally added row typed in Marathi) is the farmer's own word and is kept as it is; before
 * this it fell to the kind-of-work word ("काम") and a line like "दिवस ३४ ला …" said nothing about which work.
 */
export const stepLabelMr = (item: Pick<ScheduledWorkItem, 'activityName'>): string =>
    /[\u0900-\u097F]/.test(item.activityName)
        ? item.activityName.trim()
        : plannedLabelMr(item.activityName, categoryOfStep(item.activityName));

/** "आज" / "काल" / "५ दिवस उशीर" (Devanagari digits, founder D-123b). PROPOSED (Marathi) */
export function stepDueTextMr(daysLate: number): string {
    if (daysLate <= 0) return 'आज';
    if (daysLate === 1) return 'काल';
    return `${toDevanagariDigits(daysLate)} दिवस उशीर`;
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
