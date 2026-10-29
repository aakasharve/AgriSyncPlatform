using AgriSync.BuildingBlocks.Results;

namespace ShramSafal.Application.Ports;

/// <summary>
/// spec R-11 (d) (pre-launch repair, N-1: "Two AI doors have no trial check") — the trial / plan
/// gate for the live-caption route <c>POST /shramsafal/ai/transcribe-stream</c>, the same check as
/// the non-streaming <c>/ai/voice-parse</c> (<see cref="PaidFeature.AiParse"/> on the caller's farm).
///
/// <para>Why a port and not three lines in the endpoint: that route is on the
/// <c>TenantTransactionMiddleware</c> skip-list (it reads only the global provider config), so it
/// has no request transaction, and the farm scope the policy's reads need is transaction-local.
/// The implementation opens a short read-only transaction just for this question, establishes the
/// caller's membership-validated farm scope, asks the policy, and rolls back.</para>
/// </summary>
public interface IAiStreamEntitlementCheck
{
    /// <returns>null when allowed; otherwise the refusal — <c>ShramSafal.Forbidden</c> for a farm the
    /// caller is not an active member of, or <c>entitlement.&lt;reason&gt;</c> (e.g.
    /// <c>entitlement.subscriptionexpired</c>) exactly as the non-streaming AI routes send it.</returns>
    Task<Error?> CheckAsync(Guid farmId, Guid userId, CancellationToken ct = default);
}
