// spec: voice-diary-e2e-2026-05-17 (B.2)
//
// Wave 1.B — Voice Diary end-to-end ship. Authors the IConsentEnforcer
// port that Phase 06.2's UpdateConsentHandler comment (lines 14–17)
// promised but never landed:
//
//   > "Per OQ-4 verdict, this phase does NOT touch ParseVoiceInputHandler.
//    Phase 07 will call IConsentEnforcer (also new in this envelope) at
//    the AI boundary."
//
// This is that port. The Voice Diary ship calls into it from
// ParseVoiceInputHandler BEFORE persisting any retained-tier voice clip
// to S3 so that retention is consent-gated at the AI boundary.
//
// Architecture rules:
//   - Pure Application port — no Infrastructure types, no EF references.
//   - Lives alongside IRetainedBlobStore under
//     ShramSafal.Application.Privacy.Ports (NOT
//     ShramSafal.Application.Ports.Privacy which holds
//     IThirdPartyPiiDetector — different namespace; the repo split is
//     intentional per the Repo Truth Anchor in the plan).
//   - ConsentPurpose values mirror the THREE existing UserConsentState
//     toggles 1:1. NO new toggle in v2 of this ship — we reuse
//     FullHistoryJournal (the toggle was authored for exactly this
//     purpose; see UserConsentState.cs line 60-64).

namespace ShramSafal.Application.Privacy.Ports;

/// <summary>
/// Phase 06.2-promised consent gate. Resolves the user's live
/// <c>UserConsentState</c> server-side and returns an allow/deny
/// decision for a specific <see cref="ConsentPurpose"/>. Implementations
/// MUST emit a <c>ConsentAuditEntry</c>-shaped audit row on deny so the
/// DPDP §16 export can reconstruct "who tried to do X without consent,
/// when, against which row version".
///
/// <para>
/// <b>Why a separate port from <c>IShramSafalRepository.GetUserConsentStateAsync</c>.</b>
/// The repository surface returns the raw aggregate (or null); the
/// enforcer encapsulates the "default-row-on-null + map purpose to
/// boolean + emit audit on deny" policy so every caller doesn't
/// re-implement the same three steps inconsistently. Keeps
/// <see cref="ConsentPurpose"/> as the only contract callers depend on.
/// </para>
///
/// <para>
/// <b>Stricter-wins.</b> Server is always authoritative —
/// <see cref="UserConsentState"/>'s <c>StricterWins</c> intersection
/// stays the canonical client-token-vs-server reconciliation surface.
/// This port reads server state only; it does NOT consult a cached
/// client token.
/// </para>
/// </summary>
public interface IConsentEnforcer
{
    /// <summary>
    /// Resolve <paramref name="userId"/>'s live consent state and
    /// return <see cref="ConsentDecision.Allowed"/> when the toggle
    /// for <paramref name="purpose"/> is <c>true</c>, otherwise
    /// <see cref="ConsentDecision.Denied"/> with a reason string.
    /// Implementations MUST emit one audit row per deny (no audit on
    /// allow — that would flood <c>ssf.consent_audit</c> on every
    /// voice parse).
    /// </summary>
    Task<ConsentDecision> RequireGrantAsync(
        Guid userId,
        ConsentPurpose purpose,
        CancellationToken ct);
}

/// <summary>
/// Mirror of the three live <c>UserConsentState</c> toggles authored in
/// Phase 06.1. Adding a fourth value here REQUIRES first adding the
/// matching property to <c>UserConsentState</c> + the
/// <c>UpdateConsentCommand</c> wire surface — see the supervisor
/// guardrail in <c>VOICE_DIARY_END_TO_END_BEFORE_SPINE_HARDENING_2026-05-17.md</c>
/// for why the Voice Diary ship does NOT add one.
/// </summary>
public enum ConsentPurpose
{
    /// <summary>
    /// §1 — retain voice notes beyond the 30-day local journal so the
    /// user can scroll their full history (the Voice Diary feature
    /// gates retained-tier S3 persist on this).
    /// </summary>
    FullHistoryJournal = 1,

    /// <summary>
    /// §2 — allow de-identified data to train product features that
    /// benefit other farmers on the platform.
    /// </summary>
    CrossFarmAggregation = 2,

    /// <summary>
    /// §3 — allow de-identified data to be shared with research /
    /// government partners under DPA-governed export.
    /// </summary>
    ResearchCorpusExport = 3,
}

/// <summary>
/// Result of a <see cref="IConsentEnforcer.RequireGrantAsync"/> call.
/// Two states only — <see cref="Allowed"/> (singleton sentinel) and
/// <see cref="Denied"/> (carries a stable machine-readable reason
/// string for analytics / error mapping at the handler boundary).
/// </summary>
public sealed record ConsentDecision
{
    /// <summary>
    /// Singleton "allowed" sentinel. The <c>IsAllowed</c> property is
    /// the canonical branch test at call sites; the reason is null on
    /// an allow.
    /// </summary>
    public static readonly ConsentDecision Allowed = new(true, null);

    public bool IsAllowed { get; }
    public string? DenyReason { get; }

    private ConsentDecision(bool isAllowed, string? denyReason)
    {
        IsAllowed = isAllowed;
        DenyReason = denyReason;
    }

    /// <summary>
    /// Build a denial with a stable machine-readable reason string
    /// (e.g. <c>"no_grant_for_purpose:FullHistoryJournal"</c>). The
    /// reason is surfaced verbatim on the audit row + the analytics
    /// event so dashboards can group deny causes without scraping
    /// log lines.
    /// </summary>
    public static ConsentDecision Denied(string reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Deny reason required.", nameof(reason));
        }
        return new ConsentDecision(false, reason.Trim());
    }
}
