/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The sentences the save path says to the farmer, and nothing else.
 *
 * WHY A SEPARATE MODULE
 * ---------------------
 * These two builders were inline in `useLogCommands.ts`, which sat at 797 of
 * the 800 lines `check:file-sizes` allows — so the wording work could not land
 * without either splitting something or raising a cap. Splitting is the right
 * answer twice over here: they are PURE (plain data in, one string out) and
 * they were the only part of that hook a wording test needed, so testing them
 * used to mean standing up `renderHook`, four mocked services and a fake
 * DataSource to assert a sentence.
 *
 * Nothing about WHEN these fire moved. The decisions — which branch, which
 * toast `type`, how long it stays up — stay with the caller; this module only
 * decides what the words are.
 *
 * ── THE RULE THESE SENTENCES OBEY ────────────────────────────────────────────
 * The reassurance comes FIRST, and it is the SAME string the header chip uses.
 * (T2 review, finding B4.) A red panel over "0 of 1" reads as "your record is
 * GONE", so the farmer records the day again and the ledger now holds it twice.
 * The record genuinely is safe on the handset — `confirmAndSave` -> `batchSave`
 * ran before any enqueue was attempted — and not saying so is what causes the
 * duplicate. Every caller-side test asserts `startsWith`, not `contains`.
 *
 * ── AND THE ONE THEY DO NOT ──────────────────────────────────────────────────
 * Never "not yet". A skipped log `continue`s before any queue row is written
 * (`logSyncMutationService.ts:324-327`), so no worker will ever pick it up and
 * no drawer can list it. "will not" is the honest tense (finding B3); a promise
 * of a retry that no code path can keep is the same class of defect this whole
 * phase exists to remove.
 *
 * @module app/helpers/saveToastMessages
 */
import { SYNC_HONESTY_I18N_KEYS } from '../../features/sync/status/syncHonestyState';
import { t as translate, tf as translateFormat, type Language } from '../../i18n/translations';

/** Mirrors the caller's toast shape; kept local so this module imports no UI. */
export interface SaveToastMessage {
    message: string;
    type: 'success' | 'error' | 'partial';
}

/** The subset of `enqueueLogsForSync`'s result these sentences are built from. */
export interface EnqueueOutcomeSummary {
    queuedLogIds: readonly string[];
    skippedLogIds: readonly string[];
}

/**
 * The phone claim, in the farmer's language — one lookup, one definition.
 * Exported because the callers compose it into sentences of their own and must
 * not restate the key.
 */
export const onPhoneClaim = (language: Language): string =>
    translate(SYNC_HONESTY_I18N_KEYS.ON_PHONE, language);

/**
 * The toast for a save whose records did NOT all reach the sync queue.
 *
 * `enqueueLogsForSync` has always returned `skippedLogIds` — the logs it could
 * not queue because `resolveSyncTarget` found no plot or no crop cycle. Until
 * T2 that array had zero production consumers: every call site discarded the
 * result and fired a success toast unconditionally, so the exact records the
 * app already KNEW it had dropped were the records the farmer was told were
 * saved (`P4`, `P5`).
 *
 * BOTH NUMBERS COME OFF THE OUTCOME OBJECT, never off the submitted set, so a
 * partial save reads `2 of 3` and can never round a dropped record up into a
 * saved one.
 *
 * Returns `null` when there is nothing to confess — the caller's signal that
 * its own success wording is legitimate, so the happy path is byte-identical.
 * `null` is also what a demo-mode save produces (no enqueue was attempted, so
 * there is no evidence in either direction and no claim to make).
 *
 * NOT COVERED, STATED PLAINLY: a log lost to a THROW out of
 * `MutationQueue.enqueue` is invisible here — `skippedLogIds` structurally
 * cannot see it — and that path surfaces an honest "Failed to save logs"
 * through the caller's catch instead.
 */
export function buildSkippedSyncToast(
    outcome: EnqueueOutcomeSummary | null,
    language: Language,
): SaveToastMessage | null {
    if (!outcome || outcome.skippedLogIds.length === 0) {
        return null;
    }

    const skipped = outcome.skippedLogIds.length;
    const handled = outcome.queuedLogIds.length + skipped;

    return {
        message: `${onPhoneClaim(language)} — ${translateFormat('sync.notFiledCountTail', language, { skipped, handled })}`,
        // `'partial'`, not `'error'`. A record that will never reach the server
        // is a real incompleteness, but a red panel with an X is read before any
        // words are, and a farmer who reads "gone" re-records. The alarm is
        // proportionate to what actually happened.
        type: 'partial',
    };
}

/**
 * The toast for a successful EDIT.
 *
 * Two true things and no more:
 *   1. The record is on the phone — evidenced, because `updateLog` returns
 *      success only after `repo.save` resolved.
 *   2. What reached the SERVER, and ONLY when something did.
 *      `persistedLabourCorrections` is the only server evidence in scope;
 *      `postLabourCorrection` throws on any non-2xx and the throw becomes
 *      `success: false`, so a number here means the server answered.
 *
 * THE ZERO BRANCH STOPS SHORT, deliberately. "Nothing was sent" is true but it
 * is the normal, uninteresting case — a farmer who fixed an irrigation figure
 * sent nothing because there was nothing labour-shaped to send. Announcing an
 * absence there would be a nag on the correction path (`P9`), so it makes no
 * server claim at all rather than a negative one. `P4` cuts both ways: no claim
 * beats a claim with no use.
 *
 * `R19` is DONE, not pending: the old "shown on screen only — not saved
 * anywhere" sentence was DELETED when `updateLog` started persisting, not
 * softened. Do not reintroduce a screen-only caveat here.
 *
 * ── AND A THIRD TRUE THING, WHICH IS NOT THE R19 SENTENCE (final review, F-1) ─
 *
 * `unsentChanges` adds `sync.unsentEditTail`. It denies a SERVER write that does
 * not happen; the deleted sentence denied a LOCAL save that does. Distinguishing
 * them is the whole point:
 *
 *   deleted (false)  "shown on screen only — not saved anywhere"
 *   restored (true)  "the rest of this edit will not reach your farm records"
 *
 * `updateLog` POSTs labour corrections and NOTHING else, and the edit branch
 * enqueues no mutation of any kind — so for everything else there is no queue
 * row, no worker and no retry. "will not" is therefore the honest tense, the
 * same one `buildSkippedSyncToast` uses and for the same reason.
 *
 * The tail is ONLY appended when `updateLog` proves there is something to
 * confess (`UpdateLogResponse.hasUnsentChanges`, computed by diffing the record
 * against what the accepted corrections carried). An edit that changed only a
 * headcount, and sent it, says nothing extra — announcing an absence there would
 * be the nag `P9` forbids, and the zero branch above already refuses to do it.
 *
 * ORDER: phone claim, then what DID reach the server, then what did not. The
 * reassurance comes first, and the news the farmer can do nothing about comes
 * last.
 *
 * ── AND THE ONE CASE WHERE THE PHONE CLAIM ITSELF IS FALSE (V2 R1, Task 23) ──
 *
 * `startsWith(onPhoneClaim)` used to hold in EVERY branch, because the claim
 * was made on one thing: `repo.save` resolved. For an edit that ADDED or
 * REMOVED a labour engagement on an already-saved day that is not enough.
 * Nothing in this system can carry an add or a remove to a server — there is no
 * such correction, no such sync mutation and no such route — so `resolveLabour`
 * replaces the handset's engagement list with the server's on the next delta
 * pull, and the addition is deleted (a removal restored) within the sync
 * interval. "लक्षात ठेवलं ✓" over that is a success message for an operation
 * that did not happen, which is the one thing this module exists to prevent.
 *
 * SO THE CLAIM IS DROPPED, NOT REPLACED. `phoneClaimHolds: false` removes the
 * reassurance and leaves the tails, which are already-approved copy —
 * `sync.unsentEditTail` already renders on exactly this branch. No new sentence
 * is invented here; the farmer-facing wording is the founder's to approve.
 *
 * WHY DROPPING IT IS NOT A REVERSAL OF THE RULE AT THE TOP OF THIS FILE. That
 * rule rests on a premise — "the record genuinely IS safe on the handset" —
 * and this is the one branch where the premise is false. It is deliberately
 * NARROW: `unsentChanges` alone never removes the claim, because an irrigation
 * figure the server was never told about does still sit in `db.logs` and does
 * still show on every screen. Widening it would trade a lie for a different
 * one, and would invite the duplicate re-recording the rule was written to stop.
 *
 * `phoneClaimHolds` DEFAULTS TO TRUE, and that default is not safe — it
 * suppresses the correction, exactly like the `?? false` its caller documents.
 * It defaults that way so the happy path stays byte-identical; any new producer
 * of `UpdateLogResponse` must pass this rather than lean on the default.
 */
export function buildEditSavedMessage(
    persistedCorrections: number,
    language: Language,
    unsentChanges = false,
    phoneClaimHolds = true,
): string {
    const tails: string[] = [];

    if (persistedCorrections > 0) {
        const tailKey = persistedCorrections === 1
            ? 'sync.correctionsFiledTailOne'
            : 'sync.correctionsFiledTailMany';
        tails.push(translateFormat(tailKey, language, { count: persistedCorrections }));
    }

    // `|| !phoneClaimHolds` rather than a separate branch: a phone claim that
    // does not hold IS an unsent change, and stating it here is what guarantees
    // the message below can never come out empty once the reassurance is gone.
    // A silent confirmation is its own dishonesty — the farmer taps जतन and
    // learns nothing.
    if (unsentChanges || !phoneClaimHolds) {
        tails.push(translate('sync.unsentEditTail', language));
    }

    if (!phoneClaimHolds) {
        return tails.join(' ');
    }

    const onPhone = onPhoneClaim(language);
    return tails.length === 0 ? onPhone : `${onPhone} — ${tails.join(' ')}`;
}
