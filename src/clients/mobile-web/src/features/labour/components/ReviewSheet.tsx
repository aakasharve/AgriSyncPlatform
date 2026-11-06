/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReviewSheet — THE ONE REVIEW SHEET. spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b; founder D-3
 * "one approval path, same result from every entry point", D-40, D-44, D-46).
 *
 * It opens from every door — the strip, the waiting drawer, आढावा, the हजेरी page's तपासा, the dashboard's
 * तपासायचं, a job card's linked record — through `features/approval/openApprovalReview`, over the one farm-scoped
 * server list (`features/approval/approvalQueue`), and every मंजूर / शंका goes through the one write
 * (`reviewSend.ts`) to the server's one `VerifyLogHandler`. No other approve button exists.
 *
 * Kept from before (spec 2026-07-13-labour-attendance-approval-design, Task 3.2): मंजूर / शंका play a local confirm
 * animation, collapse the card, THEN wait out a 3 s "undo before send" window; पूर्ववत (मागे घ्या) cancels the send
 * entirely; closing the sheet or unmounting while a send is pending FLUSHES it (never silently dropped).
 *
 * New in L4b:
 *  - the payment line once (D-40 §5) and the empty line "मंजुरीसाठी नोंदी बाकी नाहीत" (D-40 §6), never an all-clear on
 *    a list that was not read;
 *  - शंका needs his reason, spoken or typed (D-40 §3) — the fixed sentence is gone;
 *  - bulk only over records he deliberately SELECTS, only eligible ones, the number shown before it goes (D-40 §4);
 *  - "this record changed" (D-46 §3): a मंजूर the server refused as a stale version shows the new version, the
 *    reason and what changed, and he approves THAT one — nothing parked silently;
 *  - every word in his language (Marathi / English twins, `approvalWords.ts`).
 *
 * Lane L4b fix round 1 (review H-2): a card is hidden only while ITS OWN decision is pending — in the undo window, being
 * sent, or still on this phone (`pendingDecisionIds`) — and comes back once a list read AFTER that send still carries
 * it (a "this record changed" after a conflict, a record re-opened by a correction after a शंका). It used to stay
 * hidden for the whole app session, so the changed record and its new version never showed in the same sheet.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Check, MessageSquare, Undo2, Square, CheckSquare } from 'lucide-react';
import type { LabourData, ReviewItem, ReviewVerificationStatus } from '../labourMock';
import type { DailyLog } from '../../../types';
import { Avatar, HelpNote } from './LabourUiKit';
import LabourDataPoints from './LabourDataPoints';
import { WorkAttributionPickers, useWorkAttribution } from './WorkAttribution';
import type { OwnerConfirmEvidence } from '../../../application/usecases/sync/VerifyLogCommand';
import OriginalVoiceButton from '../../logs/components/originalVoice/OriginalVoiceButton';
import { getSessionUserId } from '../../../infrastructure/storage/AuthTokenStore';
import { t as translate } from '../../../i18n/translations';
import { useOptionalLanguage } from '../../../i18n/LanguageContext';
import type { Language } from '../../../i18n/language';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';
import { approvalWords, workDateIn, type ApprovalWords } from '../../approval/approvalWords';
import { approvalReadTicket, rememberSeen, seenFactsOf, forgetSeen, type ApprovalConflict } from '../../approval/approvalQueue';
import { enqueueVerificationSteps, sendVerification, triggerSyncBestEffort } from './reviewSend';
import { BulkConfirmPanel, ChangedNotice, ConfirmOverlay, DisputeReasonPanel, ReviewFacts, type ConfirmKind } from './ReviewCardParts';

export { sendVerification };

interface Props {
    open: boolean;
    data: LabourData;
    onClose: () => void;
    onToast: (m: string) => void;
    /** Fired once after a batch with at least one successful send: the one list is read again (every door's count). */
    onApproved?: () => void;
    /** The list could NOT be read fresh: an empty list then means "we cannot tell", never "nothing left". */
    reviewListUnknown?: boolean;
    /** The list is being (re)read: an empty list is not an answer yet. */
    reviewListLoading?: boolean;
    /** Labour V1 Task 13 — the farm whose engagements are attributed (no farm = no roster = no picker). */
    farmId?: string;
    /** Labour V1 Task 13 — the device's own logs, used only to map a card to its engagement ids. */
    history?: DailyLog[];
    /** L4b (D-46 §3) — this phone's confirmations the server refused because the record changed since he saw it. */
    conflicts?: readonly ApprovalConflict[];
    /** L4b — he acted on the new version of a changed record: its parked confirmation is settled. */
    onConflictSettled?: (rowId: number) => void;
    /** L4b — a door about one record (a job card) puts it first. */
    focusLogId?: string | null;
    /** L4b fix round 1 (H-2) — records whose मंजूर / शंका is still on this phone: hidden, never "nothing left". */
    pendingDecisionIds?: readonly string[];
    /** L4b fix round 1 (H-2) — the read ticket of `data` (`approvalReadTicket` when that read started). */
    listTicket?: number | null;
    /** Overrides the app language (tests, previews). */
    language?: Language;
}

// The confirm animation plays for CONFIRM_ANIM_MS, then the undo bar shows for UNDO_WINDOW_MS before anything is
// sent. Reduced motion collapses the animation to ~0; the undo WINDOW itself is untouched.
const CONFIRM_ANIM_MS = 380;
const UNDO_WINDOW_MS = 3000;

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

interface PendingBatchItem { id: string; status: ReviewVerificationStatus | undefined; evidence?: OwnerConfirmEvidence; conflictRowId?: number }

interface PendingBatch {
    items: PendingBatchItem[];
    kind: ConfirmKind;
    finalStatus: 'verified' | 'disputed';
    reason?: string;
    /** Whichever timer is CURRENTLY scheduled: the anim-end timer, then the undo-elapse timer. */
    timer: ReturnType<typeof setTimeout> | null;
}

interface UndoEntry { batchId: string; kind: ConfirmKind; count: number }

/**
 * Labour Phase 2 → Phase 1, Task T4 — the toast claims only what has happened: the decision is on THIS phone
 * (`sync.onPhone`, resolved at the sheet's own language so the line never mixes scripts), not that it is settled.
 */
function toastFor(kind: ConfirmKind, failedCount: number, words: ApprovalWords, onPhone: string): string {
    if (kind === 'approveAll') return failedCount === 0 ? words.toastApprovedMany(onPhone) : words.failedMany(failedCount);
    if (kind === 'query') return failedCount === 0 ? words.toastDisputed(onPhone) : words.failedDispute;
    return failedCount === 0 ? words.toastApproved(onPhone) : words.failedOne;
}

/** A changed record whose new version is on screen (or whose version this list does not carry). */
function isChangedCard(item: ReviewItem, conflict: ApprovalConflict | undefined): boolean {
    if (!conflict) return false;
    if (typeof item.version !== 'number' || conflict.seenVersion === null) return true;
    return item.version > conflict.seenVersion;
}

/**
 * D-40 §4 — may this card be part of a bulk मंजूर? Only a record whose who / day / place / work are all stated, whose
 * exact version is known, and that has not just changed. Being complete is not being correct: it only makes the card
 * SELECTABLE; he still selects it himself.
 */
export function isBulkEligible(item: ReviewItem, changed: boolean): boolean {
    if (changed) return false;
    if (item.status !== 'Draft' && item.status !== 'Confirmed') return false;
    if (typeof item.version !== 'number' || item.version < 1) return false;
    const plotKnown = item.plotScope === 'Farm' || !!item.plot;
    return !!item.who && !!item.detail && plotKnown && !!item.points.task;
}

const ReviewSheet: React.FC<Props> = ({
    open, data, onClose, onToast, onApproved, farmId, history, reviewListUnknown, reviewListLoading,
    conflicts = [], onConflictSettled, focusLogId, language: languageOverride, pendingDecisionIds = [], listTicket = null,
}) => {
    const appLanguage = useOptionalLanguage()?.language;
    const language: Language = languageOverride ?? (appLanguage === 'en' ? 'en' : 'mr');
    const words = approvalWords(language);
    const onPhone = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, language);

    // H-2 — `inFlight`: his decision on this card is in the undo window or being sent. `sentMark`: it was sent when the
    // read ticket stood at this value; the card stays hidden until a list read after that (a higher ticket) arrives.
    const [inFlight, setInFlight] = useState<Record<string, boolean>>({});
    const [sentMark, setSentMark] = useState<Record<string, number>>({});
    const [confirming, setConfirming] = useState<Record<string, ConfirmKind>>({});
    const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);
    const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
    const [bulkAsking, setBulkAsking] = useState(false);
    const [disputeFor, setDisputeFor] = useState<string | null>(null);
    const [heardIds, setHeardIds] = useState<ReadonlySet<string>>(() => new Set());

    const batchesRef = useRef<Map<string, PendingBatch>>(new Map());
    const batchSeqRef = useRef(0);
    const mountedRef = useRef(true);

    /** The whole server list, minus the cards whose own decision is still pending; a focused record first. */
    const hiddenForSend = (id: string): boolean =>
        !!inFlight[id]
        || pendingDecisionIds.includes(id)
        || (sentMark[id] !== undefined && (listTicket ?? 0) <= sentMark[id]);
    const visible = data.review.filter((i) => !hiddenForSend(i.id));
    const sendingCount = data.review.length - visible.length;
    const items = focusLogId
        ? [...visible.filter((i) => i.id === focusLogId), ...visible.filter((i) => i.id !== focusLogId)]
        : visible;
    const attribution = useWorkAttribution(history, data.ledger);
    const actionable = items.filter((i) => !confirming[i.id]);
    const conflictOf = (id: string) => conflicts.find((c) => c.logId === id);
    // PLR-D10 I27 (D-44): मंजूर / शंका only for whoever may give the owner's confirmation. Older server: the old flag.
    const mayApprove = data.canConfirm ?? data.canManageLabour !== false;
    const eligible = actionable.filter((i) => isBulkEligible(i, isChangedCard(i, conflictOf(i.id))));
    const selectedItems = eligible.filter((i) => selected.has(i.id));
    const offerBulk = mayApprove && eligible.length > 1;

    /** The ONLY place that sends. Takes the batch out first, so a timer/flush race can never double-send. */
    const finalizeBatch = async (batchId: string) => {
        const batch = batchesRef.current.get(batchId);
        if (!batch) return;
        batchesRef.current.delete(batchId);
        if (batch.timer != null) clearTimeout(batch.timer);

        if (mountedRef.current) {
            setConfirming((c) => {
                const next = { ...c };
                batch.items.forEach((it) => { delete next[it.id]; });
                return next;
            });
            setInFlight((g) => {
                const next = { ...g };
                batch.items.forEach((it) => { next[it.id] = true; });
                return next;
            });
            setUndoQueue((q) => q.filter((e) => e.batchId !== batchId));
        }

        const failedIds = new Set<string>();
        if (batch.items.length > 1) {
            // Decision 4b: enqueue every item locally first, THEN one push for the whole batch.
            for (const it of batch.items) {
                try {
                    await enqueueVerificationSteps(it.id, it.status, batch.finalStatus, batch.reason, it.evidence);
                } catch {
                    failedIds.add(it.id);
                }
            }
            await triggerSyncBestEffort();
        } else {
            for (const it of batch.items) {
                try {
                    await sendVerification(it.id, it.status, batch.finalStatus, batch.reason, it.evidence);
                } catch {
                    failedIds.add(it.id);
                }
            }
        }

        // He acted on the NEW version of a changed record: its old, refused confirmation is settled (D-46 §3).
        batch.items.forEach((it) => {
            if (!failedIds.has(it.id) && it.conflictRowId !== undefined) onConflictSettled?.(it.conflictRowId);
            if (!failedIds.has(it.id) && batch.finalStatus === 'disputed') forgetSeen(it.id, farmId);
        });

        if (!mountedRef.current) return;

        // H-2 — its send is over: a sent card waits for a list read after now; a failed one is back at once.
        const mark = approvalReadTicket();
        setSentMark((m) => {
            const next = { ...m };
            batch.items.forEach((it) => { if (!failedIds.has(it.id)) next[it.id] = mark; });
            return next;
        });
        setInFlight((g) => {
            const next = { ...g };
            batch.items.forEach((it) => { delete next[it.id]; });
            return next;
        });
        onToast(toastFor(batch.kind, failedIds.size, words, onPhone));
        if (failedIds.size < batch.items.length) onApproved?.();
    };

    /** Sends every still-pending batch now — the guard for "sheet closed" / "unmounted" while a send waits. */
    const flushAllPending = () => {
        Array.from(batchesRef.current.keys()).forEach((batchId) => {
            const batch = batchesRef.current.get(batchId);
            if (batch?.timer != null) clearTimeout(batch.timer);
            void finalizeBatch(batchId);
        });
    };
    const flushAllPendingRef = useRef(flushAllPending);
    flushAllPendingRef.current = flushAllPending;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            flushAllPendingRef.current();
        };
    }, []);

    // The sheet stays mounted (open toggles a transform), so closing is a prop change: flush on true -> false.
    const wasOpenRef = useRef(open);
    useEffect(() => {
        if (wasOpenRef.current && !open) {
            flushAllPendingRef.current();
            setSelected(new Set());
            setBulkAsking(false);
            setDisputeFor(null);
        }
        wasOpenRef.current = open;
    }, [open]);

    const beginConfirm = (targets: ReviewItem[], kind: ConfirmKind, finalStatus: 'verified' | 'disputed', reason?: string) => {
        if (targets.length === 0) return;
        batchSeqRef.current += 1;
        const batchId = `rb-${batchSeqRef.current}`;
        const ids = targets.map((t) => t.id);
        const animMs = prefersReducedMotion() ? 0 : CONFIRM_ANIM_MS;
        const verifierUserId = getSessionUserId();

        const batch: PendingBatch = {
            items: targets.map((t) => {
                const conflict = conflictOf(t.id);
                if (finalStatus === 'verified') rememberSeen(t, farmId);
                return {
                    id: t.id,
                    status: t.status,
                    ...(finalStatus === 'verified' && verifierUserId && {
                        evidence: { verifierUserId, reviewBasis: heardIds.has(t.id) ? 'heard' as const : 'read' as const, logVersion: t.version },
                    }),
                    ...(conflict && isChangedCard(t, conflict) && { conflictRowId: conflict.rowId }),
                };
            }),
            kind,
            finalStatus,
            reason,
            timer: null,
        };
        batchesRef.current.set(batchId, batch);

        setConfirming((c) => {
            const next = { ...c };
            ids.forEach((id) => { next[id] = kind; });
            return next;
        });
        setSelected((s) => {
            const next = new Set(s);
            ids.forEach((id) => next.delete(id));
            return next;
        });

        // After the card's animation: collapse it and start the REAL 3 s undo window. Nothing has been sent yet.
        batch.timer = setTimeout(() => {
            setConfirming((c) => {
                const next = { ...c };
                ids.forEach((id) => { delete next[id]; });
                return next;
            });
            setInFlight((g) => {
                const next = { ...g };
                ids.forEach((id) => { next[id] = true; });
                return next;
            });
            setUndoQueue((q) => [...q, { batchId, kind, count: ids.length }]);
            batch.timer = setTimeout(() => { void finalizeBatch(batchId); }, UNDO_WINDOW_MS);
        }, animMs);
    };

    /** मागे घ्या — cancels the pending timer and restores the card(s). Nothing is ever enqueued for this batch. */
    const undo = (batchId: string) => {
        const batch = batchesRef.current.get(batchId);
        if (!batch) return;
        batchesRef.current.delete(batchId);
        if (batch.timer != null) clearTimeout(batch.timer);
        setUndoQueue((q) => q.filter((e) => e.batchId !== batchId));
        setInFlight((g) => {
            const next = { ...g };
            batch.items.forEach((it) => { delete next[it.id]; });
            return next;
        });
        setConfirming((c) => {
            const next = { ...c };
            batch.items.forEach((it) => { delete next[it.id]; });
            return next;
        });
    };

    const approve = (id: string) => {
        const item = data.review.find((i) => i.id === id);
        if (item) beginConfirm([item], 'approve', 'verified');
    };

    const sendDispute = (id: string, reason: string) => {
        const item = data.review.find((i) => i.id === id);
        setDisputeFor(null);
        if (item && reason.trim()) beginConfirm([item], 'query', 'disputed', reason.trim());
    };

    const toggleSelected = (id: string) => {
        setBulkAsking(false);
        setSelected((s) => {
            const next = new Set(s);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const approveSelected = () => {
        setBulkAsking(false);
        beginConfirm(selectedItems, 'approveAll', 'verified');
    };

    const topUndo = undoQueue.length ? undoQueue[undoQueue.length - 1] : null;
    const undoLabel = topUndo == null
        ? ''
        : topUndo.kind === 'query'
            ? words.disputedMark
            : topUndo.kind === 'approveAll'
                ? words.approvedMany(topUndo.count)
                : words.approvedMark;
    const listKnown = !reviewListLoading && !reviewListUnknown;

    return (
        <>
            <div onClick={onClose} className={`fixed inset-0 z-[60] bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
            {/* PHONE-FRAME FIX (2026-08-10): the max-widths mirror AppShell's breakpoints, so the sheet tracks the app
                frame. z-[60]: above the bottom bar (z-50), which used to hide the last card's buttons. */}
            <div data-testid="review-sheet" aria-hidden={!open} className={`fixed inset-x-0 bottom-0 z-[60] mx-auto flex max-h-[88%] w-full max-w-[480px] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 md:max-w-[640px] xl:max-w-[720px] ${open ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300" />
                <div className="flex items-center justify-between border-b border-stone-200 px-4 pb-3 pt-2">
                    <div>
                        <h2 className="text-[22px] font-bold text-stone-800">{words.title}</h2>
                        <p data-testid="review-sheet-count" className="text-[16px] text-stone-500">{items.length ? words.countLine(items.length) : reviewListLoading ? '' : reviewListUnknown ? words.listUnknown : sendingCount > 0 ? words.listSending : words.empty}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label={words.close} className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500"><X size={26} /></button>
                </div>
                <div className={`flex flex-col gap-2.5 overflow-y-auto p-3.5 ${topUndo ? 'pb-44' : ''}`}>
                    {/* D-40 §5 — said once, here; never repeated on each card. */}
                    <p data-testid="review-sheet-explanation" className="rounded-xl bg-stone-50 px-3 py-2 text-[15px] font-semibold leading-snug text-stone-700">{words.explanation}</p>
                    <HelpNote what={words.helpWhat} act={words.helpAct} why={words.helpWhy} label={words.helpLabel} />
                    {offerBulk && selectedItems.length > 0 && !bulkAsking && (
                        <button type="button" data-testid="review-approve-selected" onClick={() => setBulkAsking(true)} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-4 text-[19px] font-bold text-white shadow-lg shadow-emerald-200 active:scale-[0.98]"><Check size={24} strokeWidth={2.5} /> {words.approveSelected(selectedItems.length)}</button>
                    )}
                    {offerBulk && bulkAsking && selectedItems.length > 0 && (
                        <BulkConfirmPanel count={selectedItems.length} words={words} onYes={approveSelected} onNo={() => setBulkAsking(false)} />
                    )}
                    {items.map((it) => {
                        const kind = confirming[it.id];
                        const conflict = conflictOf(it.id);
                        const changed = isChangedCard(it, conflict);
                        const canSelect = offerBulk && !kind && isBulkEligible(it, changed);
                        const isSelected = selected.has(it.id);
                        // `shrink-0` is load-bearing: inside a flex column with overflow, a shrinking card clipped its
                        // own मंजूर / शंका buttons (measured 189px of content in a 77px box).
                        return (
                            <div key={it.id} data-testid={`review-card-${it.id}`} data-focused={it.id === focusLogId ? 'true' : undefined} className={`review-card-shell shrink-0 rounded-2xl ${kind ? 'is-collapsing' : ''}`}>
                                <div className={`relative rounded-2xl border bg-white p-3.5 shadow-[0_6px_20px_-10px_rgba(20,40,30,0.28)] backdrop-blur-md ${isSelected ? 'border-emerald-500 ring-2 ring-emerald-200' : 'border-stone-200'}`}>
                                    {changed && <ChangedNotice item={it} seen={seenFactsOf(it.id, farmId)} words={words} language={language} />}
                                    <div className="flex items-center gap-3">
                                        <Avatar tone={it.tone} initial={it.initial} size="sm" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 text-[20px] font-bold text-stone-800">{it.who}</div>
                                            <div className="truncate text-[16px] text-stone-500">{workDateIn(it.detail, language)}</div>
                                        </div>
                                        {canSelect && (
                                            <button type="button" data-testid={`review-select-${it.id}`} aria-pressed={isSelected} onClick={() => toggleSelected(it.id)}
                                                className={`flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-xl border-2 px-2.5 text-[16px] font-bold ${isSelected ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-stone-200 bg-white text-stone-600'}`}>
                                                {isSelected ? <CheckSquare size={20} /> : <Square size={20} />} {isSelected ? words.selected : words.select}
                                            </button>
                                        )}
                                    </div>
                                    <div className="mt-2.5"><ReviewFacts item={it} words={words} language={language} /></div>
                                    <div className="mt-1.5"><LabourDataPoints entry={{ shift: it.points.shift, names: it.points.names }} /></div>
                                    {offerBulk && !canSelect && !kind && !changed && (
                                        <p className="mt-1.5 text-[14px] font-semibold text-stone-500">{words.lookAlone}</p>
                                    )}
                                    {mayApprove && it.hasRecording && farmId && <OriginalVoiceButton dailyLogId={it.id} farmId={farmId} onHeard={(id) => setHeardIds((h) => new Set(h).add(id))} />}
                                    {disputeFor !== it.id && (
                                        <div className="mt-3 flex gap-3">
                                            {mayApprove && <button type="button" data-testid={`review-approve-${it.id}`} disabled={!!kind} onClick={() => approve(it.id)} className="flex min-h-[60px] flex-1 items-center justify-center gap-2.5 rounded-xl bg-emerald-600 py-3.5 text-[19px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60"><Check size={24} strokeWidth={2.6} /> {words.approve}</button>}
                                            {mayApprove && <button type="button" data-testid={`review-query-${it.id}`} disabled={!!kind} onClick={() => setDisputeFor(it.id)} className="flex min-h-[60px] w-[112px] flex-shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-stone-200 bg-white py-3.5 text-[19px] font-bold text-stone-600 active:scale-[0.98] disabled:opacity-60"><MessageSquare size={20} /> {words.dispute}</button>}
                                        </div>
                                    )}
                                    {mayApprove && disputeFor === it.id && !kind && (
                                        <DisputeReasonPanel itemId={it.id} words={words} language={language} onSend={(reason) => sendDispute(it.id, reason)} onCancel={() => setDisputeFor(null)} />
                                    )}
                                    {/* Labour V1 Task 13 — naming people sits BELOW मंजूर / शंका: never a step owed first (P9). */}
                                    {farmId && <WorkAttributionPickers farmId={farmId} logId={it.id} attribution={attribution} onToast={onToast} />}
                                    {kind && <ConfirmOverlay kind={kind} words={words} />}
                                </div>
                            </div>
                        );
                    })}
                    {items.length === 0 && !reviewListLoading && reviewListUnknown && (
                        <div data-testid="review-list-unknown" className="py-8 text-center">
                            <p className="text-[20px] font-bold text-stone-800">{words.listUnknownTitle}</p>
                            <p className="mt-1.5 text-[17px] text-stone-500">{words.listUnknownHint}</p>
                        </div>
                    )}
                    {items.length === 0 && listKnown && sendingCount > 0 && (
                        <div data-testid="review-list-sending" className="py-8 text-center">
                            <p className="text-[20px] font-bold text-stone-800">{words.listSending}</p>
                        </div>
                    )}
                    {items.length === 0 && listKnown && sendingCount === 0 && (
                        <div data-testid="review-list-empty" className="py-8 text-center">
                            <p className="text-[20px] font-bold text-stone-800">{words.empty}</p>
                        </div>
                    )}
                </div>
                {topUndo && (
                    <div data-testid="review-undo-bar" className="absolute inset-x-3 z-20 flex flex-col gap-1.5 rounded-2xl bg-slate-800 px-3.5 py-2.5 text-white shadow-xl" style={{ bottom: 'calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}>
                        {/* The only chance to take back an irreversible send: a full-width 60px button, never a small pill. */}
                        <div className="flex flex-col gap-2.5">
                            <span className="text-[17px] font-bold">{undoLabel}</span>
                            <button type="button" data-testid="review-undo-button" onClick={() => undo(topUndo.batchId)} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-white/20 px-4 py-3.5 text-[19px] font-extrabold active:scale-95">
                                <Undo2 size={22} /> {words.undo}
                            </button>
                        </div>
                        <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
                            <div key={topUndo.batchId} className="review-undo-progress h-full w-full bg-emerald-400" />
                        </div>
                    </div>
                )}
            </div>
        </>
    );
};

export default ReviewSheet;
