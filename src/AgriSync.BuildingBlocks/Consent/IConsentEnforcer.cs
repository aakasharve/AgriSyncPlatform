// spec: data-principle-spine-2026-05-05/06.3
namespace AgriSync.BuildingBlocks.Consent;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 06 sub-phase 06.3 — policy object that
/// answers "is this user currently consenting to this purpose?". Per
/// OQ-4 + OQ-5 verdicts (conflict-resolver 2026-05-17), Phase 06 ships
/// the contract + a default implementation; Phase 07
/// (ParseVoiceInputHandler) is the first call site.
///
/// <para>
/// <b>Stricter-wins semantics.</b> The caller hands in BOTH the
/// captured token claims (the snapshot the client believed at clip
/// capture time) AND the server reads back the live state. The
/// enforcer intersects them — any purpose that is <c>false</c> on
/// either side fails closed (throws). This prevents:
/// <list type="bullet">
/// <item>A stale client cache widening scope after the user revoked.</item>
/// <item>A forged token claiming wider scope than the server knows about.</item>
/// </list>
/// </para>
/// </summary>
public interface IConsentEnforcer
{
    /// <summary>
    /// Throw <see cref="ConsentDeniedException"/> when the stricter
    /// intersection of <paramref name="capturedClaims"/> and the live
    /// server state is <c>false</c> for <paramref name="purpose"/>.
    /// Returns normally on grant.
    /// </summary>
    Task RequireGrantOrThrowAsync(
        Guid userId,
        ConsentPurpose purpose,
        ConsentClaims capturedClaims,
        CancellationToken ct);
}

/// <summary>
/// Three independent purposes per DPDP §7(1) (purpose limitation) +
/// V2 §1 Non-Negotiables. Matches the booleans on
/// <c>ShramSafal.Domain.Privacy.UserConsentState</c>.
/// </summary>
public enum ConsentPurpose
{
    FullHistoryJournal,
    CrossFarmAggregation,
    ResearchCorpusExport,
}

/// <summary>
/// Thrown by <see cref="IConsentEnforcer.RequireGrantOrThrowAsync"/>
/// when the stricter-wins intersection denies the requested purpose.
/// Callers translate to 403 with the purpose name in the body.
/// </summary>
public sealed class ConsentDeniedException : Exception
{
    public ConsentDeniedException(Guid userId, ConsentPurpose purpose)
        : base($"Consent denied: user {userId} has not granted '{purpose}'.")
    {
        UserId = userId;
        Purpose = purpose;
    }

    public Guid UserId { get; }
    public ConsentPurpose Purpose { get; }
}
