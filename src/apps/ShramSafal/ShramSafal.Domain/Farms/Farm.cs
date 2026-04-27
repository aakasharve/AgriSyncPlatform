using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Farms;

public sealed class Farm : Entity<FarmId>
{
    private Farm() : base(FarmId.Empty) { } // EF Core

    private Farm(FarmId id, string name, UserId ownerUserId, DateTime createdAtUtc)
        : base(id)
    {
        Name = name;
        OwnerUserId = ownerUserId;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public string Name { get; private set; } = string.Empty;
    public UserId OwnerUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public double? CanonicalCentreLat { get; private set; }
    public double? CanonicalCentreLng { get; private set; }
    public FarmCentreSource? CentreSource { get; private set; }
    public double WeatherRadiusKm { get; private set; } = 3.0;
    public decimal? TotalMappedAreaAcres { get; private set; }
    public decimal? TotalGovtAreaAcres { get; private set; }
    public GeoValidationStatus GeoValidationStatus { get; private set; } = GeoValidationStatus.Unchecked;

    /// <summary>
    /// Reference to the commercial tenant that owns this farm.
    /// NOT NULL post-Phase 2 per invariant I5. The backing nullable is
    /// kept at EF-mapping level only because EF needs a nullable clr
    /// type during model build for the NOT NULL column.
    /// </summary>
    public OwnerAccountId OwnerAccountId { get; private set; }

    /// <summary>
    /// Human-friendly display code for the farm (6 chars Crockford base32).
    /// DISPLAY ONLY — never grants access. All joining goes through signed
    /// tokens per spec §5.4.
    /// </summary>
    public string? FarmCode { get; private set; }

    public static Farm Create(FarmId id, string name, UserId ownerUserId, DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ArgumentException("Farm name is required.", nameof(name));
        }

        return new Farm(id, name.Trim(), ownerUserId, createdAtUtc);
    }

    /// <summary>
    /// Attach this farm to an OwnerAccount. Called by the Phase 2 backfill
    /// on existing farms and by the first-farm wizard for new farms.
    /// Emits no event here — the AccountsApp owns the
    /// <c>FarmAttachedToOwnerAccount.v1</c> integration event via its own
    /// Outbox path.
    /// </summary>
    public void AttachToOwnerAccount(OwnerAccountId ownerAccountId, DateTime utcNow)
    {
        if (ownerAccountId.IsEmpty)
        {
            throw new ArgumentException("OwnerAccountId is required.", nameof(ownerAccountId));
        }

        if (!OwnerAccountId.IsEmpty && OwnerAccountId != ownerAccountId)
        {
            throw new InvalidOperationException(
                $"Farm '{Id}' is already attached to OwnerAccount '{OwnerAccountId}'. " +
                $"Ownership transfer is a separate spec (§10 out-of-scope).");
        }

        OwnerAccountId = ownerAccountId;
        ModifiedAtUtc = utcNow;
    }

    public void AssignFarmCode(string farmCode, DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(farmCode))
        {
            throw new ArgumentException("FarmCode is required.", nameof(farmCode));
        }

        FarmCode = farmCode.Trim().ToUpperInvariant();
        ModifiedAtUtc = utcNow;
    }

    public void SetCanonicalCentre(
        double latitude,
        double longitude,
        FarmCentreSource source,
        DateTime utcNow)
    {
        if (latitude is < -90 or > 90 || double.IsNaN(latitude) || double.IsInfinity(latitude))
        {
            throw new ArgumentOutOfRangeException(nameof(latitude), "Latitude must be between -90 and 90.");
        }

        if (longitude is < -180 or > 180 || double.IsNaN(longitude) || double.IsInfinity(longitude))
        {
            throw new ArgumentOutOfRangeException(nameof(longitude), "Longitude must be between -180 and 180.");
        }

        CanonicalCentreLat = latitude;
        CanonicalCentreLng = longitude;
        CentreSource = source;
        ModifiedAtUtc = utcNow;
    }

    public void SetMappedArea(decimal totalMappedAreaAcres, DateTime utcNow)
    {
        if (totalMappedAreaAcres <= 0)
        {
            throw new ArgumentOutOfRangeException(nameof(totalMappedAreaAcres), "Mapped area must be greater than zero.");
        }

        TotalMappedAreaAcres = totalMappedAreaAcres;
        ModifiedAtUtc = utcNow;
    }

    public void MarkGeoValidation(GeoValidationStatus status, DateTime utcNow)
    {
        GeoValidationStatus = status;
        ModifiedAtUtc = utcNow;
    }
}
