// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — read-side wire shape for GET /shramsafal/consent/me.
// Same field set as UpdateConsentResult so the client can render either
// payload through one code path.

namespace ShramSafal.Application.UseCases.Consent.GetConsent;

public sealed record GetConsentResult(
    Guid UserId,
    bool FullHistoryJournal,
    bool CrossFarmAggregation,
    bool ResearchCorpusExport,
    int Version,
    DateTime? GrantedAtUtc,
    DateTime? WithdrawnAtUtc,
    // ADDITIVE (old clients ignore it). Start of the CURRENT continuous grant
    // of the voice full-history purpose, derived from the consent ledger.
    // null when not granted or when the ledger cannot show the start; a client
    // MUST treat null-while-granted as "unknown" and upload nothing.
    DateTime? FullHistoryJournalGrantedSinceUtc = null,
    // ADDITIVE (plr-d10 I25, founder D-13). The notice in force on the server. Information
    // only: the server never refuses a request because a phone accepted an older notice.
    string? CurrentNoticeVersion = null,
    // ADDITIVE. The notice version of this person's newest accepted (and linked) notice,
    // from the append-only ledger. null = none found OR could not be read: a phone treats
    // null as "ask", never as "already accepted".
    string? AcceptedNoticeVersion = null,
    // ADDITIVE. Server time that newest acceptance was recorded.
    DateTime? NoticeAcceptedAtUtc = null,
    // ADDITIVE (founder D-31). Which words the "keep my original voice" choice was last made
    // under; null = unknown (made on an older phone, or never made).
    string? FullHistoryJournalWordingVersion = null);
