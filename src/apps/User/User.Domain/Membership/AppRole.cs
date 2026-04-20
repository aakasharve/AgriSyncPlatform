namespace User.Domain.Membership;

/// <summary>
/// Roles aligned with frontend: PRIMARY_OWNER, SECONDARY_OWNER, MUKADAM, WORKER.
/// See: src/clients/mobile-web/src/domain/types/farm.types.ts
/// CEI Phase 2: extended with Agronomist, Consultant, FpcTechnicalManager, FieldScout, LabOperator.
/// Keep values mirrored with AgriSync.SharedKernel.Contracts.Roles.AppRole (source of truth).
/// </summary>
public enum AppRole
{
    // Keep values mirrored with AgriSync.SharedKernel.Contracts.Roles.AppRole.
    Worker = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Worker,
    Mukadam = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Mukadam,
    SecondaryOwner = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.SecondaryOwner,
    PrimaryOwner = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.PrimaryOwner,
    // CEI Phase 2 additions — additive, no renumber of existing values
    Agronomist = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Agronomist,
    Consultant = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.Consultant,
    FpcTechnicalManager = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.FpcTechnicalManager,
    FieldScout = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.FieldScout,
    LabOperator = (int)AgriSync.SharedKernel.Contracts.Roles.AppRole.LabOperator
}
