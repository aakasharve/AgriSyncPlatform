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
    DateTime? WithdrawnAtUtc);
