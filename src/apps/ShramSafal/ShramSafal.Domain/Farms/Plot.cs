using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

public sealed class Plot : Entity<Guid>
{
    private Plot() : base(Guid.Empty) { } // EF Core

    private Plot(
        Guid id,
        FarmId farmId,
        string name,
        decimal areaInAcres,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        Name = name;
        AreaInAcres = areaInAcres;
        CreatedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public decimal AreaInAcres { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }

    public static Plot Create(
        Guid id,
        FarmId farmId,
        string name,
        decimal areaInAcres,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Plot name is required.", nameof(name));
        }

        if (areaInAcres <= 0)
        {
            throw new ArgumentException("Plot area must be greater than zero.", nameof(areaInAcres));
        }

        return new Plot(id, farmId, name.Trim(), areaInAcres, createdAtUtc);
    }
}
