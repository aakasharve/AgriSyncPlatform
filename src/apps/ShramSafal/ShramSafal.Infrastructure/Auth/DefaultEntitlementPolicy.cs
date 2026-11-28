using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Options;
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
///
/// spec R-11 (b) (pre-launch repair, founder N-1) — between 4 and 6: an owner account with an
/// ACTIVE server-managed access extension (<c>accounts.access_extensions</c>: reason, start, end,
/// granted by) is allowed whatever its subscription status says, including no subscription row.
/// The decision reports <see cref="EntitlementReason.Allowed"/> with the subscription's real status,
/// so nothing pretends the subscription itself is current.
///
/// spec: plr-d10 pilot lane NO-TRIAL — while <see cref="PilotOptions.TrialEnforcementEnabled"/> is false (the default), after step 3
/// the pilot has no time limit: no subscription row, PastDue or Expired is allowed with <see cref="EntitlementReason.Pilot"/>, and a
/// Trialing/Active row past its own end (which the nightly job no longer ends) reports <see cref="EntitlementReason.Pilot"/> too,
/// so a log or metric can tell the pilot is what keeps the farm open. Steps 1–2, a farm with no owner account, and a Canceled or
/// Suspended account are decided exactly as before. With enforcement on, nothing in this class behaves differently from before.
/// </summary>
internal sealed class DefaultEntitlementPolicy(
    IShramSafalRepository farmRepository,
    ISubscriptionReader subscriptionReader,
    IClock clock,
    IOptions<PilotOptions> pilotOptions) : IEntitlementPolicy
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

        var pilot = pilotOptions.Value;
        var subscription = await subscriptionReader.GetByOwnerAccountAsync(farm.OwnerAccountId, ct);
        if (subscription is not null && subscription.AllowsOwnerWrites)
        {
            // spec: plr-d10 pilot lane NO-TRIAL — the row the nightly job would have expired (ValidUntilUtc before now) is open
            // only because of the pilot; say so. Enforcement on: Allowed, as before.
            var openOnlyByThePilot = !pilot.TrialEnforcementEnabled && subscription.ValidUntilUtc < clock.UtcNow;
            return new EntitlementDecision(
                true, openOnlyByThePilot ? EntitlementReason.Pilot : EntitlementReason.Allowed, subscription.Status);
        }

        // spec: plr-d10 pilot lane NO-TRIAL — no time limit in the pilot: no row, PastDue or Expired stays open without any
        // extension, so neither a missing extension nor its end date (31 Dec 2026) can close a farm. Canceled / Suspended fall
        // through to the unchanged rules below.
        if (pilot.KeepsOpen(subscription?.Status))
        {
            return new EntitlementDecision(true, EntitlementReason.Pilot, subscription?.Status);
        }

        // spec R-11 (b) — the explicit, recorded pilot extension keeps the farm working.
        var extension = await subscriptionReader.GetActiveAccessExtensionAsync(farm.OwnerAccountId, clock.UtcNow, ct);
        if (extension is not null)
        {
            return new EntitlementDecision(true, EntitlementReason.Allowed, subscription?.Status);
        }

        if (subscription is null)
        {
            return new EntitlementDecision(false, EntitlementReason.SubscriptionMissing, null);
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
