namespace AgriSync.SharedKernel.Contracts.Roles;

public enum AppRole
{
    Worker = 0,
    Mukadam = 1,
    SecondaryOwner = 2,
    PrimaryOwner = 3,
    // CEI Phase 2 additions — additive, no renumber of existing values
    Agronomist = 4,
    Consultant = 5,
    FpcTechnicalManager = 6,
    FieldScout = 7,
    LabOperator = 8
}
