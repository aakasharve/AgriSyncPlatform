// spec: data-principle-spine-2026-05-05/06.4
//
// Consent transport shapes (Phase 06 — Consent Domain). The backend
// surface lives at PUT/GET `/shramsafal/consent/me` and POST
// `/shramsafal/consent/token/issue` (06.2, 06.3 — implemented in
// parallel by implementor-backend). If the wire shape diverges from
// what's declared below at integration time, fix this file in a
// follow-up commit; no other module mirrors these names.

/** Wire shape for the three independent consent toggles. */
export interface ConsentStateDto {
    fullHistoryJournal: boolean;
    crossFarmAggregation: boolean;
    researchCorpusExport: boolean;
    version: number;
    acceptedAtUtc: string | null;
    revokedAtUtc: string | null;
    /** ADDITIVE, GET only: server-derived start of the CURRENT voice grant (null/absent = unknown). */
    fullHistoryJournalGrantedSinceUtc?: string | null;
    /** ADDITIVE, GET only (plr-d10 I25, D-13): the notice in force on the server. */
    currentNoticeVersion?: string | null;
    /**
     * ADDITIVE, GET only (D-13): the version of this person's newest accepted notice, from the
     * server's ledger. null/absent = none found OR not readable — treat as "ask", never as
     * "already accepted".
     */
    acceptedNoticeVersion?: string | null;
    /** ADDITIVE, GET only: when that acceptance was recorded (server time). */
    noticeAcceptedAtUtc?: string | null;
    /** ADDITIVE (D-31): the words version the "keep my original voice" choice was made under. */
    fullHistoryJournalWordingVersion?: string | null;
}

/**
 * PUT `/shramsafal/consent/me` body. Any of the three flag fields may
 * be omitted (partial update); the audit row records the new full
 * state regardless. `languageShown` is the locale code (mr-IN,
 * en-IN) the user actually saw when consenting — required for the
 * audit row per plan §6.1.3.
 */
export interface UpdateConsentRequest {
    fullHistoryJournal?: boolean;
    crossFarmAggregation?: boolean;
    researchCorpusExport?: boolean;
    /** Locale the consent text was shown in. Required. */
    languageShown: string;
    /** Consent text version the user saw. Required. */
    consentTextVersion: number;
    /** Client app version string. Required for the audit row. */
    clientAppVersion: string;
    /**
     * ADDITIVE (plr-d10 I25, founder D-31): the version of the words shown for the "keep my
     * original voice" switch. Send it only when that switch's choice is being made.
     */
    fullHistoryJournalWordingVersion?: string;
}

/**
 * GET/PUT `/shramsafal/consent/improvement` reply (plr-d10 I25, founder D-36) — the OPTIONAL
 * improvement permission, the caller's own. `allowed` is what he last chose (false when he
 * never chose); `allowedUnderCurrentWording` is whether that choice counts on the server now.
 */
export interface ImprovementPermissionDto {
    allowed: boolean;
    wordingVersion: string | null;
    chosenAtUtc: string | null;
    currentWordingVersion: string;
    allowedUnderCurrentWording: boolean;
}

/** PUT `/shramsafal/consent/improvement` body. The user is the caller; never sent. */
export interface SetImprovementPermissionRequest {
    allowed: boolean;
    wordingVersion: string;
    languageShown: string;
}
