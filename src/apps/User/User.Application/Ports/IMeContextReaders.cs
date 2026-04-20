using AgriSync.SharedKernel.Contracts.Ids;

namespace User.Application.Ports;

/// <summary>
/// Snapshot ports consumed by <c>GetMeContextHandler</c>. Implementations
/// today live in the Bootstrapper composition root (the only host allowed
/// to read across app DbContexts). When User-side projection tables land
/// (see spec §future-migration), these same ports will be re-implemented
/// in <c>User.Infrastructure.Persistence.Readers</c> without any change
/// to callers.
/// </summary>
public interface IAccountsSnapshotReader
{
    Task<AccountsSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default);
}

public interface IFarmMembershipSnapshotReader
{
    Task<IReadOnlyList<FarmMembershipSnapshot>> GetForUserAsync(UserId userId, CancellationToken ct = default);
}

public interface IAffiliationSnapshotReader
{
    Task<AffiliationSnapshot> GetForUserAsync(UserId userId, CancellationToken ct = default);
}

/// <summary>
/// Subscription snapshot as observed by the User app for a given owner
/// account. <c>PlanCode</c> is the raw code from Accounts
/// (e.g. <c>"ShramSafalPro"</c>, <c>"FreeTier"</c>); mapping to the UI
/// <c>plan</c> string happens in the handler.
/// </summary>
public sealed record SubscriptionSnapshot(
    string Status,
    string PlanCode,
    DateTime? ValidUntilUtc);

public sealed record OwnerAccountSnapshot(
    OwnerAccountId OwnerAccountId,
    string AccountName,
    bool CallerIsPrimaryOwner,
    SubscriptionSnapshot? Subscription);

public sealed record AccountsSnapshot(IReadOnlyList<OwnerAccountSnapshot> OwnerAccounts);

public sealed record FarmMembershipSnapshot(
    FarmId FarmId,
    string FarmName,
    string? FarmCode,
    OwnerAccountId OwnerAccountId,
    string Role,
    string Status,
    string JoinedVia,
    DateTime GrantedAtUtc,
    DateTime? LastSeenAtUtc,
    SubscriptionSnapshot? Subscription);

public sealed record AffiliationSnapshot(
    string? ReferralCode,
    int ReferralsTotal,
    int ReferralsQualified,
    int BenefitsEarned);
