/**
 * spec: plr-d10-redesign-real-integration-2026-10-25 (I14 — H14, H15 / T3, H16)
 *
 * लक्ष द्या — a bottom-bar PLACE in the app's common look (PLR-D9 preview `app/PlacePages.tsx`): one title bar
 * with the big "← मागे" (back to where he came from, `goBackOr`), a plain intro line, glass cards, Marathi only
 * (was English: "Loading...", "Attention", the "Critical / Needs Attention / Watch" bands, "as of", DM Sans).
 *
 * What is on it (what ELSE belongs here is still the founder's open question D-1, so nothing is invented):
 *   1. to-dos whose day has passed — the same items as करायची कामे, ticked in one store (H15 / T3);
 *   2. the server's attention board, unchanged in content, ordered most serious first, each card's button
 *      leading where the thing can be done or not drawn at all (H16, `attentionActions.ts`).
 *
 * The board's honesty rules are kept exactly (Task 8 / 8b): a board that was never synced shows the error
 * banner and a retry that re-runs the sync — never the all-clear; a true all-clear says when it is from.
 * One addition: while late to-dos are on the page, the all-clear sentence is not shown above them.
 */
import React, { useCallback, useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useAttentionBoard } from '../hooks/useAttentionBoard';
import AttentionCard from '../components/AttentionCard';
import { AttentionLateTodos } from '../components/AttentionLateTodos';
import { attentionButtonLabelMr, attentionTargetFor, type AttentionTarget } from '../attentionActions';
import { attentionRankOrder } from '../attentionWire';
import type { AttentionCardCacheRecord } from '../../../infrastructure/storage/DexieDatabase';
import type { CropProfile, PageView, PlannedTask } from '../../../types';
import { formatFarmerTime } from '../../../shared/utils/displayTime';
import { getDateKey } from '../../../core/domain/services/DateKeyService';
import { GlassCard, PageBar, SANS } from '../../../shared/components/ui/placeUi';
import { buildTodoList, toggledTask, type TodoItem } from '../../reflect/overview/todoModel';
import { dateLabel, fromDateKey } from '../../reflect/overview/reflectDates';
// TASK 8 — reused as-is, no new copy. See the note in `JobCardsPage.tsx`.
import { LoadErrorBanner } from '../../labour/components/LabourUiKit';

/** "आज सकाळी 9:15 पर्यंतची माहिती" / "28 ऑग, सकाळी 11:30 पर्यंतची माहिती". PROPOSED (Marathi) */
export function asOfLabelMr(asOf: string | null, todayKey: string = getDateKey()): string {
    if (!asOf) return '';
    const time = formatFarmerTime(asOf);
    if (!time) return '';
    const key = getDateKey(asOf);
    const day = key === todayKey ? 'आज' : `${dateLabel(fromDateKey(key))},`;
    return `${day} ${time} पर्यंतची माहिती`;
}

export interface AttentionPageProps {
    /** The title bar's "← मागे". */
    onBack?: () => void;
    /** Follow a card's button. Omit and no card draws a button (P5). */
    onGo?: (target: AttentionTarget, card: AttentionCardCacheRecord) => void;
    /** Home tabs this person may not open (a worker: तुलना) — such a card draws no button. */
    hiddenViews?: readonly PageView[];
    /** The planned-task store (`useAppData`): the late ones show here. */
    tasks?: readonly PlannedTask[];
    crops?: readonly CropProfile[];
    /** The same update करायची कामे uses — one store, so a tick clears both pages. */
    onUpdateTask?: (task: PlannedTask) => void;
    /** "सगळी करायची कामं पाहा". */
    onOpenTodos?: () => void;
}

const AttentionPage: React.FC<AttentionPageProps> = ({ onBack, onGo, hiddenViews, tasks, crops, onUpdateTask, onOpenTodos }) => {
    const { cards, asOf, isLoading, loadFailed, refresh } = useAttentionBoard();
    const todayKey = getDateKey();

    const lateTodos = useMemo<TodoItem[]>(() => {
        if (!tasks?.length) return [];
        return buildTodoList({
            tasks,
            storeIds: new Set(tasks.map(t => t.id)),
            crops: crops ?? [],
            scope: { viewCrops: [], viewPlots: {} },
            wholeFarm: true,
            todayKey,
        }).late;
    }, [tasks, crops, todayKey]);

    const toggleTodo = useCallback((t: TodoItem) => {
        if (t.canToggle) onUpdateTask?.(toggledTask(t.task));
    }, [onUpdateTask]);

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

    // Most serious first. The rank arrives as the server's ordinal number (`attentionWire.ts`).
    const ordered = useMemo(
        () => [...cards].sort((a, b) => attentionRankOrder(a.rank) - attentionRankOrder(b.rank)),
        [cards],
    );
    const stamp = asOfLabelMr(asOf, todayKey);

    let board: React.ReactNode;
    if (isLoading && cards.length === 0) {
        // PROPOSED (Marathi) — was "Loading..."
        board = <p className="m-0 px-1 text-center text-[14px] font-bold text-stone-500" data-testid="attention-loading">माहिती आणत आहोत…</p>;
    } else if (loadFailed) {
        /*
         * TASK 8 (spec: 2026-08-28-labour-v2-release-1, P4/P5, Ruling R8) — `db.attentionCards` is filled only by
         * a SUCCESSFUL sync pull, so on a device that never synced its emptiness is "unknown", not "fine". Gated
         * on `loadFailed` (no sync cursor), NEVER on `cards.length`.
         */
        board = <LoadErrorBanner onRetry={refresh} compact />;
    } else if (cards.length === 0) {
        board = lateTodos.length > 0 ? null : (
            <GlassCard testId="attention-all-clear">
                <p className="m-0 flex items-center gap-2 text-[16px] font-extrabold text-emerald-800">
                    <CheckCircle2 size={20} aria-hidden="true" />सगळ्या शेती आज व्यवस्थित आहेत
                </p>
                {/* TASK 8b — the all-clear says WHEN it is from (a day-old pull must not read as today). */}
                {stamp && <p className="m-0 mt-1 text-[13px] font-semibold text-stone-500" data-testid="attention-as-of">{stamp}</p>}
            </GlassCard>
        );
    } else {
        board = (
            <>
                {stamp && <p className="m-0 px-1 text-[13px] font-semibold text-stone-500" data-testid="attention-as-of">{stamp}</p>}
                {ordered.map(card => {
                    const target = attentionTargetFor(card, hiddenViews);
                    const canGo = target !== null && (target.kind === 'sync' || Boolean(onGo));
                    return (
                        <AttentionCard
                            key={card.cardId}
                            card={card}
                            actionLabel={attentionButtonLabelMr(card)}
                            onAction={canGo && target ? (c) => handleCardAction(c, target) : undefined}
                        />
                    );
                })}
            </>
        );
    }

    return (
        <div className="mx-auto max-w-4xl space-y-3 px-4 pb-24 sm:px-6" style={{ fontFamily: SANS }} data-testid="attention-page">
            <PageBar title="लक्ष द्या" onBack={onBack} />
            <p className="m-0 px-1 text-[14px] font-semibold leading-snug text-stone-700">आज ज्याकडे पाहायला हवं, ते इथे. एक-एक करून पूर्ण करा.</p>
            {lateTodos.length > 0 && <AttentionLateTodos items={lateTodos} onToggle={toggleTodo} onOpenTodos={onOpenTodos} />}
            {board}
        </div>
    );
};

export default AttentionPage;
