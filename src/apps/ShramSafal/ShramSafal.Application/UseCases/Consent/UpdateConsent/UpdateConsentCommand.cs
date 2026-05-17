// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — request envelope for UpdateConsentHandler. Mirrors
// the Phase 04 Route A pattern (UserId + ClientAppVersion + audit
// provenance threaded from the endpoint via httpContext.AuditClaims()
// straight onto the command DTO) so the handler can stamp the
// ConsentAuditEntry row without reaching into HttpContext.

namespace ShramSafal.Application.UseCases.Consent.UpdateConsent;

public sealed record UpdateConsentCommand(
    // Endpoint-sourced caller identity. Cannot be Guid.Empty (the
    // endpoint rejects unauthenticated requests with 401 before this
    // handler runs).
    Guid UserId,

    // Three independent purpose toggles. Null = "leave as-is" so a
    // client can flip one without re-sending the other two.
    bool? FullHistoryJournal,
    bool? CrossFarmAggregation,
    bool? ResearchCorpusExport,

    // The DPDP §5 language the consent text was rendered in (mr-IN |
    // hi-IN | en-IN). Stamped on the audit row so counsel can replay
    // "which language did this user agree to".
    string LanguageShown,

    // Version of the consent text the user agreed to. Bumps when
    // counsel approves a new agreement; an audit row is written every
    // time the version on a save changes.
    int ConsentTextVersion,

    // Audit provenance (mirror of IssueTenantDekCommand defaults so
    // direct-construction unit tests stay green).
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
