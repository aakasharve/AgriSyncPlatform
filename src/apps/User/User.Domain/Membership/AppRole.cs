namespace User.Domain.Membership;

/// <summary>
/// Roles aligned with frontend: PRIMARY_OWNER, SECONDARY_OWNER, MUKADAM, WORKER.
/// See: src/clients/mobile-web/src/domain/types/farm.types.ts
/// </summary>
public enum AppRole
{
    Worker = 0,
    Mukadam = 1,
    SecondaryOwner = 2,
    PrimaryOwner = 3
}
