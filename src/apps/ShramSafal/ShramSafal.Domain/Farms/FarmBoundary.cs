using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

public sealed class FarmBoundary : Entity<Guid>
{
    private FarmBoundary() : base(Guid.Empty) { }

    private FarmBoundary(
        Guid id,
        FarmId farmId,
        OwnerAccountId ownerAccountId,
        string polygonGeoJson,
        decimal calculatedAreaAcres,
        FarmBoundarySource source,
        int version,
        DateTime createdAtUtc) : base(id)
    {
        FarmId = farmId;
        OwnerAccountId = ownerAccountId;
        PolygonGeoJson = polygonGeoJson;
        CalculatedAreaAcres = calculatedAreaAcres;
        Source = source;
        Version = version;
        IsActive = true;
        CreatedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public OwnerAccountId OwnerAccountId { get; private set; }
    public string PolygonGeoJson { get; private set; } = string.Empty;
    public decimal CalculatedAreaAcres { get; private set; }
    public FarmBoundarySource Source { get; private set; }
    public int Version { get; private set; }
    public bool IsActive { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime? ArchivedAtUtc { get; private set; }

    public static FarmBoundary Create(
        Guid id,
        FarmId farmId,
        OwnerAccountId ownerAccountId,
        string polygonGeoJson,
        decimal calculatedAreaAcres,
        FarmBoundarySource source,
        int version,
        DateTime createdAtUtc)
    {
        if (id == Guid.Empty) throw new ArgumentException("Boundary id is required.", nameof(id));
        if (farmId.IsEmpty) throw new ArgumentException("FarmId is required.", nameof(farmId));
        if (ownerAccountId.IsEmpty) throw new ArgumentException("OwnerAccountId is required.", nameof(ownerAccountId));
        if (string.IsNullOrWhiteSpace(polygonGeoJson)) throw new ArgumentException("Boundary polygon is required.", nameof(polygonGeoJson));
        if (calculatedAreaAcres <= 0) throw new ArgumentException("Boundary area must be greater than zero.", nameof(calculatedAreaAcres));
        if (version <= 0) throw new ArgumentException("Boundary version must be positive.", nameof(version));

        return new FarmBoundary(
            id,
            farmId,
            ownerAccountId,
            polygonGeoJson.Trim(),
            calculatedAreaAcres,
            source,
            version,
            createdAtUtc);
    }

    public void Archive(DateTime archivedAtUtc)
    {
        if (!IsActive) return;
        IsActive = false;
        ArchivedAtUtc = archivedAtUtc;
    }
}

