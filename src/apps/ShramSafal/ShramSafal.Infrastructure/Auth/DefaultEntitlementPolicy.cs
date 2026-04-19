using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// Plan §4.5 matrix, implemented. Owner features require
/// Trialing/Active; worker-basic features are unconditional; PastDue
/// downgrades owner writes to read-only.
///
/// Decision tree (mirrors the spec table so a reviewer can diff by eye):
///
///   1. Is the user an Active member of the farm? No → Deny(NoMembership).
///   2. For worker-basic features (WorkerViewAttendance, WorkerSyncPush)
///      → Allow regardless of subscription.
///   3. For paid features: load subscription by the farm's
///      OwnerAccountId. No row → Deny(SubscriptionMissing).
///   4. Status IN {Trialing, Active} → Allow.
///   5. Status == PastDue:
///        - Allow reads (RunVerification is semantically a read-ish op
///          here; we still deny it because it mutates state).
///        - Deny writes (the vast majority of PaidFeature values).
///      For simplicity in the first pass, all paid features in PastDue
///      are denied with reason SubscriptionPastDueForWrite so the owner
///      sees a consistent "billing needs attention" banner.
///   6. Else → Deny with status-specific reason.
/// </summary>
internal sealed class DefaultEntitlementPolicy(
    IShramSafalRepository farmRepository,
    ISubscriptionReader subscriptionReader) : IEntitlementPolicy
{
    public async Task<EntitlementDecision> EvaluateAsync(
        UserId userId,
        FarmId farmId,
        PaidFeature feature,
        CancellationToken ct = default)
    {
        if (userId.IsEmpty || farmId.IsEmpty)
        {
            return new EntitlementDecision(false, EntitlementReason.NoMembership, null);
        }

        // Use the repository's role resolver — it already handles the
        // fallback where seeded farms don't have an explicit
        // farm_memberships row but the user is the declared
        // farm.OwnerUserId. Mirrors ShramSafalAuthorizationEnforcer so
        // the authorization decision and the entitlement decision stay
        // consistent.
        var role = await farmRepository.GetUserRoleForFarmAsync(farmId.Value, userId.Value, ct);
        if (role is null)
        {
            return new EntitlementDecision(false, EntitlementReason.NoMembership, null);
        }

        // 2. Worker-basic features — allowed regardless of the owning
        // account's subscription state.
        if (feature is PaidFeature.WorkerViewAttendance or PaidFeature.WorkerSyncPush)
        {
            return new EntitlementDecision(true, EntitlementReason.Allowed, null);
        }

        // 3+. Paid features require Trialing/Active on the OwnerAccount.
        var farm = await farmRepository.GetFarmByIdAsync(farmId.Value, ct);
        if (farm is null || farm.OwnerAccountId.IsEmpty)
        {
            return new EntitlementDecision(false, EntitlementReason.SubscriptionMissing, null);
        }

        var subscription = await subscriptionReader.GetByOwnerAccountAsync(farm.OwnerAccountId, ct);
        if (subscription is null)
        {
            return new EntitlementDecision(false, EntitlementReason.SubscriptionMissing, null);
        }

        if (subscription.AllowsOwnerWrites)
        {
            return new EntitlementDecision(true, EntitlementReason.Allowed, subscription.Status);
        }

        var reason = subscription.Status switch
        {
            3 => EntitlementReason.SubscriptionPastDueForWrite,
            4 => EntitlementReason.SubscriptionExpired,
            5 => EntitlementReason.SubscriptionCanceled,
            6 => EntitlementReason.SubscriptionSuspended,
            _ => EntitlementReason.SubscriptionMissing,
        };

        return new EntitlementDecision(false, reason, subscription.Status);
    }
}
