using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Application.Ports;

/// <summary>
/// Runtime gate that decides whether an operation on a farm is allowed
/// given the caller's membership + the owning account's subscription.
///
/// Plan §4.5 matrix:
///   - Worker-basic features (attendance view, worker sync-push) →
///     always allowed regardless of subscription.
///   - Paid owner features (create plot, write daily log, verify, edit
///     finance, AI, owner sync-push) → require Trialing/Active.
///   - PastDue → read-allow, write-deny for owner features.
///   - Expired/Canceled/Suspended → deny for paid features.
///
/// spec: plr-d10 pilot lane NO-TRIAL — while <see cref="PilotOptions.TrialEnforcementEnabled"/> is false (the default) no time
/// limit applies: see <see cref="PilotOptions"/>.
/// </summary>
public interface IEntitlementPolicy
{
    Task<EntitlementDecision> EvaluateAsync(
        UserId userId,
        FarmId farmId,
        PaidFeature feature,
        CancellationToken ct = default);
}

public enum PaidFeature
{
    CreatePlot = 1,
    WriteDailyLog = 2,
    RunVerification = 3,
    EditFinance = 4,
    AiParse = 5,
    OwnerSyncPush = 6,
    WorkerSyncPush = 7,
    WorkerViewAttendance = 8,
    MisRead = 9,
}

public enum EntitlementReason
{
    Allowed,
    NoMembership,
    SubscriptionMissing,
    SubscriptionPastDueForWrite,
    SubscriptionExpired,
    SubscriptionCanceled,
    SubscriptionSuspended,

    /// <summary>
    /// spec: plr-d10 pilot lane NO-TRIAL — ALLOWED only because the pilot has no time limit
    /// (<see cref="PilotOptions.TrialEnforcementEnabled"/> = false): with enforcement on, this farm's trial, subscription or access
    /// extension would not allow it. Appended last, so every earlier value keeps its number; it is never sent to a phone (only a
    /// refusal becomes an <c>entitlement.&lt;reason&gt;</c> code).
    /// </summary>
    Pilot,
}

public sealed record EntitlementDecision(
    bool Allowed,
    EntitlementReason Reason,
    int? SubscriptionStatus);
