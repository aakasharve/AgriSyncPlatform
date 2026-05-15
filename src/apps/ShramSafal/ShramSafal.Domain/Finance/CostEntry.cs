using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Common;
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
        string categoryId,
        string description,
        decimal amount,
        string currencyCode,
        DateOnly entryDate,
        UserId createdByUserId,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance provenance,
        Guid? sourceAiJobId)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        CategoryId = categoryId;
        Description = description;
        Amount = amount;
        CurrencyCode = currencyCode;
        EntryDate = entryDate;
        CreatedByUserId = createdByUserId;
        Location = location;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Provenance = provenance;
        SourceAiJobId = sourceAiJobId;
    }

    public FarmId FarmId { get; private set; }
    public Guid? PlotId { get; private set; }
    public Guid? CropCycleId { get; private set; }
    public Guid? JobCardId { get; private set; }
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — `Category` renamed to
    // `CategoryId`: this string is now an FK to `ssf.cost_categories(id)`
    // (canonical 13-code lookup). The CEI-I8 guard in `Create` continues
    // to reject `labour_payout` byte-equivalent.
    public string CategoryId { get; private set; } = string.Empty;
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
    public Provenance Provenance { get; private set; } = null!;
    public Guid? SourceAiJobId { get; private set; }

    public static CostEntry Create(
        Guid id,
        FarmId farmId,
        Guid? plotId,
        Guid? cropCycleId,
        string categoryId,
        string description,
        decimal amount,
        string currencyCode,
        DateOnly entryDate,
        UserId createdByUserId,
        LocationSnapshot? location,
        DateTime createdAtUtc,
        Provenance? provenance = null,
        Guid? sourceAiJobId = null)
    {
        if (string.IsNullOrWhiteSpace(categoryId))
        {
            throw new ArgumentException("Category is required.", nameof(categoryId));
        }

        if (categoryId.Trim().Equals("labour_payout", StringComparison.OrdinalIgnoreCase))
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

        var effectiveProvenance = provenance ?? Provenance.Manual("unknown");

        var entry = new CostEntry(
            id,
            farmId,
            plotId,
            cropCycleId,
            categoryId.Trim(),
            description.Trim(),
            decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            entryDate,
            createdByUserId,
            location,
            createdAtUtc,
            effectiveProvenance,
            sourceAiJobId);

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
        DateTime createdAtUtc,
        Provenance? provenance = null,
        Guid? sourceAiJobId = null)
    {
        if (amount <= 0)
        {
            throw new ArgumentException("Amount must be greater than zero.", nameof(amount));
        }

        if (string.IsNullOrWhiteSpace(currencyCode))
        {
            throw new ArgumentException("Currency code is required.", nameof(currencyCode));
        }

        var effectiveProvenance = provenance ?? Provenance.Manual("unknown");

        var entry = new CostEntry(
            id,
            farmId,
            plotId,
            cropCycleId,
            categoryId: "labour_payout",
            description: string.Empty,
            decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            currencyCode.Trim().ToUpperInvariant(),
            entryDate,
            createdByUserId,
            location: null,
            createdAtUtc,
            effectiveProvenance,
            sourceAiJobId);

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
