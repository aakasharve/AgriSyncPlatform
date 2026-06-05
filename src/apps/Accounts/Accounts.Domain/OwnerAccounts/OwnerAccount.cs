using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using Accounts.Domain.Events;

namespace Accounts.Domain.OwnerAccounts;

/// <summary>
/// Aggregate root for the commercial tenant that owns one or more farms
/// and carries exactly one current <see cref="Subscriptions.Subscription"/>.
///
/// Invariants:
///   I4 — every non-archived OwnerAccount retains ≥1 Active PrimaryOwner
///        membership. Enforced in <see cref="RevokeMembership"/>.
///
/// Spec: plan §3.3 · locked decision D1 (Shape B).
/// </summary>
public sealed class OwnerAccount : Entity<OwnerAccountId>
{
    private readonly List<OwnerAccountMembership> _memberships = [];

    private OwnerAccount() : base(default) { } // EF Core

    private OwnerAccount(
        OwnerAccountId id,
        string accountName,
        UserId primaryOwnerUserId,
        OwnerAccountType accountType,
        DateTime createdAtUtc)
        : base(id)
    {
        AccountName = accountName;
        PrimaryOwnerUserId = primaryOwnerUserId;
        AccountType = accountType;
        Status = OwnerAccountStatus.Active;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public string AccountName { get; private set; } = string.Empty;
    public UserId PrimaryOwnerUserId { get; private set; }
    public OwnerAccountType AccountType { get; private set; }
    public OwnerAccountStatus Status { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// The ssf Farm id created by the first-farm bootstrap, recorded HERE on the
    /// accounts side (which is not under the ssf farm_id RLS) so the bootstrap flow
    /// can establish the tenant context BEFORE touching the FORCE-RLS ssf tables, and
    /// so the operation is idempotent + recoverable across a partial write. Null until
    /// the first farm is bootstrapped (or for accounts created before this column).
    /// Stored as a raw <see cref="Guid"/>, not a FarmId, to avoid an Accounts→ShramSafal
    /// cross-context type reference.
    /// </summary>
    public Guid? BootstrappedFarmId { get; private set; }

    public IReadOnlyCollection<OwnerAccountMembership> Memberships => _memberships.AsReadOnly();

    public static OwnerAccount Create(
        OwnerAccountId id,
        string accountName,
        UserId primaryOwnerUserId,
        OwnerAccountType accountType,
        DateTime createdAtUtc)
    {
        if (id.IsEmpty)
        {
            throw new ArgumentException("OwnerAccount id is required.", nameof(id));
        }

        if (primaryOwnerUserId.IsEmpty)
        {
            throw new ArgumentException("PrimaryOwner user id is required.", nameof(primaryOwnerUserId));
        }

        if (string.IsNullOrWhiteSpace(accountName))
        {
            throw new ArgumentException("AccountName is required.", nameof(accountName));
        }

        var account = new OwnerAccount(id, accountName.Trim(), primaryOwnerUserId, accountType, createdAtUtc);

        // Bootstrap: the creator is always the first PrimaryOwner member.
        var membership = new OwnerAccountMembership(
            OwnerAccountMembershipId.New(),
            id,
            primaryOwnerUserId,
            OwnerAccountRole.PrimaryOwner,
            invitedByUserId: null,
            createdAtUtc);
        account._memberships.Add(membership);

        account.Raise(new OwnerAccountCreated(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            primaryOwnerUserId,
            account.AccountName,
            accountType));

        return account;
    }

    public OwnerAccountMembership InviteSecondaryOwner(
        OwnerAccountMembershipId membershipId,
        UserId userId,
        UserId invitedByUserId,
        DateTime utcNow)
    {
        EnsureActive();

        if (userId.IsEmpty)
        {
            throw new ArgumentException("User id is required.", nameof(userId));
        }

        if (_memberships.Any(m => m.UserId == userId && m.Status != OwnerAccountMembershipStatus.Revoked))
        {
            throw new InvalidOperationException(
                $"User '{userId}' already has a non-terminal membership in account '{Id}'.");
        }

        var membership = new OwnerAccountMembership(
            membershipId,
            Id,
            userId,
            OwnerAccountRole.SecondaryOwner,
            invitedByUserId,
            utcNow);

        _memberships.Add(membership);
        ModifiedAtUtc = utcNow;
        return membership;
    }

    public void RevokeMembership(OwnerAccountMembershipId membershipId, DateTime utcNow)
    {
        var target = _memberships.SingleOrDefault(m => m.Id == membershipId)
            ?? throw new InvalidOperationException($"Membership '{membershipId}' not found in account '{Id}'.");

        // Invariant I4 — guard against removing the last Active PrimaryOwner.
        if (target.IsActivePrimaryOwner)
        {
            var remainingActivePrimaryOwners = _memberships
                .Count(m => m.Id != membershipId && m.IsActivePrimaryOwner);

            if (remainingActivePrimaryOwners == 0)
            {
                throw new LastPrimaryOwnerRevocationException(Id);
            }
        }

        target.Revoke(utcNow);
        ModifiedAtUtc = utcNow;
    }

    /// <summary>
    /// Links this account to the ssf Farm produced by the first-farm bootstrap.
    /// Idempotent: re-linking the SAME farm id is a no-op; relinking to a DIFFERENT
    /// farm throws (an account bootstraps exactly one first farm). Set before the ssf
    /// write so the bootstrap survives a partial write (account saved, farm not) and
    /// can be completed deterministically with the same farm id on retry.
    /// </summary>
    public void SetBootstrappedFarm(Guid farmId, DateTime utcNow)
    {
        if (farmId == Guid.Empty)
        {
            throw new ArgumentException("Bootstrapped farm id is required.", nameof(farmId));
        }

        if (BootstrappedFarmId is { } existing && existing != farmId)
        {
            throw new InvalidOperationException(
                $"OwnerAccount '{Id}' is already linked to bootstrapped farm '{existing}'; refusing relink to '{farmId}'.");
        }

        if (BootstrappedFarmId == farmId)
        {
            return; // idempotent no-op
        }

        BootstrappedFarmId = farmId;
        ModifiedAtUtc = utcNow;
    }

    public void Suspend(DateTime utcNow)
    {
        Status = OwnerAccountStatus.Suspended;
        ModifiedAtUtc = utcNow;
    }

    public void Restore(DateTime utcNow)
    {
        Status = OwnerAccountStatus.Active;
        ModifiedAtUtc = utcNow;
    }

    public void Rename(string newName, DateTime utcNow)
    {
        EnsureActive();

        if (string.IsNullOrWhiteSpace(newName))
        {
            throw new ArgumentException("AccountName is required.", nameof(newName));
        }

        AccountName = newName.Trim();
        ModifiedAtUtc = utcNow;
    }

    private void EnsureActive()
    {
        if (Status != OwnerAccountStatus.Active)
        {
            throw new InvalidOperationException(
                $"OwnerAccount '{Id}' is not active (status={Status}). Operation denied.");
        }
    }
}
