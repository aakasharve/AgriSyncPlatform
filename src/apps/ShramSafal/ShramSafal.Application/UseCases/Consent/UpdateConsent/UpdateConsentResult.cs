// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — wire-shape of the consent state returned to the
// browser after a successful UpdateConsentHandler call. Same shape as
// the GET /shramsafal/consent/me read (UpdateConsentResult is the
// authoritative post-save echo so the client can drop its optimistic
// snapshot without a follow-up GET).

namespace ShramSafal.Application.UseCases.Consent.UpdateConsent;

public sealed record UpdateConsentResult(
    Guid UserId,
    bool FullHistoryJournal,
    bool CrossFarmAggregation,
    bool ResearchCorpusExport,
    int Version,
    DateTime? GrantedAtUtc,
    DateTime? WithdrawnAtUtc);
