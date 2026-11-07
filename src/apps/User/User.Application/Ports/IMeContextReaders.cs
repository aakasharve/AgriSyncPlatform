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
/// spec: plr-d10 lane MU-2 (MU design §6, "one read model") — the waiting personal invitations that named the person's
/// PROVEN number. Implemented in the composition root over ShramSafal's own reader, so this context never re-derives
/// who may see an invitation.
/// </summary>
public interface IMeInvitationSnapshotReader
{
    Task<IReadOnlyList<MeInvitationSnapshot>> GetWaitingForUserAsync(UserId userId, CancellationToken ct = default);
}

/// <summary>spec: plr-d10 lane MU-2 — one waiting invitation, as the person's card shows it (no code, no farm id, no number).</summary>
public sealed record MeInvitationSnapshot(
    Guid InvitationId,
    string FarmName,
    string? InvitedByName,
    string Label,
    string? Name,
    string PlotScope,
    IReadOnlyList<string> PlotNames,
    IReadOnlyList<MeAuthoritySnapshot> Authorities,
    DateTime ExpiresAtUtc,
    bool NamesAWorker);

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
    SubscriptionSnapshot? Subscription,
    // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — ADDITIVE. The seat's EFFECTIVE permission
    // names, computed by the composition-root reader with ShramSafal's one rule
    // (FarmPermissionDefaults; empty for a seat that is not Active, every name for the registrant),
    // so this context never re-derives another context's rule.
    IReadOnlyList<string>? Permissions = null,
    // The owner's reason for the last decision (shown to a paused person).
    string? StatusReason = null,
    // The labour grant (hajeri / pakka) as stored; the handler evaluates the end date with its clock.
    bool HasLabourGrant = false,
    DateTime? LabourGrantExpiresAtUtc = null,
    // lane 2b (MU design §2, §6, §11.1) — ADDITIVE. The authorities this seat HOLDS now (names of
    // ShramSafal's FarmAuthority, each with its end; null = कायम), computed by the composition-root
    // reader with ShramSafal's one rule (FarmAuthorities.IsHeld; empty unless Active, every one for
    // the primary account holder) — this context never re-derives another context's rule.
    IReadOnlyList<MeAuthoritySnapshot>? Authorities = null,
    // lane 2b — the person is this farm's primary account holder (people and permissions, D-26).
    bool IsPrimaryAccountHolder = false);

/// <summary>lane 2b — one authority a seat holds now, and when it ends (null = कायम).</summary>
public sealed record MeAuthoritySnapshot(string Name, DateTime? ExpiresAtUtc);

public sealed record AffiliationSnapshot(
    string? ReferralCode,
    int ReferralsTotal,
    int ReferralsQualified,
    int BenefitsEarned);
