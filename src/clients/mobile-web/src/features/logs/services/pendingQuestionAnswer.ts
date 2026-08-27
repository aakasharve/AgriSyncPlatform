/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * pendingQuestionAnswer — the one-slot store that lets the farmer ANSWER SATHI BY
 * SPEAKING AGAIN (founder decision 3).
 *
 * THE DESIGN DECISION THIS FILE EXISTS TO RECORD.
 * `ssf.question_events` is append-only BY PRIVILEGE — `REVOKE UPDATE, DELETE ON
 * ssf.question_events FROM agrisync_app` (20260713052440_AddDfesDataSpine.cs:256). A row
 * written when the farmer TAPS the question can therefore never afterwards acquire his
 * answer text. Writing on tap permanently guarantees `response = NULL`, which is exactly
 * why `question_events.response` is NULL on every row ever written and why the
 * answer-raises-score path has never fired in production.
 *
 * So the write is DEFERRED until the outcome is known, and exactly ONE row is ever written
 * per (log, question):
 *
 *   | Moment                          | What happens                                      |
 *   |---------------------------------|---------------------------------------------------|
 *   | He taps the question card       | NOTHING is written. The selection is stashed here |
 *   |                                 | and the app routes to the mic, question pinned.   |
 *   | A parse comes back for that day | ONE recordQuestionEvent, skipped:false,           |
 *   |                                 | response = HIS OWN TRANSCRIPT, dailyLogId = the   |
 *   |                                 | stashed sourceLogId. Stash cleared.               |
 *   | He leaves without speaking      | ONE recordQuestionEvent, skipped:true,            |
 *   |                                 | response:null. Stash cleared.                     |
 *   | Any retry of either             | Idempotent — wave-3.3's FindQuestionEventAsync +  |
 *   |                                 | ux_question_events_log_question return the        |
 *   |                                 | existing row.                                     |
 *
 * NEVER SYNTHESISE ANSWER TEXT. `response` is the farmer's transcript verbatim, or null.
 * Doctrine P4: a skip is a skip; it never becomes a guessed answer, and "he left" never
 * becomes "he said nothing of note".
 *
 * THE ONE-QUESTION-PER-DAY GUARD MUST NOT OPEN WHILE THE STASH IS LIVE.
 * `selectDailyQuestion` stops only when a `recentEvents` row carries today's
 * `createdAtLocalDate`. While the stash is live NO row exists yet — so `withPendingMerged`
 * folds the stash in as a synthetic `RecentQuestionEvent`. Client-side only; it never
 * reaches the server.
 *
 * spec: dfes-companion-2026-07-11 (wave-3.7)
 */
import type { RecentQuestionEvent, SelectedQuestion } from './dfesQuestionEngine';
import { recordQuestionEvent } from './dfesQuestionApi';

export interface PendingQuestionAnswer {
    /** The bank key, duplicated out of `selected` so a caller can read it without unpacking. */
    questionKey: string;
    farmId: string;
    plotId: string | null;
    /** Everything the POST needs, exactly as `useDfesQuestion` would have sent it. */
    selected: SelectedQuestion;
    /** When the question was put in front of him — preserved across the mic trip. */
    shownAtUtc: string;
    /** The log the question was ABOUT (wave-3.1/3.2's per-log dedupe key), NOT the log he
     *  is about to speak. Null when the panel had no saved log. */
    sourceLogId: string | null;
    /** The farmer-local date the stash was created on, so a stash surviving overnight is
     *  recognised as stale rather than settled against the wrong day. */
    stashedLocalDate: string;
}

const STORAGE_KEY = 'agrisync.dfes.pendingQuestionAnswer.v1';

/** Module state is the source of truth; sessionStorage is a mirror so a reload
 *  mid-answer does not silently lose the question he is in the middle of answering. */
let slot: PendingQuestionAnswer | null = null;

function mirrorWrite(value: PendingQuestionAnswer | null): void {
    try {
        if (value === null) sessionStorage.removeItem(STORAGE_KEY);
        else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
        // Private-mode / quota / no-storage environments. The module slot still works for
        // the whole in-memory journey; only survival across a reload is lost, and losing
        // it degrades to "he was never asked", which is the safe direction.
    }
}

function mirrorRead(): PendingQuestionAnswer | null {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as PendingQuestionAnswer;
        // Structural sanity — a half-written or older-shaped mirror must not be replayed
        // into a POST that would 400. Treat it as absent.
        return parsed?.questionKey && parsed?.selected && parsed?.farmId ? parsed : null;
    } catch {
        return null;
    }
}

export function stashPendingQuestionAnswer(pending: PendingQuestionAnswer): void {
    slot = pending;
    mirrorWrite(pending);
}

export function readPendingQuestionAnswer(): PendingQuestionAnswer | null {
    return slot ?? (slot = mirrorRead());
}

export function clearPendingQuestionAnswer(): void {
    slot = null;
    mirrorWrite(null);
}

/**
 * Take the slot and empty it in ONE synchronous step.
 *
 * Clearing BEFORE the await is what makes a double-fire impossible: two overlapping
 * settle/abandon calls cannot both see a value, so the append-only table receives at most
 * one row from this client even before wave-3.3's server-side idempotency is consulted.
 */
function take(): PendingQuestionAnswer | null {
    const taken = readPendingQuestionAnswer();
    if (taken !== null) clearPendingQuestionAnswer();
    return taken;
}

/**
 * The farmer spoke. His words become `question_events.response`, verbatim.
 *
 * Returns false when there was nothing pending or the transcript was empty — an empty
 * transcript is NOT an answer, and writing one would defeat `AnsweredGap.TryFrom`, which
 * rejects blank text anyway. THE FOLLOW-UP NEVER BLOCKS THE SAVE: the caller invokes this
 * after the log is already stored, and every failure below is swallowed.
 */
export async function settlePendingQuestionAnswer(
    args: { transcript: string | null | undefined },
): Promise<boolean> {
    const transcript = args.transcript?.trim();
    if (!transcript) return false;

    const pending = take();
    if (pending === null) return false;

    try {
        await recordQuestionEvent(
            pending.farmId, pending.plotId, pending.selected,
            { skipped: false, response: transcript, dailyLogId: pending.sourceLogId },
            pending.shownAtUtc,
        );
        return true;
    } catch {
        // Swallowed by design (spec reliability rules). His log is already saved; a failed
        // telemetry write must never surface as a failed save. The stash stays cleared:
        // re-arming it would risk attaching this transcript to a later, unrelated day.
        return false;
    }
}

/**
 * He left without speaking. Record the SKIP — never an invented answer.
 *
 * A skip is real information: it tells the engine he saw this question and chose not to
 * answer it, which is what `SKIP_COOLDOWN_DAYS` and wave-3.2's per-log exclusion both read.
 */
export async function abandonPendingQuestionAnswer(): Promise<boolean> {
    const pending = take();
    if (pending === null) return false;

    try {
        await recordQuestionEvent(
            pending.farmId, pending.plotId, pending.selected,
            { skipped: true, response: null, dailyLogId: pending.sourceLogId },
            pending.shownAtUtc,
        );
        return true;
    } catch {
        return false;
    }
}

/**
 * A stash that outlived its day. He was shown the question and never answered it, so this
 * abandons it honestly rather than deleting it silently — and it is what stops yesterday's
 * stash holding today's guard shut forever.
 */
export async function abandonStalePendingQuestionAnswer(todayLocalDate: string): Promise<boolean> {
    const pending = readPendingQuestionAnswer();
    if (pending === null || pending.stashedLocalDate === todayLocalDate) return false;
    return abandonPendingQuestionAnswer();
}

/**
 * Fold a live stash into the recent-events feed as a synthetic row, so the
 * one-question-per-day guard stays shut while he is on his way to the microphone.
 *
 * `pending` is injectable so a caller can CAPTURE the stash synchronously and merge it
 * after an await — `useDfesQuestion` does exactly that, because the settle path may clear
 * the slot while its fetch is still in flight, and a guard that opened in that window would
 * put a second question in front of him the same day.
 */
export function withPendingMerged(
    recentEvents: RecentQuestionEvent[],
    todayLocalDate: string,
    pending: PendingQuestionAnswer | null = readPendingQuestionAnswer(),
): RecentQuestionEvent[] {
    if (pending === null || pending.stashedLocalDate !== todayLocalDate) return recentEvents;
    return [
        ...recentEvents,
        {
            questionKey: pending.questionKey,
            createdAtLocalDate: todayLocalDate,
            ageDays: 0,
            // NOT a skip. He has not decided yet; calling it a skip here would let
            // SKIP_COOLDOWN_DAYS start running against a question he is on his way to answer.
            skipped: false,
            dailyLogId: pending.sourceLogId,
        },
    ];
}
