using AgriSync.SharedKernel.Contracts.Ids;

namespace Accounts.Domain.OwnerAccounts;

/// <summary>
/// Thrown when an operation would violate invariant I4: every non-archived
/// OwnerAccount must retain at least one Active PrimaryOwner membership.
/// </summary>
public sealed class LastPrimaryOwnerRevocationException : InvalidOperationException
{
    public LastPrimaryOwnerRevocationException(OwnerAccountId ownerAccountId)
        : base($"OwnerAccount '{ownerAccountId}' cannot lose its last active PrimaryOwner. Promote another member first (invariant I4).")
    {
        OwnerAccountId = ownerAccountId;
    }

    public OwnerAccountId OwnerAccountId { get; }
}
