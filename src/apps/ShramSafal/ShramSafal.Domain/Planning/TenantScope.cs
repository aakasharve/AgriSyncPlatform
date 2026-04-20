namespace ShramSafal.Domain.Planning;

public enum TenantScope
{
    Private = 0,   // visible to CreatedByUserId only
    Team = 1,      // visible inside OwnerAccount (see Accounts module)
    Licensed = 2,  // visible across tenants that purchased it (future)
    Public = 3     // built-in reference data (existing seed templates)
}
