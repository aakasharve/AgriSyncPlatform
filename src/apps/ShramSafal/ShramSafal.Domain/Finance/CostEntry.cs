using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Location;

namespace ShramSafal.Domain.Finance;

public sealed class CostEntry : Entity<Guid>
{
    private CostEntry() : base(Guid.Empty) { } // EF Core

    private CostEntry(
        Guid id,
        FarmId farmId,
        Guid? plotId,
        Guid? cropCycleId,
        string category,
        string description,
        decimal amount,
        string currencyCode,
        DateOnly entryDate,
        UserId createdByUserId,
        LocationSnapshot? location,
        DateTime createdAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        Category = category;
        Description = description;
        Amount = amount;
        CurrencyCode = currencyCode;
        EntryDate = entryDate;
        CreatedByUserId = createdByUserId;
        Location = location;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid? PlotId { get; private set; }
    public Guid? CropCycleId { get; private set; }
    public Guid? JobCardId { get; private set; }
    public string Category { get; private set; } = string.Empty;
    public string Description { get; private set; } = string.Empty;
    public decimal Amount { get; private set; }
    public string CurrencyCode { get; private set; } = "INR";
    public DateOnly EntryDate { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public LocationSnapshot? Location { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public bool IsCorrected { get; private set; }
    public bool IsFlagged { get; private set; }
    public string? FlagReason { get; private set; }

    public static CostEntry Create(
        Guid id,
        FarmId farmId,
        Guid? plotId,
        Guid? cropCycleId,
        string category,
        string description,
        decimal amount,
        string currencyCode,
        DateOnly entryDate,
        UserId createdByUserId,
        LocationSnapshot? location,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(category))
        {
            throw new ArgumentException("Category is required.", nameof(category));
        }

        if (category.Trim().Equals("labour_payout", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("Use CreateLabourPayout for labour_payout category.");
        }

        if (amount <= 0)
        {
            throw new ArgumentException("Amount must be greater than zero.", nameof(amount));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        var entry = new CostEntry(
            id,
            farmId,
            plotId,
            cropCycleId,
            category.Trim(),
            description.Trim(),
            decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            entryDate,
            createdByUserId,
            location,
            createdAtUtc);

        entry.Raise(new CostEntryCreatedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            entry.Amount,
            entry.CurrencyCode));

        return entry;
    }

    public static CostEntry CreateLabourPayout(
        Guid id,
        Guid jobCardId,
        FarmId farmId,
        Guid? plotId,
        Guid? cropCycleId,
        decimal amount,
        string currencyCode,
        DateOnly entryDate,
        UserId createdByUserId,
        DateTime createdAtUtc)
    {
        if (amount <= 0)
        {
            throw new ArgumentException("Amount must be greater than zero.", nameof(amount));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        var entry = new CostEntry(
            id,
            farmId,
            plotId,
            cropCycleId,
            category: "labour_payout",
            description: string.Empty,
            decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            entryDate,
            createdByUserId,
            location: null,
            createdAtUtc);

        entry.JobCardId = jobCardId;

        entry.Raise(new CostEntryCreatedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            entry.Amount,
            entry.CurrencyCode));

        return entry;
    }

    public void Flag(string reason)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Flag reason is required.", nameof(reason));
        }

        IsFlagged = true;
        FlagReason = reason.Trim();
    }

    public void MarkCorrected(
        Guid correctionId,
        decimal correctedAmount,
        string currencyCode,
        DateTime correctedAtUtc)
    {
        IsCorrected = true;
        ModifiedAtUtc = correctedAtUtc;
        Raise(new CostEntryCorrectedEvent(
            Guid.NewGuid(),
            correctedAtUtc,
            Id,
            correctionId,
            correctedAmount,
            currencyCode));
    }

    public void AttachLocation(LocationSnapshot location)
    {
        if (Location is not null)
        {
            throw new InvalidOperationException("Location is immutable once attached.");
        }

        Location = location;
        ModifiedAtUtc = location.CapturedAtUtc;
    }
}
