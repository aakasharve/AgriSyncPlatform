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
    DateTime? FullHistoryJournalGrantedSinceUtc = null);
