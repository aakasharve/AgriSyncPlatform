/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: 2026-08-25-prod-cutover-waves (founder review of `?preview=oversight`,
 * 2026-08-26 — ruling A2)
 *
 * ONE COUNT, TWO SURFACES — THE FACT THE HOME SCREEN'S HERO MUST NOT ARGUE WITH
 * ============================================================================
 * The founder opened the home screen and read, top to bottom:
 *
 *     oversight strip   [!] ... 4                (four rows are waiting for him)
 *     daily-loop hero   आज सगळं सांगून झालं — काही बाकी नाही.
 *                       ("today everything is told — nothing left")
 *
 * Both numbers were individually TRUE and neither was fabricated. The strip
 * counts rows waiting for the OWNER (`OversightModel.waitingCount` —
 * approvals, unseen people, failed/unqueueable sends); the hero's line counts
 * TODAY'S UNLOGGED PLANNED TASKS (`todayDayState.pendingCount`). A farmer does
 * not parse that distinction. He reads "4 pending" above "all done", and one
 * of the two must be lying to him. Doctrine P4 is about what REACHES the
 * farmer, and what reached him was false.
 *
 * `DailyLoopHero.tsx`'s own header used to claim "The ring beside it reads
 * from the SAME fact, so the two can never contradict." That was true of the
 * RING (both derive from `todayDayState`) and false of the STRIP, which the
 * hero could not see at all. This module is what makes the claim true of the
 * strip too — and that comment has been corrected, not left standing.
 *
 * WHY A MODULE-LEVEL STORE AND NOT A PROP
 * ---------------------------------------
 * `waitingCount` is built inside `AppHeader` (`buildOversightModel`), from
 * four sources only that component holds: `oversightData` (props),
 * `useOversightAcknowledgement`'s checkpoint, `useSyncQueueStatus` and
 * `useUnqueueableLogCount`. `AppHeader` is a SIBLING of `<main>`
 * (`AppContent.tsx`), so there is no prop path from it down into
 * `AppRouter` → `mainView.renderLogView` → `DailyLoopHero`; and
 * `renderLogView` is a plain function, not a component, so it cannot call a
 * hook to fetch the fact itself (`routeContext.ts` keeps it hook-free on
 * purpose).
 *
 * Rebuilding the model a second time on the log-view side was considered and
 * REJECTED: `useSyncQueueStatus` polls Dexie on its own 3-second timer, so two
 * independent constructions can legitimately disagree for one poll interval —
 * and a transient disagreement is exactly the defect this exists to remove,
 * merely made rarer and harder to reproduce. What is published here is not a
 * recomputation; it is the SAME NUMBER the strip renders, forwarded.
 *
 * The pattern is not new to this codebase. `features/sync/status/
 * unqueueableLogs.ts` is a module-level subscribable store used for the same
 * class of problem (a fact one surface holds and another surface, in a
 * different subtree, must not contradict), and `useUnqueueableLogCount` is the
 * hook shape copied below.
 *
 * NULL IS "NO CLAIM", NOT "NOTHING" (finding F8's rule, applied here)
 * -------------------------------------------------------------------
 * The published value is `number | null`, and `null` is load-bearing:
 *
 *   > 0   the strip is showing that many waiting rows.
 *   0     the strip is in its REST state — a positive, evidenced claim that
 *         nothing is outstanding (`CanonicalStrip`'s green tick).
 *   null  the strip is making NO count claim: it is checking, it cannot
 *         confirm (unresolved data, or an account with 2+ farms whose inputs
 *         are not farm-scoped), or it is not on screen at all.
 *
 * A consumer may only make a "nothing is left" claim on `0`. `null` must never
 * be read as zero — that is precisely the "a zero meaning UNKNOWN reported as
 * NONE" failure `oversightSelectors.ts`'s own header documents, and `?? 0`
 * anywhere against this value would reintroduce it.
 *
 * SESSION-SCOPED, PUBLISHER-OWNED. Plain module state, gone on reload, and the
 * publisher (`AppHeader`) resets it to `null` when it unmounts, so no consumer
 * can ever inherit a stale zero from a header that is no longer on screen.
 *
 * No imports beyond React's hook primitives, on purpose: the publisher is a
 * header component and the consumer is a log-screen component, and neither
 * should acquire the other's dependencies.
 */
import { useEffect, useState } from 'react';

/**
 * The last count the oversight strip actually rendered, or `null` when it is
 * making no count claim. Starts `null` — nothing has been measured before the
 * header's first commit, and "not measured yet" is not "nothing outstanding".
 */
let waitingSignal: number | null = null;

type WaitingSignalListener = (signal: number | null) => void;

const listeners = new Set<WaitingSignalListener>();

function notifyListeners(): void {
    for (const listener of listeners) {
        try {
            listener(waitingSignal);
        } catch (err) {
            console.error('Error in oversight waiting-signal listener:', err);
        }
    }
}

/**
 * The strip's four states, reduced to the one question a consumer needs
 * answered: "is the oversight surface currently claiming a count, and what is
 * it?"
 *
 * This mirrors `CanonicalStrip`'s own state selection exactly, and the mirror
 * is asserted rather than assumed — `oversightWaitingSignal.test.tsx` renders
 * the real `CanonicalStrip` and proves `resolveWaitingSignal(...) === 0` holds
 * if and only if the strip renders its rest tick. Read alongside that file
 * before changing either.
 *
 *   waitingCount > 0                      -> `waitingLabel` (amber + badge)
 *   0, resolved, exactly one farm         -> `restState`   (green tick)
 *   0, unresolved                         -> `checkingState` / `unknownState`
 *   0, resolved, 2+ farms                 -> `unknownState`
 *
 * Only the middle case is a claim that nothing is outstanding; the last two
 * are the strip declining to claim, and they publish `null`.
 */
export function resolveWaitingSignal(
    waitingCount: number,
    dataResolved: boolean,
    farmCount: number,
): number | null {
    if (waitingCount > 0) {
        return waitingCount;
    }
    return dataResolved && farmCount < 2 ? 0 : null;
}

/**
 * Publishes what the oversight strip is currently saying.
 *
 * Called from `AppHeader` — the one component that builds `OversightModel` —
 * with the SAME `waitingCount` it hands `CanonicalStrip` on the same render.
 * Pass `null` when the strip is not rendered at all.
 */
export function publishOversightWaitingSignal(signal: number | null): void {
    if (waitingSignal === signal) {
        return;
    }
    waitingSignal = signal;
    notifyListeners();
}

/** What the strip is currently saying, without subscribing. */
export function readOversightWaitingSignal(): number | null {
    return waitingSignal;
}

/** Subscribe to changes. Returns the unsubscribe function. */
export function subscribeToOversightWaitingSignal(
    listener: WaitingSignalListener,
): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * Forgets the published signal (back to "no claim").
 *
 * Used by tests to isolate module state between cases, and by `AppHeader`'s
 * own unmount cleanup — a header that has left the screen is not evidence
 * that nothing is outstanding.
 */
export function resetOversightWaitingSignal(): void {
    publishOversightWaitingSignal(null);
}

/**
 * Reactive read of the strip's current claim.
 *
 * SUBSCRIBED, NOT POLLED, and re-read on mount for the same reason
 * `useUnqueueableLogCount` re-reads: the publisher's effect and this
 * consumer's effect run in the same commit, and whichever ordering React
 * chooses, a value published between this hook's initial `useState` and its
 * subscription must not be missed. "Missed" here means the hero silently
 * withholds a true line, or — far worse if the default were ever flipped to
 * `0` — states one it cannot support.
 */
export function useOversightWaitingSignal(): number | null {
    const [signal, setSignal] = useState<number | null>(() => readOversightWaitingSignal());

    useEffect(() => {
        setSignal(readOversightWaitingSignal());
        return subscribeToOversightWaitingSignal(setSignal);
    }, []);

    return signal;
}
