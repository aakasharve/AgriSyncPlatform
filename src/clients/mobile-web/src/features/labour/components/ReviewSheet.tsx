/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ReviewSheet — ONE consolidated Marathi review sheet (replaces the app's
 * fragmented review surfaces). Each entry: who logged it + what, a big
 * "मंजूर" (approve) and a "शंका" (query). Reachable from Home and from Labour
 * Management — one screen, two doorways. Includes a "हे कसं चालतं?" helper.
 *
 * Task 3.2 (spec: 2026-07-13-labour-attendance-approval-design) — approve,
 * query and सगळं मंजूर all play a local confirm animation, collapse the
 * card(s), THEN wait out a 3s "undo before send" window before the real
 * `verify_log` mutation(s) are ever enqueued (`sendVerification`, unchanged
 * below). Tapping पूर्ववत करा inside the window cancels the pending send
 * entirely — nothing is ever enqueued, because approving writes a real
 * verification event server-side (and can advance job-card payout
 * eligibility) that cannot be cleanly reversed once sent. If the sheet is
 * closed, or this component unmounts, while a send is still pending, the
 * pending batch is FLUSHED (sent immediately) rather than silently dropped
 * — see `flushAllPending`.
 */
import React, { useEffect, useRef, useState } from 'react';
import { X, Check, MessageSquare, Undo2 } from 'lucide-react';
import type { LabourData, ReviewItem, ReviewVerificationStatus } from '../labourMock';
import { Avatar, HelpNote } from './LabourUiKit';
import LabourDataPoints from './LabourDataPoints';
import { VerifyLogCommand } from '../../../application/usecases/sync/VerifyLogCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { formatReviewDetail, isReviewDetailWithinDays } from '../reviewDetailDate';

/** Decision 4b (2026-07-19) — bounds the तपासणी queue so it cannot grow forever. */
const REVIEW_QUEUE_MAX_AGE_DAYS = 14;

interface Props {
    open: boolean;
    data: LabourData;
    onClose: () => void;
    onToast: (m: string) => void;
    /**
     * Fired once after a batch finishes with at least one successful send —
     * lets the caller `refresh()` the farm's labour data so the "तपासा N"
     * hub badge (and this sheet, next time it opens) reflect the CURRENT
     * server count instead of the stale one from page load (Decision 4b:
     * the badge must not still say 76 after the queue is cleared).
     */
    onApproved?: () => void;
}

const DISPUTE_REASON = 'मालकाने या नोंदीवर शंका घेतली आहे — कामगाराला विचारायचं आहे.';

// The on-card confirm animation (green fill + checkmark + collapse) plays
// for CONFIRM_ANIM_MS, THEN the undo bar shows for UNDO_WINDOW_MS before the
// real mutation(s) are sent. `prefers-reduced-motion` collapses
// CONFIRM_ANIM_MS to ~0 (near-instant removal) — the undo WINDOW itself is
// untouched, because the safety property (not the animation) is what must
// survive a reduced-motion preference.
const CONFIRM_ANIM_MS = 380;
const UNDO_WINDOW_MS = 3000;

function prefersReducedMotion(): boolean {
    return typeof window !== 'undefined'
        && typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

async function triggerSyncBestEffort(): Promise<void> {
    try {
        await backgroundSyncWorker.triggerNow();
    } catch {
        // Queue persistence is the durable path; the periodic worker retries regardless.
    }
}

/**
 * Enqueues the `verify_log` transition(s) needed to reach `finalStatus` from
 * the review item's CURRENT server status, WITHOUT triggering a sync push —
 * see `sendVerification` (which wraps this with exactly one trigger) for the
 * single-item path, and `finalizeBatch`'s bulk branch below for why a
 * multi-item batch needs the enqueue/trigger split out.
 *
 * `VerificationStateMachine` (ShramSafal.Domain.Logs) forbids a one-hop
 * Draft→Verified/Disputed: a `Draft` item needs Draft→Confirmed first (any
 * farm role may do that), THEN Confirmed→{Verified|Disputed} (owner-tier
 * roles). A `Confirmed` (or already-`Verified`, for the शंका/dispute case)
 * item reaches the target in one hop.
 */
async function enqueueVerificationSteps(
    dailyLogId: string,
    currentStatus: ReviewVerificationStatus | undefined,
    finalStatus: 'verified' | 'disputed',
    reason?: string
): Promise<void> {
    const canGoDirectly = currentStatus === 'Confirmed' || currentStatus === 'Verified';
    if (!canGoDirectly) {
        await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: 'confirmed' });
    }
    await VerifyLogCommand.enqueue({ dailyLogId, verificationStatus: finalStatus, reason });
}

/**
 * Enqueues (see `enqueueVerificationSteps` above), THEN triggers ONE
 * best-effort sync push — `BackgroundSyncWorker.pushPendingMutations`
 * batches ALL pending rows by ascending queue id (insertion order) into one
 * `/sync/push` call, and `PushSyncBatchHandler` applies a batch's mutations
 * sequentially, each in its own committed transaction, so the Confirmed step
 * is durable on the server before the Verified/Disputed step is evaluated
 * against it — even if the two end up split across sync cycles.
 *
 * Exported for `reviewApprove.test.ts` — it is the actual "does तपासणी
 * reach the real approval engine" contract, independent of the button
 * wiring around it. Callers (below) ALWAYS route through the confirm+undo
 * window first — this function itself has no knowledge of that UX and must
 * not change. Used as-is for a SINGLE-item batch (मंजूर / शंका); a
 * multi-item सगळं मंजूर batch calls `enqueueVerificationSteps` per item and
 * triggers sync ONCE for the whole batch instead (see `finalizeBatch`) —
 * Decision 4b (2026-07-19): approving 76 items used to fire ~76 sequential
 * sync round-trips one per item, well after the farmer was told it was done.
 */
export async function sendVerification(
    dailyLogId: string,
    currentStatus: ReviewVerificationStatus | undefined,
    finalStatus: 'verified' | 'disputed',
    reason?: string
): Promise<void> {
    await enqueueVerificationSteps(dailyLogId, currentStatus, finalStatus, reason);
    await triggerSyncBestEffort();
}

type ConfirmKind = 'approve' | 'query' | 'approveAll';

interface PendingBatchItem { id: string; status: ReviewVerificationStatus | undefined }

interface PendingBatch {
    items: PendingBatchItem[];
    kind: ConfirmKind;
    finalStatus: 'verified' | 'disputed';
    reason?: string;
    /** Whichever timer is CURRENTLY scheduled for this batch — the anim-end
     * timer while the card is still collapsing, reassigned to the
     * undo-elapse timer once it has collapsed. `flushAllPending` clears
     * whichever one is live before forcing the send. */
    timer: ReturnType<typeof setTimeout> | null;
}

interface UndoEntry { batchId: string; kind: ConfirmKind; count: number }

function toastFor(kind: ConfirmKind, failedCount: number): string {
    if (kind === 'approveAll') {
        return failedCount === 0
            ? 'सगळं मंजूर ✓'
            : `${failedCount} नोंदी मंजूर करता आल्या नाहीत — पुन्हा प्रयत्न करा`;
    }
    if (kind === 'query') {
        return failedCount === 0
            ? 'शंका नोंदवा — कामगाराला विचारता येईल'
            : 'शंका नोंदवता आली नाही — पुन्हा प्रयत्न करा';
    }
    return failedCount === 0
        ? 'मंजूर ✓ — हजेरीही निश्चित'
        : 'मंजूर करता आलं नाही — पुन्हा प्रयत्न करा';
}

/** The full-card overlay played while a card is in its confirm animation —
 * fills the card green and self-draws a checkmark via the SVG2 `pathLength`
 * trick (normalises the path to length 1 so the dash animation doesn't need
 * the real geometric length). Purely visual; `prefers-reduced-motion`
 * disables both keyframes in CSS (see global-theme.css). */
const ConfirmOverlay: React.FC<{ kind: ConfirmKind }> = ({ kind }) => (
    <div className="review-card-overlay absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 rounded-2xl bg-emerald-500 text-white">
        <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7" aria-hidden="true">
            <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
                pathLength={1}
                className="review-checkmark-path"
            />
        </svg>
        <span className="text-[11px] font-extrabold">{kind === 'query' ? 'शंका नोंदवली' : 'मंजूर केलं'}</span>
    </div>
);

const ReviewSheet: React.FC<Props> = ({ open, data, onClose, onToast, onApproved }) => {
    const [gone, setGone] = useState<Record<string, boolean>>({});
    const [confirming, setConfirming] = useState<Record<string, ConfirmKind>>({});
    const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);

    // Imperative bookkeeping for in-flight batches — timers + the data
    // needed to actually send. Not React state: mutating it never needs to
    // (and must not) trigger a re-render on its own.
    const batchesRef = useRef<Map<string, PendingBatch>>(new Map());
    const batchSeqRef = useRef(0);
    const mountedRef = useRef(true);

    // Decision 4b (2026-07-19) 14-day bound — a real farm's `detail` is a
    // bare ISO date; anything unparseable (mock/preview) passes through.
    const boundedReview = data.review.filter((i) => isReviewDetailWithinDays(i.detail, REVIEW_QUEUE_MAX_AGE_DAYS));
    const items = boundedReview.filter((i) => !gone[i.id]);
    // Excludes cards still mid-confirm-animation from THIS render's bulk
    // target — otherwise a fast मंजूर-then-सगळं-मंजूर double-tap could fold
    // the same card into two independent pending batches (double-send).
    const actionable = items.filter((i) => !confirming[i.id]);

    /**
     * The ONLY place that actually calls `sendVerification`. Runs either
     * when a batch's 3s undo window elapses untouched, or when it is
     * force-flushed (sheet closed / component unmounted) before the window
     * elapses. Idempotent against a timer/flush race: it atomically takes
     * the batch out of `batchesRef` before doing anything else, so a
     * second concurrent call (whichever loses the race) finds nothing and
     * no-ops — never a double-send.
     */
    const finalizeBatch = async (batchId: string) => {
        const batch = batchesRef.current.get(batchId);
        if (!batch) return; // already undone, or already finalized
        batchesRef.current.delete(batchId);
        if (batch.timer != null) clearTimeout(batch.timer);

        if (mountedRef.current) {
            setConfirming((c) => {
                const next = { ...c };
                batch.items.forEach((it) => { delete next[it.id]; });
                return next;
            });
            setGone((g) => {
                const next = { ...g };
                batch.items.forEach((it) => { next[it.id] = true; });
                return next;
            });
            setUndoQueue((q) => q.filter((e) => e.batchId !== batchId));
        }

        const failedIds = new Set<string>();
        if (batch.items.length > 1) {
            // Bulk path (सगळं मंजूर) — Decision 4b: approving 76 items used to
            // enqueue+trigger-sync per item, i.e. ~76 sequential network
            // round-trips fired AFTER the farmer was already told it was
            // done. Enqueue every item's mutation(s) locally first, THEN
            // trigger sync ONCE for the whole batch —
            // `BackgroundSyncWorker.pushPendingMutations` already batches
            // every pending row into one `/sync/push` call, so nothing here
            // needs more than one trigger.
            for (const it of batch.items) {
                try {
                    await enqueueVerificationSteps(it.id, it.status, batch.finalStatus, batch.reason);
                } catch {
                    failedIds.add(it.id);
                }
            }
            await triggerSyncBestEffort();
        } else {
            for (const it of batch.items) {
                try {
                    await sendVerification(it.id, it.status, batch.finalStatus, batch.reason);
                } catch {
                    failedIds.add(it.id);
                }
            }
        }

        // Component is gone (real unmount, not just a closed sheet) — the
        // send already happened above, which is the whole guarantee; there
        // is no surviving UI to restore a failed card into or toast on.
        if (!mountedRef.current) return;

        if (failedIds.size > 0) {
            setGone((g) => {
                const next = { ...g };
                failedIds.forEach((id) => { delete next[id]; });
                return next;
            });
        }
        onToast(toastFor(batch.kind, failedIds.size));

        // At least one item in this batch actually reached the server —
        // refresh the farm's labour data so the "तपासा N" badge (and this
        // sheet, next open) reflect the CURRENT count instead of the stale
        // one from page load (Decision 4b).
        if (failedIds.size < batch.items.length) {
            onApproved?.();
        }
    };

    /** Sends every still-pending batch RIGHT NOW instead of waiting out its
     * window — the silent-data-loss guard for "sheet closed" / "component
     * unmounted while a मंजूर/शंका was still pending". */
    const flushAllPending = () => {
        Array.from(batchesRef.current.keys()).forEach((batchId) => {
            const batch = batchesRef.current.get(batchId);
            if (batch?.timer != null) clearTimeout(batch.timer);
            void finalizeBatch(batchId);
        });
    };

    // Read via a ref inside the effects below so the unmount cleanup (which
    // only ever runs once, per an empty dep array) always calls the LATEST
    // closure — not a stale one captured at mount — without needing
    // `flushAllPending`/`finalizeBatch`/`onToast` in a dependency array.
    const flushAllPendingRef = useRef(flushAllPending);
    flushAllPendingRef.current = flushAllPending;

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            flushAllPendingRef.current();
        };
    }, []);

    // "Sheet closed" flush — ReviewSheet is always mounted by LabourFeature
    // (open just toggles the translate-y transform), so closing is an
    // `open: true -> false` PROP change, not an unmount. Catch that
    // transition here; true unmounts are covered by the effect above.
    const wasOpenRef = useRef(open);
    useEffect(() => {
        if (wasOpenRef.current && !open) {
            flushAllPendingRef.current();
        }
        wasOpenRef.current = open;
    }, [open]);

    const beginConfirm = (targets: ReviewItem[], kind: ConfirmKind, finalStatus: 'verified' | 'disputed', reason?: string) => {
        if (targets.length === 0) return;
        batchSeqRef.current += 1;
        const batchId = `rb-${batchSeqRef.current}`;
        const ids = targets.map((t) => t.id);
        const animMs = prefersReducedMotion() ? 0 : CONFIRM_ANIM_MS;

        const batch: PendingBatch = {
            items: targets.map((t) => ({ id: t.id, status: t.status })),
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

        // Phase 1 -> 2: after the on-card animation, collapse it out of the
        // list and start the REAL 3s undo window. Nothing has been sent yet.
        batch.timer = setTimeout(() => {
            setConfirming((c) => {
                const next = { ...c };
                ids.forEach((id) => { delete next[id]; });
                return next;
            });
            setGone((g) => {
                const next = { ...g };
                ids.forEach((id) => { next[id] = true; });
                return next;
            });
            setUndoQueue((q) => [...q, { batchId, kind, count: ids.length }]);

            batch.timer = setTimeout(() => { void finalizeBatch(batchId); }, UNDO_WINDOW_MS);
        }, animMs);
    };

    /** पूर्ववत करा — cancels the pending timer and restores the card(s).
     * Nothing is ever enqueued for this batch. */
    const undo = (batchId: string) => {
        const batch = batchesRef.current.get(batchId);
        if (!batch) return;
        batchesRef.current.delete(batchId);
        if (batch.timer != null) clearTimeout(batch.timer);

        setUndoQueue((q) => q.filter((e) => e.batchId !== batchId));
        setGone((g) => {
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

    const query = (id: string) => {
        const item = data.review.find((i) => i.id === id);
        if (item) beginConfirm([item], 'query', 'disputed', DISPUTE_REASON);
    };

    const approveAll = () => {
        beginConfirm(actionable, 'approveAll', 'verified');
    };

    const topUndo = undoQueue.length ? undoQueue[undoQueue.length - 1] : null;
    const undoLabel = topUndo == null
        ? ''
        : topUndo.kind === 'query'
            ? 'शंका नोंदवली'
            : topUndo.kind === 'approveAll'
                ? `सगळं मंजूर केलं (${topUndo.count})`
                : 'मंजूर केलं';

    return (
        <>
            <div onClick={onClose} className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'pointer-events-none opacity-0'}`} />
            {/*
              * PHONE-FRAME FIX (2026-08-10). This was `fixed inset-x-0`, so on any
              * screen wider than a phone the sheet spanned the ENTIRE browser
              * window while the app itself stays inside AppShell's centred column
              * (app/components/AppShell.tsx:18). The result on a desktop browser
              * was a full-width sheet sitting under a narrow app — the layout the
              * founder photographed. The max-widths below mirror AppShell's own
              * breakpoints exactly, so the sheet now tracks the app frame.
              */}
            <div className={`fixed inset-x-0 bottom-0 z-40 mx-auto flex max-h-[88%] w-full max-w-[480px] flex-col rounded-t-3xl bg-white shadow-2xl transition-transform duration-300 md:max-w-[640px] xl:max-w-[720px] ${open ? 'translate-y-0' : 'translate-y-full'}`}>
                <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-stone-300" />
                <div className="flex items-center justify-between border-b border-stone-200 px-4 pb-3 pt-2">
                    <div>
                        <h2 className="text-[22px] font-bold text-stone-800">तपासणी</h2>
                        {/* Decision 4b (2026-07-19): this queue can hold the owner's OWN
                            logs too (e.g. his own voice entries awaiting confirmation), not
                            only a team's — "टीमच्या नोंदी" (your team's entries) claimed
                            something not always true. Neutral phrasing that doesn't assert
                            whose entries they are. */}
                        <p className="text-[16px] text-stone-500">{items.length ? `${items.length} नोंदी — मंजूर करा` : 'सगळं झालं ✓'}</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="बंद करा" className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500"><X size={26} /></button>
                </div>
                {/* Taller undo bar (below) needs more clearance so it never covers the last card. */}
                <div className={`flex flex-col gap-2.5 overflow-y-auto p-3.5 ${topUndo ? 'pb-44' : ''}`}>
                    <HelpNote
                        what="रोजच्या नोंदी इथे तुम्ही मंजूर करता — तुमच्या स्वतःच्या असोत वा तुमच्या माणसांच्या."
                        act="बरोबर असेल तर 'मंजूर', काही चुकलं असेल तर 'शंका' — नंतर विचारता येतं."
                        why="चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो. ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर."
                        label="तपासणी म्हणजे काय?"
                    />
                    {actionable.length > 1 && (
                        <button type="button" data-testid="review-approve-all" onClick={() => approveAll()} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-4 text-[19px] font-bold text-white shadow-lg shadow-emerald-200 active:scale-[0.98]"><Check size={24} strokeWidth={2.5} /> सगळं मंजूर ({actionable.length})</button>
                    )}
                    {items.map((it) => {
                        const kind = confirming[it.id];
                        // `shrink-0` below is load-bearing, not cosmetic. This shell is a
                        // flex item inside a `flex flex-col overflow-y-auto` parent, where
                        // the default `flex-shrink: 1` makes children COMPRESS to fit
                        // instead of overflowing into a scroll. Combined with the shell's
                        // own `overflow: hidden` (needed for the collapse animation,
                        // global-theme.css:291), the card silently clipped its own bottom:
                        // measured 189px of content rendered inside a 77px box, cutting off
                        // मंजूर/शंका entirely. The taller farmer-readable buttons made it
                        // obvious, but any card that outgrew the sheet would have hit it.
                        return (
                            <div key={it.id} data-testid={`review-card-${it.id}`} className={`review-card-shell shrink-0 rounded-2xl ${kind ? 'is-collapsing' : ''}`}>
                                <div className="relative rounded-2xl border border-stone-200 bg-white p-3.5 shadow-[0_1px_3px_rgba(20,40,30,0.05)]">
                                    <div className="flex items-center gap-3">
                                        <Avatar tone={it.tone} initial={it.initial} size="sm" />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2 text-[20px] font-bold text-stone-800">{it.who}</div>
                                            {/* Decision 4b: a real farm's `detail` is a bare ISO date
                                                (`yyyy-MM-dd`) — reformat it (आज/काल/"१९ जुलै") instead of
                                                leaking a raw, English-formatted date onto this Marathi
                                                screen. A hardcoded "आज" badge used to sit next to the name
                                                regardless of the log's actual date — removed so the two
                                                never contradict each other; this line is now the single
                                                source of the date shown. */}
                                            <div className="truncate text-[16px] text-stone-500">{formatReviewDetail(it.detail)}</div>
                                        </div>
                                    </div>
                                    <div className="mt-2"><LabourDataPoints entry={it.points} /></div>
                                    {/*
                                      * These two decide money, and they sat 32-36px tall
                                      * immediately beside each other — the highest-cost
                                      * mis-tap in the feature. Both are now 60px with a
                                      * wider gap, and "शंका" is visually demoted (outline,
                                      * fixed width) so the safe, common action is the big
                                      * green one and the two can never be confused by shape.
                                      */}
                                    <div className="mt-3 flex gap-3">
                                        <button type="button" data-testid={`review-approve-${it.id}`} disabled={!!kind} onClick={() => approve(it.id)} className="flex min-h-[60px] flex-1 items-center justify-center gap-2.5 rounded-xl bg-emerald-600 py-3.5 text-[19px] font-extrabold text-white active:scale-[0.98] disabled:opacity-60"><Check size={24} strokeWidth={2.6} /> मंजूर</button>
                                        <button type="button" data-testid={`review-query-${it.id}`} disabled={!!kind} onClick={() => query(it.id)} className="flex min-h-[60px] w-[112px] flex-shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-stone-200 bg-white py-3.5 text-[19px] font-bold text-stone-600 active:scale-[0.98] disabled:opacity-60"><MessageSquare size={20} /> शंका</button>
                                    </div>
                                    {kind && <ConfirmOverlay kind={kind} />}
                                </div>
                            </div>
                        );
                    })}
                    {items.length === 0 && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Check size={30} /></div>
                            <p className="text-[20px] font-bold text-stone-800">फार्म बुक अद्ययावत आहे</p>
                            <p className="mt-1.5 text-[17px] text-stone-500">तपासायला काही उरलं नाही.</p>
                        </div>
                    )}
                    <div className="rounded-xl border border-stone-100 bg-stone-50 p-3.5 text-[16px] leading-relaxed text-stone-600">मंजूर केल्यावर हजेरीही निश्चित होते.</div>
                </div>
                {topUndo && (
                    <div
                        data-testid="review-undo-bar"
                        className="absolute inset-x-3 z-20 flex flex-col gap-1.5 rounded-2xl bg-slate-800 px-3.5 py-2.5 text-white shadow-xl"
                        style={{ bottom: 'calc(0.75rem + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)))' }}
                    >
                        {/*
                          * This is the ONLY chance to take back an irreversible
                          * send, and it lived on a ~26px pill with 12px text on a
                          * 3-second timer. A farmer who reads slowly cannot find,
                          * parse and hit that in three seconds. Now a full-width
                          * 60px button with 19px text — impossible to miss, and
                          * reachable by thumb without aiming.
                          */}
                        <div className="flex flex-col gap-2.5">
                            <span className="text-[17px] font-bold">{undoLabel}</span>
                            <button type="button" data-testid="review-undo-button" onClick={() => undo(topUndo.batchId)} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-white/20 px-4 py-3.5 text-[19px] font-extrabold active:scale-95">
                                <Undo2 size={22} /> पूर्ववत करा
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
