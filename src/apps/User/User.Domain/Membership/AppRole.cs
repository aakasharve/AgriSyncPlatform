namespace User.Domain.Membership;

/// <summary>
/// Roles aligned with frontend: PRIMARY_OWNER, SECONDARY_OWNER, MUKADAM, WORKER.
/// See: src/clients/mobile-web/src/domain/types/farm.types.ts
/// </summary>
public enum AppRole
{
    // Keep values mirrored with AgriSync.SharedKernel.Contracts.Roles.AppRole.
    Worker = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Worker,
    Mukadam = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Mukadam,
    SecondaryOwner = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.SecondaryOwner,
    PrimaryOwner = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner
}
