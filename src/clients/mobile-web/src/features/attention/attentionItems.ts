/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — the ONE list behind लक्ष द्या. The page,
 * the bottom-bar count and the आढावा strip are all read from this, so the three can never disagree (D-1: "Both
 * should show the same underlying items"). Pure.
 *
 * Founder D-1, three groups, most urgent first:
 *   1. वेळ निघून गेली — reminders whose day has passed, and scheduled steps that are late but still inside the
 *      server's on-time window ("कालची फवारणी बाकी आहे");
 *   2. आज करायचे      — today's reminders and today's scheduled steps;
 *   3. निर्णय घ्यायचा  — steps past their on-time window (missed: record it, or set a new day), and the
 *      server's plot cards that ask for a look or a decision (tests due, a stage falling behind, a signal).
 *
 * Kept OUT, on purpose (D-1): routine approvals and disputed records — they belong in मंजुरी, and this page
 * carries no shortcut to it. A dispute card (`ResolveDispute`) is therefore never listed.
 *
 * Where each number comes from (P4): reminders = this phone's to-do store (the same items करायची कामे lists);
 * steps = the server's `scheduledWork` list; cards = the server's board. Nothing is counted that is not an
 * item on the page. When the server sent no step list (an older server), a card about late work keeps its
 * place in group 3 with its own count, exactly as before — never dropped, never itemised by guess.
 */
import type { AttentionCardCacheRecord } from '../../infrastructure/storage/DexieDatabase';
import type { TodoItem } from '../reflect/overview/todoModel';
import { fromDateKey, offsetOf } from '../reflect/overview/reflectDates';
import { attentionRankOrder, suggestedActionOf } from './attentionWire';
import { isRescheduledLocally, stepDueTextMr, stepLabelMr, type ScheduledWorkItem, type StoredScheduledWork } from './scheduledWork';

export type AttentionGroupKey = 'late' | 'today' | 'decide';

export type AttentionItem =
    | { kind: 'reminder'; id: string; group: 'late' | 'today'; daysLate: number; todo: TodoItem }
    | { kind: 'step'; id: string; group: AttentionGroupKey; daysLate: number; step: ScheduledWorkItem; label: string; dueText: string }
    | { kind: 'card'; id: string; group: 'decide'; card: AttentionCardCacheRecord };

export interface AttentionCounts {
    lateSteps: number;
    lateReminders: number;
    todaySteps: number;
    todayReminders: number;
    decisions: number;
}

export interface AttentionModel {
    late: AttentionItem[];
    today: AttentionItem[];
    decide: AttentionItem[];
    /** Every item on the page — the bottom-bar count. */
    total: number;
    counts: AttentionCounts;
}

export interface AttentionInput {
    cards: readonly AttentionCardCacheRecord[];
    /** `null` — the phone holds no step list from the server. */
    scheduledWork: StoredScheduledWork | null;
    /** The to-do store's open reminders, as करायची कामे groups them (`buildTodoList`). */
    todos: { late: readonly TodoItem[]; today: readonly TodoItem[] };
    /** The farm on screen; `null` keeps every farm's rows (no farm chosen yet). */
    farmId: string | null;
    todayKey: string;
}

/** Card actions whose whole content is late scheduled work — itemised by the step list when there is one. */
const LATE_WORK_ACTIONS = new Set(['ReviewOverdueTasks']);

function keepCard(card: AttentionCardCacheRecord, stepsKnown: boolean): boolean {
    const action = suggestedActionOf(card.suggestedAction);
    if (action === 'ResolveDispute') return false; // D-1: disputes stay in मंजुरी
    if (!stepsKnown) return true;
    if (action && LATE_WORK_ACTIONS.has(action)) return false;
    // "N काम थोडे उशीर" — an OpenPlot card raised only by late work.
    if (action === 'OpenPlot' && (card.overdueTaskCount ?? 0) > 0) return false;
    return true;
}

const reminderDaysLate = (t: TodoItem, todayKey: string): number => {
    const due = t.task.dueDate?.slice(0, 10);
    if (!due) return 0;
    return Math.max(0, -offsetOf(fromDateKey(due), fromDateKey(todayKey)));
};

const stepItem = (step: ScheduledWorkItem): AttentionItem => ({
    kind: 'step',
    id: `step-${step.plannedActivityId}`,
    group: step.daysLate === 0 ? 'today' : step.isMissed ? 'decide' : 'late',
    daysLate: step.daysLate,
    step,
    label: stepLabelMr(step),
    dueText: stepDueTextMr(step.daysLate),
});

const byLateness = (a: AttentionItem, b: AttentionItem): number =>
    ('daysLate' in b ? b.daysLate : 0) - ('daysLate' in a ? a.daysLate : 0);

export function buildAttentionModel({ cards, scheduledWork, todos, farmId, todayKey }: AttentionInput): AttentionModel {
    const onFarm = (rowFarmId: string) => farmId === null || rowFarmId === farmId;
    const stepsKnown = scheduledWork !== null;

    const steps = (scheduledWork?.items ?? [])
        .filter(s => onFarm(s.farmId) && !isRescheduledLocally(s.plannedActivityId, scheduledWork!.asOfUtc))
        .map(stepItem);

    const reminders = (group: 'late' | 'today', list: readonly TodoItem[]): AttentionItem[] =>
        list.filter(t => !t.done).map(t => ({ kind: 'reminder', id: `todo-${t.id}`, group, daysLate: reminderDaysLate(t, todayKey), todo: t }));

    const cardItems: AttentionItem[] = cards
        .filter(c => onFarm(c.farmId) && keepCard(c, stepsKnown))
        .sort((a, b) => attentionRankOrder(a.rank) - attentionRankOrder(b.rank))
        .map(card => ({ kind: 'card', id: `card-${card.cardId}`, group: 'decide', card }));

    // Stable within a lateness tie: steps before reminders (the schedule is the farm's plan), then input order.
    const late = [...steps.filter(s => s.group === 'late'), ...reminders('late', todos.late)].sort(byLateness);
    const today = [...steps.filter(s => s.group === 'today'), ...reminders('today', todos.today)];
    const decide = [...steps.filter(s => s.group === 'decide').sort(byLateness), ...cardItems];

    const count = (list: AttentionItem[], kind: AttentionItem['kind']) => list.filter(i => i.kind === kind).length;
    return {
        late,
        today,
        decide,
        total: late.length + today.length + decide.length,
        counts: {
            lateSteps: count(late, 'step'),
            lateReminders: count(late, 'reminder'),
            todaySteps: count(today, 'step'),
            todayReminders: count(today, 'reminder'),
            decisions: decide.length,
        },
    };
}

/**
 * The strip's count line, most urgent kind first, only the kinds that are there:
 * "2 कामे उशिराची · 1 आठवण आज" (the founder's own example, D-1). PROPOSED (Marathi)
 */
export function attentionSummaryMr(counts: AttentionCounts): string {
    const one = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
    const parts: string[] = [];
    if (counts.lateSteps) parts.push(one(counts.lateSteps, 'काम उशिराचे', 'कामे उशिराची'));
    if (counts.lateReminders) parts.push(one(counts.lateReminders, 'आठवण उशिराची', 'आठवणी उशिराच्या'));
    if (counts.todaySteps) parts.push(one(counts.todaySteps, 'काम आज', 'कामे आज'));
    if (counts.todayReminders) parts.push(one(counts.todayReminders, 'आठवण आज', 'आठवणी आज'));
    if (counts.decisions) parts.push(one(counts.decisions, 'निर्णय बाकी', 'निर्णय बाकी'));
    return parts.join(' · ');
}

/** The single most urgent item's words for the strip: "फवारणी · प्लॉट 2 — काल". PROPOSED (Marathi) */
export function mostUrgentLineMr(model: AttentionModel): string | null {
    const first = model.late[0] ?? model.today[0] ?? model.decide[0];
    if (!first) return null;
    if (first.kind === 'step') return `${first.label}${first.step.plotName ? ` · ${first.step.plotName}` : ''} — ${first.dueText}`;
    if (first.kind === 'reminder') return `${first.todo.title} — ${first.todo.dueText}`;
    return first.card.titleMr?.trim() || null;
}
