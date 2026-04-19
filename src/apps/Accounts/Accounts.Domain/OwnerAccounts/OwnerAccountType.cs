namespace Accounts.Domain.OwnerAccounts;

/// <summary>
/// Commercial shape of an OwnerAccount.
/// Plan spec §3.3 locked decision D1 (Shape B).
/// </summary>
public enum OwnerAccountType
{
    Individual = 1,
    Family = 2,
    FPO = 3,
    Cooperative = 4,
    Enterprise = 5,
}
