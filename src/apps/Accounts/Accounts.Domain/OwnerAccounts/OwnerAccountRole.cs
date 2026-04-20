namespace Accounts.Domain.OwnerAccounts;

/// <summary>
/// Role of a user within an <see cref="OwnerAccount"/>.
///
/// Distinct from farm-scoped <c>AppRole</c>: an OwnerAccountRole governs
/// billing and account-level admin; farm roles govern operational access.
/// Plan spec §3.3 D5/D7.
/// </summary>
public enum OwnerAccountRole
{
    PrimaryOwner = 1,
    SecondaryOwner = 2,
}
