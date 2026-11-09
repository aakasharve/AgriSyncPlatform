/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I22, founder D-1) — the ONE list behind लक्ष द्या. The page,
 * the bottom-bar count and the आढावा strip are all read from this, so the three can never disagree (D-1: "Both
 * should show the same underlying items"). Pure.
 *
 * Founder D-1, three groups, most urgent first (lane IT5 puts "आधी हे पाहा" above them: a wrong mix in one tank, see below):
 *   1. वेळ निघून गेली — reminders whose day has passed, and scheduled steps that are late but still inside the
 *      server's on-time window ("कालची फवारणी बाकी आहे");
 *   2. आज करायचे      — today's reminders and today's scheduled steps;
 *   3. निर्णय घ्यायचा  — steps past their on-time window (missed: record it, or set a new day), and the
 *      server's plot cards that ask for a look or a decision (tests due, a stage falling behind, a signal).
 *
 * "आधी हे पाहा" (lane IT5, spec dfes-input-truth-and-mix-check-2026-11-06): the server's open wrong-mix alerts - a card whose top
 * signal is `compliance.input-mix.never-together` - sit in their own group above the others. A card from an older server (no
 * rule code) or with another rule stays in "निर्णय घ्यायचा" exactly as before. The group is empty in production until a person has
 * reviewed the mixing rules (D-96): the server emits no such alert before then.
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
import { toMarathiDigits } from '../labour/marathiDate';
import { toDevanagariDigits } from '../../shared/utils/marathiDigits';
import { isRescheduledLocally, stepDueTextMr, stepLabelMr, type ScheduledWorkItem, type StoredScheduledWork } from './scheduledWork';

// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT5, Task 1) - `first`: "आधी हे पाहा", a wrong mix in one tank, above everything.
export type AttentionGroupKey = 'first' | 'late' | 'today' | 'decide';

export type AttentionItem =
    | { kind: 'reminder'; id: string; group: 'late' | 'today'; daysLate: number; todo: TodoItem }
    | { kind: 'step'; id: string; group: 'late' | 'today' | 'decide'; daysLate: number; step: ScheduledWorkItem; label: string; dueText: string }
    | { kind: 'card'; id: string; group: 'first' | 'decide'; card: AttentionCardCacheRecord };

export interface AttentionCounts {
    lateSteps: number;
    lateReminders: number;
    todaySteps: number;
    todayReminders: number;
    decisions: number;
    /** lane IT5: the "आधी हे पाहा" cards. Optional so a caller that builds counts by hand (a test) is unchanged. */
    firstAlerts?: number;
}

export interface AttentionModel {
    /** lane IT5 (Task 1): "आधी हे पाहा" - the server's open wrong-mix alerts, above the late work. */
    first: AttentionItem[];
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
    /** lane IT5: signals he tapped पाहिलं on (id to the time of the tap, ms) - see `seenSignals.ts`. */
    seenSignals?: ReadonlyMap<string, number>;
    /** lane IT5 fix 1 (F4): signals whose "पाहिलं" is queued and on its way - hidden whatever the clocks say (`data/queuedAcknowledgements.ts`). */
    queuedAcks?: ReadonlySet<string>;
}

/** The compliance rule code of "products that must not be mixed were given together" (`ComplianceRuleCode.cs`). */
export const INPUT_MIX_RULE_CODE = 'compliance.input-mix.never-together';

/** A card the server raised for a wrong mix in one tank. A card from an older server (no rule code) is none. */
export const isMixAlertCard = (card: Pick<AttentionCardCacheRecord, 'topSignalRuleCode'>): boolean =>
    card.topSignalRuleCode === INPUT_MIX_RULE_CODE;

/** He tapped पाहिलं on this card's signal, and the board on the phone is not newer than that tap. */
function seenHere(card: AttentionCardCacheRecord, seen: ReadonlyMap<string, number> | undefined): boolean {
    const at = card.topSignalId ? seen?.get(card.topSignalId) : undefined;
    if (at === undefined) return false;
    const asOf = Date.parse(card.computedAtUtc);
    return Number.isNaN(asOf) || asOf < at;
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

export function buildAttentionModel({ cards, scheduledWork, todos, farmId, todayKey, seenSignals, queuedAcks }: AttentionInput): AttentionModel {
    const onFarm = (rowFarmId: string) => farmId === null || rowFarmId === farmId;
    const stepsKnown = scheduledWork !== null;

    const steps = (scheduledWork?.items ?? [])
        .filter(s => onFarm(s.farmId) && !isRescheduledLocally(s.plannedActivityId, scheduledWork!.asOfUtc))
        .map(stepItem);

    const reminders = (group: 'late' | 'today', list: readonly TodoItem[]): AttentionItem[] =>
        list.filter(t => !t.done).map(t => ({ kind: 'reminder', id: `todo-${t.id}`, group, daysLate: reminderDaysLate(t, todayKey), todo: t }));

    const cardItems: AttentionItem[] = cards
        .filter(c => onFarm(c.farmId) && keepCard(c, stepsKnown) && !seenHere(c, seenSignals) && !(c.topSignalId && queuedAcks?.has(c.topSignalId)))
        .sort((a, b) => attentionRankOrder(a.rank) - attentionRankOrder(b.rank))
        .map(card => ({ kind: 'card', id: `card-${card.cardId}`, group: isMixAlertCard(card) ? 'first' : 'decide', card }));
    const first = cardItems.filter(i => i.group === 'first');

    // Stable within a lateness tie: steps before reminders (the schedule is the farm's plan), then input order.
    const late = [...steps.filter(s => s.group === 'late'), ...reminders('late', todos.late)].sort(byLateness);
    const today = [...steps.filter(s => s.group === 'today'), ...reminders('today', todos.today)];
    const decide = [...steps.filter(s => s.group === 'decide').sort(byLateness), ...cardItems.filter(i => i.group === 'decide')];

    const count = (list: AttentionItem[], kind: AttentionItem['kind']) => list.filter(i => i.kind === kind).length;
    return {
        first,
        late,
        today,
        decide,
        total: first.length + late.length + today.length + decide.length,
        counts: {
            firstAlerts: first.length,
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
 * "२ कामे उशिराची · १ आठवण आज" (the founder's own example, D-1). PROPOSED (Marathi)
 */
export function attentionSummaryMr(counts: AttentionCounts): string {
    // lane L4b fix round 1 (L-6) — Devanagari digits in Marathi, as in the founder's own D-1 example ("२").
    const one = (n: number, singular: string, plural: string) => `${toMarathiDigits(n)} ${n === 1 ? singular : plural}`;
    const parts: string[] = [];
    // lane IT5 - the wrong-mix alerts are the most urgent kind. PROPOSED (Marathi)
    if (counts.firstAlerts) parts.push(one(counts.firstAlerts, 'चुकीचं मिश्रण', 'चुकीची मिश्रणं'));
    if (counts.lateSteps) parts.push(one(counts.lateSteps, 'काम उशिराचे', 'कामे उशिराची'));
    if (counts.lateReminders) parts.push(one(counts.lateReminders, 'आठवण उशिराची', 'आठवणी उशिराच्या'));
    if (counts.todaySteps) parts.push(one(counts.todaySteps, 'काम आज', 'कामे आज'));
    if (counts.todayReminders) parts.push(one(counts.todayReminders, 'आठवण आज', 'आठवणी आज'));
    if (counts.decisions) parts.push(one(counts.decisions, 'निर्णय बाकी', 'निर्णय बाकी'));
    return parts.join(' · ');
}

/**
 * lane L4b fix round 0 — the same count line in English, one language at a time (the strip's third signal in English
 * mode): "2 tasks late · 1 reminder today". PROPOSED (English)
 */
export function attentionSummaryEn(counts: AttentionCounts): string {
    const one = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
    const parts: string[] = [];
    // lane IT5 - the wrong-mix alerts are the most urgent kind. PROPOSED (English)
    if (counts.firstAlerts) parts.push(one(counts.firstAlerts, 'wrong mix', 'wrong mixes'));
    if (counts.lateSteps) parts.push(one(counts.lateSteps, 'task late', 'tasks late'));
    if (counts.lateReminders) parts.push(one(counts.lateReminders, 'reminder late', 'reminders late'));
    if (counts.todaySteps) parts.push(one(counts.todaySteps, 'task today', 'tasks today'));
    if (counts.todayReminders) parts.push(one(counts.todayReminders, 'reminder today', 'reminders today'));
    if (counts.decisions) parts.push(one(counts.decisions, 'decision pending', 'decisions pending'));
    return parts.join(' · ');
}

/** The single most urgent item's words for the strip: "फवारणी · प्लॉट 2 — काल". PROPOSED (Marathi) */
export function mostUrgentLineMr(model: AttentionModel): string | null {
    const first = model.first[0] ?? model.late[0] ?? model.today[0] ?? model.decide[0];
    if (!first) return null;
    if (first.kind === 'step') return `${first.label}${first.step.plotName ? ` · ${first.step.plotName}` : ''} — ${first.dueText}`;
    if (first.kind === 'reminder') return `${first.todo.title} — ${toDevanagariDigits(first.todo.dueText)}`;
    return first.card.titleMr?.trim() || null;
}
