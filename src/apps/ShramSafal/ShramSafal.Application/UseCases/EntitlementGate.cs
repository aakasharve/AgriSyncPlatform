using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases;

/// <summary>
/// One place the entitlement decision is translated into a
/// <see cref="Result{T}"/> failure. Every paid handler calls
/// <see cref="CheckAsync{T}"/> before touching domain state so the
/// error shape, code naming, and user-facing messages stay identical
/// across handlers — and new handlers can't accidentally skip the gate
/// (architecture test in Phase 8.5 will enforce).
///
/// <para>spec R-11 (d) — public, so the two streaming AI routes (which are endpoints, not
/// handlers) refuse with exactly the same code and message as the non-streaming ones.</para>
/// </summary>
public static class EntitlementGate
{
    public static async Task<Result<T>?> CheckAsync<T>(
        IEntitlementPolicy policy,
        UserId callerUserId,
        FarmId farmId,
        PaidFeature feature,
        CancellationToken ct)
    {
        var error = await CheckErrorAsync(policy, callerUserId, farmId, feature, ct);
        return error is null ? null : Result.Failure<T>(error);
    }

    /// <summary>The refusal as a bare <see cref="Error"/> (<c>entitlement.&lt;reason&gt;</c>, Forbidden), or null when allowed.</summary>
    public static async Task<Error?> CheckErrorAsync(
        IEntitlementPolicy policy,
        UserId callerUserId,
        FarmId farmId,
        PaidFeature feature,
        CancellationToken ct)
    {
        var decision = await policy.EvaluateAsync(callerUserId, farmId, feature, ct);
        if (decision.Allowed)
        {
            return null;
        }

        return Error.Forbidden(
            $"entitlement.{decision.Reason.ToString().ToLowerInvariant()}",
            BuildMessage(decision.Reason));
    }

    private static string BuildMessage(EntitlementReason reason) => reason switch
    {
        EntitlementReason.NoMembership => "You are not an active member of this farm.",
        EntitlementReason.SubscriptionMissing => "This farm has no active subscription. Ask the owner to start one.",
        EntitlementReason.SubscriptionPastDueForWrite => "Farm subscription is past due. This action is read-only until billing is resolved.",
        EntitlementReason.SubscriptionExpired => "Farm subscription has expired. Renew to continue.",
        EntitlementReason.SubscriptionCanceled => "Farm subscription was cancelled. Renew to continue.",
        EntitlementReason.SubscriptionSuspended => "Farm subscription is suspended. Contact support.",
        _ => "This action is not allowed at the moment.",
    };
}
