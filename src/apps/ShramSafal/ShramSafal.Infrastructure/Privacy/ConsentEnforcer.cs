// spec: voice-diary-e2e-2026-05-17 (B.3)
//
// Wave 1.B — implementation of IConsentEnforcer authored in B.2. Reads
// the live UserConsentState via IShramSafalRepository.GetUserConsentStateAsync
// (Phase 06.1; default impl returns null so test doubles compile),
// maps ConsentPurpose enum to the matching aggregate property, and
// returns Allowed/Denied accordingly.
//
// Audit emission on deny:
//   Per DPDP §16 export shape (Phase 06.1 doctrine) we append a
//   ConsentAuditEntry with old_state == new_state (no diff — this is
//   an enforcement event, not a state change) so the ledger captures
//   "consent was checked, found insufficient, request was blocked".
//   Provenance fields default to deterministic system values because
//   the enforcer is called from background-shaped boundaries
//   (ParseVoiceInputHandler runs inside an HTTP request but the
//   CONSENT-DENY moment doesn't have the same HttpContext.AuditClaims
//   plumbing that UpdateConsentHandler enjoys — Phase 04 Route A is
//   not threaded into this surface yet). The audit row still carries
//   appVersion="voice-diary-consent-enforcer" + deviceId="server" +
//   ipHash="sha256:server" so the schema's NOT NULL invariants pass.
//   A future ticket may thread real HttpContext audit claims through
//   via a scoped ICurrentAuditClaims port; not in this ship.
//
// Lifetime: Scoped (the underlying IShramSafalRepository is Scoped via
// EF Core; sharing the per-request DbContext keeps reads inside the
// outer transaction so the consent state matches what the handler is
// about to act on).

using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Infrastructure.Privacy;

public sealed class ConsentEnforcer(
    IShramSafalRepository repository,
    IClock clock) : IConsentEnforcer
{
    // Conservative default. The Voice Diary feature ships with consent
    // OFF by default (DPDP §6(1) — consent must be opt-in per purpose),
    // so a null state row reads as "no grant for any purpose" and the
    // enforcer denies.
    public async Task<ConsentDecision> RequireGrantAsync(
        Guid userId,
        ConsentPurpose purpose,
        CancellationToken ct)
    {
        if (userId == Guid.Empty)
        {
            // No user identity -> nothing to enforce against. Treat as a
            // hard deny so a misrouted call cannot accidentally bypass.
            return ConsentDecision.Denied("no_user_identity");
        }

        var state = await repository
            .GetUserConsentStateAsync(userId, ct)
            .ConfigureAwait(false);

        // Null state == user has never interacted with the consent
        // flow. Per DPDP §6(1) consent is opt-in; default to false on
        // every purpose.
        state ??= UserConsentState.Create(userId);

        var granted = purpose switch
        {
            ConsentPurpose.FullHistoryJournal => state.FullHistoryJournal,
            ConsentPurpose.CrossFarmAggregation => state.CrossFarmAggregation,
            ConsentPurpose.ResearchCorpusExport => state.ResearchCorpusExport,
            _ => false,
        };

        if (granted)
        {
            return ConsentDecision.Allowed;
        }

        var reason = $"no_grant_for_purpose:{purpose}";

        // Append an audit row capturing the enforcement decision. The
        // old/new state snapshots are identical (no state change) — the
        // audit row's value is the actor/time/purpose tuple that proves
        // "consent was checked, found insufficient, request was
        // denied". The handler does NOT call SaveChangesAsync here;
        // ParseVoiceInputHandler's outer SaveChanges (or the
        // background-job boundary) flushes the unit-of-work in the
        // same transaction as everything else the request touched.
        var nowUtc = clock.UtcNow;
        try
        {
            var auditRow = ConsentAuditEntry.Create(
                userId: userId,
                oldState: state,
                newState: state,
                actorUserId: userId,
                consentTextVersion: state.Version,
                languageShown: "system",
                appVersion: "voice-diary-consent-enforcer",
                deviceId: "server",
                ipHash: "sha256:server",
                nowUtc: nowUtc);

            await repository
                .AddConsentAuditEntryAsync(auditRow, ct)
                .ConfigureAwait(false);
        }
        catch (ArgumentException)
        {
            // Defensive: if any required provenance field is rejected
            // by ConsentAuditEntry.Create (future tightening), we
            // still must return the deny decision — losing the audit
            // row is preferable to letting the caller persist
            // retained-tier voice without consent. The exception is
            // swallowed because the enforcement boundary cannot
            // afford to crash an in-flight voice parse over an audit
            // shape change. A monitoring follow-up may capture this
            // via Activity.AddEvent if it ever fires.
        }

        return ConsentDecision.Denied(reason);
    }
}
