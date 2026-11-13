/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H16; I22 — founder D-1)
 *
 * लक्ष द्या — the farmer's permanent action page (founder D-1, 26 Oct): "The permanent 'लक्ष द्या' footer page
 * should let the farmer resolve what needs attention." A bottom-bar PLACE in the app's common look: one title
 * bar with the big "← मागे", a plain intro line, glass cards, Marathi only.
 *
 * What is on it — ONE list (`attentionItems.ts`), the same one the bottom-bar count and the आढावा strip read,
 * ordered by urgency in the founder's three groups (lane IT5: and, above them, "आधी हे पाहा" - a wrong mix in one tank,
 * `MixAlertCard`: काय करायचं / पाहिलं):
 *   1. वेळ निघून गेली — late reminders (झाले / वेळ बदला) and late scheduled steps (काम नोंदवा / पुढे ठरवा);
 *   2. आज करायचे      — today's reminders and today's scheduled steps;
 *   3. निर्णय घ्यायचा  — steps past their on-time window, and the server's plot cards (each card's button
 *                        leads where the thing can be done, or is not drawn — `attentionActions.ts`).
 * Not on it (D-1): approvals and disputed records (मंजुरी keeps them; no shortcut here).
 *
 * Clearing (D-1): a reminder marked झाले clears from every surface (one store). A scheduled step clears only
 * when the server matches recorded work to it or it is moved to a new day; opening it clears nothing.
 *
 * The board's honesty rules are kept (Task 8 / 8b): a board that was never synced shows the error banner and a
 * retry that re-runs the sync — never the all-clear; the all-clear says when it is from, and says only that
 * nothing needs attention now: "सध्या लक्ष देण्यासारखे काही नाही." — never that the farm is fine (D-1).
 */
import React, { useCallback } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAttentionModel } from '../hooks/useAttentionModel';
import AttentionCard from '../components/AttentionCard';
import MixAlertCard from '../components/MixAlertCard';
import { ReminderRow, StepRow } from '../components/AttentionItemRow';
import { attentionButtonLabelMr, attentionTargetFor, type AttentionTarget } from '../attentionActions';
import type { AttentionGroupKey, AttentionItem } from '../attentionItems';
import { rescheduleStep } from '../data/rescheduleStep';
import type { ScheduledWorkItem } from '../scheduledWork';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import type { CropProfile, PageView, PlannedTask } from '../../../types';
import { formatFarmerTime } from '../../../shared/utils/displayTime';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { GlassCard, PageBar, SANS, Tap } from '../../../shared/components/ui/placeUi';
import { rescheduledTask, toggledTask, type TodoItem, type TodoWhen } from '../../reflect/overview/todoModel';
import { addDays, dateLabel, fromDateKey } from '../../reflect/overview/reflectDates';
import { toDevanagariDigits } from '../../../shared/utils/marathiDigits';
// TASK 8 — reused as-is, no new copy. See the note in `JobCardsPage.tsx`.
import { LoadErrorBanner } from '../../labour/components/LabourUiKit';
// spec: plr-d10 lane MU-1 - the PRIMARY account holder's two cards: people waiting to join, and the work the server kept for him.
import JoinRequestsAttention from '../../relationships/JoinRequestsAttention';
import KeptWorkAttention from '../../relationships/KeptWorkAttention';

/** "आज सकाळी 9:15 पर्यंतची माहिती" / "28 ऑग, सकाळी 11:30 पर्यंतची माहिती". PROPOSED (Marathi) */
export function asOfLabelMr(asOf: string | null, todayKey: string = getDateKey()): string {
    if (!asOf) return '';
    const time = formatFarmerTime(asOf);
    if (!time) return '';
    const key = getDateKey(asOf);
    const day = key === todayKey ? 'आज' : `${dateLabel(fromDateKey(key))},`;
    return toDevanagariDigits(`${day} ${time} पर्यंतची माहिती`);
}

export interface AttentionPageProps {
    /** The title bar's "← मागे". */
    onBack?: () => void;
    /** Follow a card's button. Omit and no card draws a button (P5). */
    onGo?: (target: AttentionTarget, card: AttentionCardCacheRecord) => void;
    /** Home tabs this person may not open (a worker: तुलना) — such a card draws no button. */
    hiddenViews?: readonly PageView[];
    /** The planned-task store (`useAppData`): its late and today's reminders show here. */
    tasks?: readonly PlannedTask[];
    crops?: readonly CropProfile[];
    /** The same update करायची कामे uses — one store, so झाले / वेळ बदला change both pages. */
    onUpdateTask?: (task: PlannedTask) => void;
    /** "सगळी करायची कामं पाहा". */
    onOpenTodos?: () => void;
    /** "काम नोंदवा" on a scheduled step: the recorder, on that step's plot. Omit → no button. */
    onRecordWork?: (step: ScheduledWorkItem) => void;
    /**
     * May this person move the farm's scheduled work to a new day ("पुढे ठरवा")? Omit / false → no button.
     * The founder's D-22: planning authority starts with the primary owner; nothing here widens it.
     */
    canReschedule?: boolean;
}

const GROUPS: readonly { key: AttentionGroupKey; title: string; tone: string }[] = [
    // lane IT5 (Task 1) - a wrong mix in one tank, above everything (empty in production until the rules are reviewed, D-96)
    { key: 'first', title: 'आधी हे पाहा', tone: 'text-rose-700' },
    { key: 'late', title: 'वेळ निघून गेली', tone: 'text-rose-700' },
    { key: 'today', title: 'आज करायचे', tone: 'text-amber-800' },
    { key: 'decide', title: 'निर्णय घ्यायचा', tone: 'text-stone-800' },
];

const AttentionPage: React.FC<AttentionPageProps> = ({ onBack, onGo, hiddenViews, tasks, crops, onUpdateTask, onOpenTodos, onRecordWork, canReschedule }) => {
    const model = useAttentionModel(tasks, crops);
    const { board, todayKey } = model;
    const { asOf, isLoading, loadFailed, refresh } = board;

    const done = useCallback((t: TodoItem) => { if (t.canToggle) onUpdateTask?.(toggledTask(t.task)); }, [onUpdateTask]);
    const moveReminder = useCallback((t: TodoItem, when: TodoWhen) => {
        if (t.canToggle) onUpdateTask?.(rescheduledTask(t.task, when, todayKey));
    }, [onUpdateTask, todayKey]);
    const moveStep = useCallback(async (step: ScheduledWorkItem, days: number) => {
        await rescheduleStep(step, getDateKey(addDays(fromDateKey(todayKey), days)));
        refresh(); // the server's own answer replaces the local hide on the next pull
    }, [refresh, todayKey]);

    /**
     * Route a card's button (H16). CEI Phase 2 §4.5 task 4.3.1 — `AssignTest` deep-links the test queue with
     * this plot's filter, as before. A sync retry runs here; everything else goes through `onGo`.
     */
    const handleCardAction = useCallback((card: AttentionCardCacheRecord, target: AttentionTarget) => {
        if (target.kind === 'sync') { refresh(); return; }
        if (target.kind === 'tests' && typeof window !== 'undefined') {
            const params = new URLSearchParams();
            params.set('filter', 'Due');
            if (card.plotId) params.set('plotId', card.plotId);
            if (card.cropCycleId) params.set('cropCycleId', card.cropCycleId);
            window.history.pushState({}, '', `/tests?${params.toString()}`);
        }
        onGo?.(target, card);
    }, [onGo, refresh]);

    const renderItem = (item: AttentionItem) => {
        if (item.kind === 'card' && item.group === 'first') return <MixAlertCard key={item.id} card={item.card} />;
        if (item.kind === 'reminder') {
            return <ReminderRow key={item.id} t={item.todo} tone={item.group} onDone={onUpdateTask ? done : undefined} onMove={onUpdateTask ? moveReminder : undefined} />;
        }
        if (item.kind === 'step') {
            return <StepRow key={item.id} step={item.step} label={item.label} dueText={item.dueText} tone={item.group} why={item.why}
                onRecord={onRecordWork} onMove={canReschedule ? moveStep : undefined} />;
        }
        const target = attentionTargetFor(item.card, hiddenViews);
        const canGo = target !== null && (target.kind === 'sync' || Boolean(onGo));
        return (
            <AttentionCard key={item.id} card={item.card} actionLabel={attentionButtonLabelMr(item.card)}
                onAction={canGo && target ? (c) => handleCardAction(c, target) : undefined} />
        );
    };

    const stamp = asOfLabelMr(asOf, todayKey);
    const hasReminders = model.counts.lateReminders + model.counts.todayReminders > 0;

    let status: React.ReactNode = null;
    if (isLoading && model.total === 0) {
        // PROPOSED (Marathi) — was "Loading..."
        status = <p className="m-0 px-1 text-center text-[14px] font-bold text-stone-500" data-testid="attention-loading">माहिती आणत आहोत…</p>;
    } else if (loadFailed) {
        /*
         * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — `db.attentionCards` is filled only by a
         * SUCCESSFUL sync pull, so on a device that never synced its emptiness is "unknown", not "fine". Gated on
         * `loadFailed` (no sync cursor), NEVER on the item count. This phone's own reminders still show below.
         */
        status = <LoadErrorBanner onRetry={refresh} compact />;
    } else if (model.total === 0) {
        status = (
            <GlassCard testId="attention-all-clear">
                <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-emerald-800">
                    <CheckCircle2 size={20} aria-hidden="true" />सध्या लक्ष देण्यासारखे काही नाही.
                </p>
                {/* TASK 8b — the all-clear says WHEN it is from (a day-old pull must not read as today). */}
                {stamp && <p className="m-0 mt-1 text-[13px] font-semibold text-stone-500" data-testid="attention-as-of">{stamp}</p>}
            </GlassCard>
        );
    } else if (stamp) {
        status = <p className="m-0 px-1 text-[13px] font-semibold text-stone-500" data-testid="attention-as-of">{stamp}</p>;
    }

    return (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-24 sm:px-6" style={{ fontFamily: SANS }} data-testid="attention-page">
            <PageBar title="लक्ष द्या" onBack={onBack} />
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">आज ज्याकडे पाहायला हवं, ते इथे. एक-एक करून पूर्ण करा.</p>
            {status}
            {/* MU-1: self-contained and drawn only for the farm's primary account holder (nothing for anyone else). */}
            <JoinRequestsAttention />
            <KeptWorkAttention />
            {GROUPS.map(g => {
                const items = model[g.key];
                if (items.length === 0) return null;
                return (
                    <section key={g.key} className="space-y-2" data-testid={`attention-group-${g.key}`}>
                        <p className={`m-0 px-1 text-[15px] font-extrabold ${g.tone}`}>{g.title} ({toDevanagariDigits(items.length)})</p>
                        {items.map(item => renderItem(item))}
                    </section>
                );
            })}
            {onOpenTodos && hasReminders && (
                <Tap onClick={onOpenTodos} data-testid="attention-open-todos"
                    className="flex min-h-[46px] w-full items-center justify-center rounded-full border-2 border-emerald-600 bg-white text-[15px] font-extrabold text-emerald-800">
                    सगळी करायची कामं पाहा
                </Tap>
            )}
        </div>
    );
};

export default AttentionPage;
