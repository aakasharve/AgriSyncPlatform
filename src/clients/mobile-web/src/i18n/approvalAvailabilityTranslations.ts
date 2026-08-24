/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * spec: owner-oversight-loop
 *
 * The copy the two log-approval surfaces show INSTEAD of an approve button.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ReviewInboxSheet` (the destination of the waiting drawer's `approval`
 * row) and `ReviewInbox` (Reflect) both used to offer Approve / Dispute.
 * Both routed through `app/hooks/useTrustLayer.ts` -> `application/usecases/
 * VerifyLog.ts`, which enqueues `verify_log_v2`. That mutation's server
 * handler is NOT wired: `PushSyncBatchHandler.cs` returns a typed
 * `MUTATION_TYPE_UNIMPLEMENTED`, `RejectionPolicy.ts` classifies that code
 * as PERMANENT, and the row lands in `REJECTED_USER_REVIEW` forever. The
 * owner tapped approve and the server refused, every single time.
 *
 * `P5` — "a truthful missing feature beats a fake working one" — leaves
 * exactly two options: disable it or make it real. Making it real means
 * routing to the v1 `verify_log` path, and `VerifyLogHandler.cs` calls
 * `OnLogVerifiedAutoVerifyJobCard.HandleAsync(...)` on every success, which
 * walks a job card `Completed -> VerifiedForPayout`. That is a money path,
 * and switching it on for pilot farmers is a founder decision that has not
 * been made. So: disabled, and SAID OUT LOUD. This file is the "said out
 * loud" half — the reason a farmer reads where the button used to be.
 *
 * THE MARATHI RULE (spec §6, "No agent may invent farmer-facing Marathi")
 * -----------------------------------------------------------------------
 * Both keys SHIPPED as category (c) — "keyless-but-declared" in
 * `oversightTranslations.ts`'s taxonomy: `mr: ''`, the literal honest
 * encoding of "not written yet", with the English populated and reachable
 * through `resolveApprovalAvailabilityString()` below. No Devanagari was
 * invented here, and none was borrowed from a neighbouring string: the
 * nearest candidates (`dfes.needsReview` = "तपासायचे आहे",
 * `oversight.decisionLine` = "{count} कामे तपासायची आहेत") all say a
 * decision IS wanted, which is the precise opposite of what these two lines
 * have to say.
 *
 * This lives in its own leaf module rather than in `translations.ts`
 * because `t()` there falls back to the KEY, not to English, when a value
 * is empty (`translations.ts`: `return typeof value === 'string' ? (value
 * || key) : key`) — a Marathi farmer would be shown the literal string
 * `approval.unavailableTitle`. It is not in `oversightTranslations.ts`
 * because that file is owned by another agent on this branch and is
 * read-only to this change.
 *
 * BOTH KEYS GRADUATE — founder message, 2026-08-24
 * --------------------------------------------------
 * The founder supplied the Marathi directly, in his own words, in a
 * coordinator message. `PENDING_FOUNDER_STRINGS` below is now EMPTY and
 * neither `mr` value is hollow.
 *
 *   `approvalUnavailableTitle` — 'approval आजून उपलब्ध नाहीये', his own,
 *   verbatim. Two things in it are deliberate and are NOT to be "fixed":
 *   the Latin-script word `approval`, which is his chosen term for the
 *   control the farmer is looking for and which he left in Latin on
 *   purpose; and his spelling "आजून" (not normalised to "अजून"). Both are
 *   byte-pinned in `__tests__/approvalAvailabilityTranslations.test.ts`.
 *
 *   `approvalUnavailableBody` — 'इथे सगळं बघू शकता. approval नंतर देता
 *   येईल.' Written by a coordinator agent and APPROVED by him after he read
 *   the previous English ("Your approval cannot be recorded yet, so there
 *   is no approve button") and called it too complicated. The English below
 *   was replaced in the same ruling, to match the register of his own
 *   title: two short sentences, no mechanism, no apology.
 *
 * Both keys keep the constraint their doc comments already state: they name
 * the state of the FEATURE, never the state of the records, and neither
 * promises a date (`P4`). "नंतर" is a sequence, not a schedule.
 */

import type { Language } from './language';

export interface ApprovalAvailabilityTranslations {
    /**
     * Heading on the notice that stands where the approve control used to
     * be. Names the state of the FEATURE, never the state of the records —
     * the records really are unverified, and that separate (true) sentence
     * is still shown beside this one.
     */
    approvalUnavailableTitle: string;
    /**
     * The body line. Says the one thing the owner needs in order to stop
     * hunting for a control that is not there: he can still see everything,
     * and approving is a later thing, not a missing thing.
     *
     * Deliberately makes NO promise about when it will work — a date or a
     * "soon" would be a claim about the future that nothing in the repo
     * supports (`P4`).
     */
    approvalUnavailableBody: string;
}

export const approvalAvailabilityTranslations: Record<Language, ApprovalAvailabilityTranslations> = {
    en: {
        approvalUnavailableTitle: 'Approving is not available yet',
        // Replaced 2026-08-24 in the same founder ruling that supplied the
        // Marathi below. The previous line ("Your approval cannot be
        // recorded yet, so there is no approve button") is what he called
        // too complicated; this matches the register of his own title.
        approvalUnavailableBody: 'You can see everything here. Approving will come later.',
    },
    mr: {
        // GRADUATED 2026-08-24 — founder message. The title is his own,
        // verbatim, INCLUDING the Latin-script word `approval` and his
        // spelling "आजून"; the body is coordinator-written copy he approved
        // in the same message. See this file's header, "BOTH KEYS
        // GRADUATE". Neither is hollow any more.
        approvalUnavailableTitle: 'approval आजून उपलब्ध नाहीये',
        approvalUnavailableBody: 'इथे सगळं बघू शकता. approval नंतर देता येईल.',
    },
};

/**
 * Every key in this module awaiting founder Marathi. EMPTY as of
 * 2026-08-24 — he ruled on both (see this file's header, "BOTH KEYS
 * GRADUATE"). Kept, not deleted: it is the contract
 * `__tests__/approvalAvailabilityTranslations.test.ts` checks the hollow
 * set against, so "nothing is pending" stays an asserted claim rather than
 * an absence, and the next unwritten string has somewhere to be listed.
 */
export const PENDING_FOUNDER_STRINGS: readonly (keyof ApprovalAvailabilityTranslations)[] = [];

/**
 * The one mechanical place `mr: ''` turns into readable text on screen.
 * Same shape and same reasoning as
 * `oversightTranslations.resolveOversightString` — a consuming component
 * never has to know which keys are hollow, and a hollow key renders English
 * rather than a blank label. Its fallback branch is UNEXERCISED as of
 * 2026-08-24 (neither key is hollow any more); it stays for the same reason
 * the oversight one does — every call site already routes through it, so a
 * future hollow key is safe without touching a component.
 */
export function resolveApprovalAvailabilityString(
    language: Language,
    key: keyof ApprovalAvailabilityTranslations,
): string {
    const value = approvalAvailabilityTranslations[language][key];
    if (value !== '') {
        return value;
    }
    return approvalAvailabilityTranslations.en[key];
}
