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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Check, MessageSquare, Undo2, Users, Sprout, MapPin, Wallet } from 'lucide-react';
import type { LabourData, ReviewItem, ReviewVerificationStatus } from '../labourMock';
import { inr } from '../labourMock';
import type { DailyLog } from '../../../types';
import { Avatar, HelpNote } from './LabourUiKit';
import LabourDataPoints, { toMr } from './LabourDataPoints';
import FieldOperatorPicker from './FieldOperatorPicker';
import { VerifyLogCommand } from '../../../application/usecases/sync/VerifyLogCommand';
import { backgroundSyncWorker } from '../../../infrastructure/sync/BackgroundSyncWorker';
import { formatReviewDetail } from '../reviewDetailDate';
import { t as translate } from '../../../i18n/translations';
import { resolveOversightString } from '../../../i18n/oversightTranslations';
import { SYNC_HONESTY_I18N_KEYS } from '../../sync/status/syncHonestyState';

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
    /**
     * Labour V1 Task 13 — the farm whose engagements are being attributed.
     * Optional: `LabourPreview.tsx`'s bare `?preview=labour` mount has no
     * farm context at all, and without a farm there is no Field Operator
     * roster to pick from, so the picker simply does not render there.
     */
    farmId?: string;
    /**
     * Labour V1 Task 13 — the device's own logs, used for ONE thing: mapping
     * a review card (a `dailyLogId`) to the `labourAssignmentId` Task 7.3
     * minted for its engagement. The server read-model (`LabourReviewItemDto`)
     * does not carry that id, and attach is addressed by ENGAGEMENT, not by
     * log — see `assignmentIdByLogId` below for what happens when the mapping
     * is absent or not unique (answer: no picker, and still no nag).
     */
    history?: DailyLog[];
}

const DISPUTE_REASON = 'या नोंदीवर शंका आहे — एकदा विचारून घ्यायचं आहे.';

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

/**
 * Labour Phase 2 -> Phase 1, Task T4.
 *
 * WHAT WAS WRONG
 * --------------
 * This toast fires from `finalizeBatch`, after the local enqueue and after a
 * BEST-EFFORT sync trigger that nothing awaits an answer from
 * (`triggerSyncBestEffort` swallows its own failure by design). At that instant
 * the only thing the app can prove is that a `verify_log` mutation is sitting in
 * `db.mutationQueue` on this handset. It said `हजेरीही निश्चित` — "attendance is
 * settled too" — which is a claim about a durable server outcome that has not
 * happened and may not happen for hours. `P4`/`P5`.
 *
 * It also used `शंका नोंदवा` — the IMPERATIVE "raise a doubt" — as a
 * CONFIRMATION, while the confirm overlay (`ConfirmOverlay`) and the undo bar
 * (`undoLabel`) both said `शंका नोंदवली` (past tense) for the same tap. One
 * action, three surfaces, two tenses.
 *
 * WHAT IT SAYS NOW, AND WHY EXACTLY THESE WORDS
 * ---------------------------------------------
 * No new Marathi was invented. Every fragment below is already founder-approved
 * and already on a screen: `मंजूर केलं` / `शंका नोंदवली` are this component's own
 * overlay and undo-bar strings, and `फोनवर सेव्ह ✓` is `sync.onPhone` from
 * `i18n/translations.ts` — the phrase T1 and T2 established for "this is on the
 * phone, not yet acknowledged", which is precisely and only what has happened.
 *
 * The `फोनवर सेव्ह ✓` half is NOT decoration. Without it the toast would be
 * byte-identical to the confirm overlay the farmer saw ~3.4 seconds earlier, and
 * they would lose the one signal that the undo window has closed and the record
 * has actually gone. Saying less is not automatically saying it more honestly.
 *
 * `sync.onPhone` is transcribed rather than resolved through `useLanguage` on
 * purpose: this whole screen is hardcoded Marathi, so reading the language
 * preference here would render `मंजूर केलं — Saved on phone ✓` for an English
 * farmer — one fragment in a foreign script inside an otherwise Marathi sheet.
 * If this screen is ever internationalised, this is one of the strings to route
 * through the key.
 *
 * The FAILURE strings are untouched. "could not approve — try again" already
 * claims nothing it cannot evidence, and it names a real, working remedy.
 *
 * THIS FUNCTION IS THE WHOLE OF T4. Ruling R7: the pre-enqueue overlay and its
 * 3s undo window are deliberate and locked by tests. Nothing about ordering,
 * timing or control flow changes — only what the words assert.
 */
/**
 * THE STALE-LITERAL TRAP, CLOSED STRUCTURALLY.
 *
 * `फोनवर सेव्ह ✓` used to be TRANSCRIBED here rather than resolved, so this
 * screen and the header chip could drift apart silently — and the moment
 * `sync.onPhone` was reframed, they did.
 *
 * The original reason for transcribing it still holds and is respected:
 * resolving through `useLanguage` would render `मंजूर केलं — Saved on phone ✓`
 * for an English-preference farmer — one fragment in a foreign script inside an
 * otherwise all-Marathi sheet. So the fix is not to follow the preference; it
 * is to resolve the SAME key at the SAME pinned language. One source, no mixed
 * script, and a founder copy edit now reaches this screen automatically.
 */
const ON_PHONE_MR = translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, 'mr');

function toastFor(kind: ConfirmKind, failedCount: number): string {
    if (kind === 'approveAll') {
        return failedCount === 0
            ? `सगळं मंजूर केलं — ${ON_PHONE_MR}`
            : `${failedCount} नोंदी मंजूर करता आल्या नाहीत — पुन्हा प्रयत्न करा`;
    }
    if (kind === 'query') {
        return failedCount === 0
            ? `शंका नोंदवली — ${ON_PHONE_MR}`
            : 'शंका नोंदवता आली नाही — पुन्हा प्रयत्न करा';
    }
    return failedCount === 0
        ? `मंजूर केलं — ${ON_PHONE_MR}`
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

/**
 * Task 20 (spec: 2026-08-28-labour-v2-release-1) — THE FOUR FACTS AN APPROVAL
 * IS JUDGED ON: how many people, what work, which plot, how much money.
 *
 * Every slot is ALWAYS rendered. `LabourDataPoints` (still used just below
 * this grid) omits what it does not have, which is right for a voice preview
 * — the farmer just said it, so a missing chip is a thing he did not say. It
 * is wrong here: on an approval card an omitted slot reads as "there was
 * none", so a day with no stated cost would look like a day that cost nothing.
 * An unknown slot therefore shows `—`, the codebase's one mark for "we were
 * not told" (P4/R6). A `0` / `₹0` is reserved for a figure the farmer
 * actually stated.
 *
 * The plot slot is the one with three states rather than two: `Farm` scope is
 * the farmer's own संपूर्ण शेत assertion — a fact, so it is stated, not
 * blanked. Only a log we cannot place at all gets the em-dash.
 *
 * No new Marathi is introduced here. `मजूर` is the noun `LabourDataPoints`
 * already puts after this count, and `संपूर्ण शेत` is the founder-approved
 * `oversightTranslations.entireFarmLabel` the plot-picker screens already use.
 */
const UNKNOWN = '—';

const Fact: React.FC<{
    testId: string;
    icon: React.ReactNode;
    value: string;
    known: boolean;
}> = ({ testId, icon, value, known }) => (
    <div
        data-testid={testId}
        className={`flex min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 ${known ? 'bg-stone-100 text-stone-800' : 'bg-stone-50 text-stone-400'}`}
    >
        <span className={`flex-shrink-0 ${known ? 'text-stone-500' : 'text-stone-300'}`}>{icon}</span>
        <span className={`truncate text-[16px] ${known ? 'font-bold' : 'font-semibold'}`}>{value}</span>
    </div>
);

const ReviewFacts: React.FC<{ item: ReviewItem }> = ({ item }) => {
    const { count, task, amount } = item.points;
    // `संपूर्ण शेत` is a stated scope; a plot NAME is a stated place. Anything
    // else — including a plot-scoped log whose plot no longer resolves — is an
    // absence, and absence is the em-dash.
    const plotLabel = item.plotScope === 'Farm'
        ? resolveOversightString('mr', 'entireFarmLabel')
        : (item.plot || null);

    return (
        <div className="grid grid-cols-2 gap-1.5">
            <Fact
                testId={`review-fact-count-${item.id}`}
                icon={<Users size={16} />}
                known={count != null}
                value={`${count != null ? toMr(count) : UNKNOWN} जण`}
            />
            <Fact
                testId={`review-fact-task-${item.id}`}
                icon={<Sprout size={16} />}
                known={!!task}
                value={task || UNKNOWN}
            />
            <Fact
                testId={`review-fact-plot-${item.id}`}
                icon={<MapPin size={16} />}
                known={plotLabel != null}
                value={plotLabel ?? UNKNOWN}
            />
            <Fact
                testId={`review-fact-amount-${item.id}`}
                icon={<Wallet size={16} />}
                known={amount != null}
                value={amount != null ? inr(amount) : UNKNOWN}
            />
        </div>
    );
};

const ReviewSheet: React.FC<Props> = ({ open, data, onClose, onToast, onApproved, farmId, history }) => {
    const [gone, setGone] = useState<Record<string, boolean>>({});
    const [confirming, setConfirming] = useState<Record<string, ConfirmKind>>({});
    const [undoQueue, setUndoQueue] = useState<UndoEntry[]>([]);

    // Imperative bookkeeping for in-flight batches — timers + the data
    // needed to actually send. Not React state: mutating it never needs to
    // (and must not) trigger a re-render on its own.
    const batchesRef = useRef<Map<string, PendingBatch>>(new Map());
    const batchSeqRef = useRef(0);
    const mountedRef = useRef(true);

    /**
     * Task 20 (spec: 2026-08-28-labour-v2-release-1) — THE WHOLE QUEUE, minus
     * only what this session has just acted on.
     *
     * Decision 4b (2026-07-19) filtered `data.review` to the last 14 days here
     * while the तपासा badge (`LabourHub`, `WeeklyDashboard`) kept showing the
     * server's unbounded `dashboard.pending`. Two numbers, one queue, shown as
     * if they were the same: the tile said 60, this sheet listed 12, the badge
     * could never reach zero however much the owner approved, and a log older
     * than a fortnight was unreachable from every screen in the app — no
     * search, no archive, no "older" affordance anywhere.
     *
     * Which failure is worse decides the fix. An unusable list is a usability
     * cost the farmer can see and work around; a record that silently vanishes
     * is the failure this product exists to prevent, and he cannot even know it
     * happened. So nothing is hidden. The server orders newest-first, and the
     * badge and this header now count the same rows by construction.
     *
     * `gone` is not a filter on the record — it is this session's own
     * just-approved set, already collapsed on screen and pending its send.
     */
    const items = data.review.filter((i) => !gone[i.id]);
    /**
     * Labour V1 Task 13 — `dailyLogId -> labourAssignmentId`, and ONLY for a
     * log that carries EXACTLY ONE labour engagement.
     *
     * Attach is addressed by engagement (`AttachFieldOperatorCommand` takes a
     * `LabourAssignmentId`), and a log may legitimately carry several — two
     * gangs on one day, say. Picking "the first one" for a farmer who tapped
     * बाळू would attribute him to an engagement he was never in, which is the
     * same class of error as merging two people with the same name. So a
     * multi-engagement log (and a log with none) gets NO picker at all — and,
     * per P9, no explanation, no warning and no nag either. The V1 limitation
     * is silence, not a prompt.
     */
    const assignmentIdByLogId = useMemo(() => {
        const map = new Map<string, string>();
        (history ?? []).forEach((log) => {
            const ids = (log.labour ?? [])
                .map((event) => event.labourAssignmentId)
                .filter((id): id is string => typeof id === 'string' && id.length > 0);
            if (ids.length === 1) map.set(log.id, ids[0]);
        });
        return map;
    }, [history]);

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
                        what="रोजच्या नोंदी इथे तुम्ही मंजूर करता — स्वतःच्या किंवा तुमच्या माणसांच्या."
                        act="बरोबर असेल तर 'मंजूर', काही चुकलं असेल तर 'शंका' — नंतर विचारता येतं."
                        why="चुका आधीच पकडल्या जातात व हिशोब बरोबर राहतो. ज्याच्यावर विश्वास दिला, त्याच्या नोंदी इथे येत नाहीत — आपोआप मंजूर."
                        label="तपासणी म्हणजे काय?"
                    />
                    {actionable.length > 1 && (
                        <button type="button" data-testid="review-approve-all" onClick={() => approveAll()} className="flex min-h-[60px] w-full items-center justify-center gap-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 py-4 text-[19px] font-bold text-white shadow-lg shadow-emerald-200 active:scale-[0.98]"><Check size={24} strokeWidth={2.5} /> सगळं मंजूर ({actionable.length})</button>
                    )}
                    {items.map((it) => {
                        const kind = confirming[it.id];
                        const assignmentId = assignmentIdByLogId.get(it.id);
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
                                    {/* The four facts the approval is judged on — always all four. */}
                                    <div className="mt-2.5"><ReviewFacts item={it} /></div>
                                    {/*
                                      * Shift and names are EXTRAS, not judgement facts, so they
                                      * keep `LabourDataPoints`' show-what-exists contract: an
                                      * unnamed worker list is a complete record (P9), not a gap,
                                      * and rendering an em-dash for it would invent an obligation
                                      * the farmer does not have.
                                      */}
                                    <div className="mt-1.5"><LabourDataPoints entry={{ shift: it.points.shift, names: it.points.names }} /></div>
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
                                    {/*
                                      * Labour V1 Task 13 — the attribution
                                      * overlay, BELOW मंजूर/शंका on purpose:
                                      * approving is the card's job and stays
                                      * first, so naming people can never read
                                      * as a step the farmer owes before he can
                                      * approve. See FieldOperatorPicker's
                                      * header for the P9 guarantees it holds.
                                      */}
                                    {farmId && assignmentId && (
                                        <FieldOperatorPicker farmId={farmId} labourAssignmentId={assignmentId} onToast={onToast} />
                                    )}
                                    {kind && <ConfirmOverlay kind={kind} />}
                                </div>
                            </div>
                        );
                    })}
                    {items.length === 0 && (
                        <div className="py-8 text-center">
                            <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600"><Check size={30} /></div>
                            <p className="text-[20px] font-bold text-stone-800">सगळ्या नोंदी तपासून झाल्या</p>
                            <p className="mt-1.5 text-[17px] text-stone-500">तपासायला काही उरलं नाही.</p>
                        </div>
                    )}
                    {/*
                      * Task 7 (labour-v2-release-1) — DELETED a static footer
                      * note here: "मंजूर केल्यावर हजेरीही निश्चित होते." ("approving
                      * also settles attendance"). No attendance record exists yet
                      * (`attendance_marks` lands later this release) — approving
                      * settles nothing about presence. P5: a truthful missing
                      * feature beats a fake working one. Removal only, per the
                      * task's copy constraint — no replacement text authored.
                      */}
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
                                <Undo2 size={22} /> मागे घ्या
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
