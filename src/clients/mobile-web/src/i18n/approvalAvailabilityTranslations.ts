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
 * Both keys are category (c) — "keyless-but-declared" in
 * `oversightTranslations.ts`'s taxonomy: `mr: ''`, the literal honest
 * encoding of "not written yet", with the English populated and reachable
 * through `resolveApprovalAvailabilityString()` below. No Devanagari is
 * invented here, and none is borrowed from a neighbouring string on my own
 * judgment: the nearest candidates (`dfes.needsReview` = "तपासायचे आहे",
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
 * FOUNDER: both strings below need your Marathi. They are listed in
 * `PENDING_FOUNDER_STRINGS` and rendered in English until you supply it.
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
     * hunting for a control that is not there: he can still read
     * everything, his approval cannot be recorded yet, and there is
     * therefore nothing to tap.
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
        approvalUnavailableBody:
            'You can read every entry here. Your approval cannot be recorded yet, so there is no approve button.',
    },
    mr: {
        // Category (c) — `mr: ''` by design. NO Marathi is invented here;
        // `resolveApprovalAvailabilityString()` reads through to the
        // English until the founder supplies his own words.
        approvalUnavailableTitle: '',
        approvalUnavailableBody: '',
    },
};

/**
 * Every key in this module awaiting founder Marathi. Both of them, today.
 * Asserted against the real key set by
 * `__tests__/approvalAvailabilityTranslations.test.ts`, so this list can
 * never point at a typo.
 */
export const PENDING_FOUNDER_STRINGS: readonly (keyof ApprovalAvailabilityTranslations)[] = [
    'approvalUnavailableTitle',
    'approvalUnavailableBody',
];

/**
 * The one mechanical place `mr: ''` turns into readable text on screen.
 * Same shape and same reasoning as
 * `oversightTranslations.resolveOversightString` — a consuming component
 * never has to know which keys are hollow, and a hollow key renders English
 * rather than a blank label.
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
