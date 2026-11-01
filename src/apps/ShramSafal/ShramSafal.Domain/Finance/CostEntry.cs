using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Events;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.RecordPrivacy;

namespace ShramSafal.Domain.Finance;

public sealed class CostEntry : Entity<Guid>
{
    /// <summary>
    /// The amount at or above which money waits in the review inbox (flagged) — one rule for a first save
    /// (<c>AddCostEntryHandler</c>), money an edit makes, and a correction an edit makes (lane OF-M fix pass 1, review 6).
    /// </summary>
    public const decimal ReviewAmountThreshold = 25000m;

    /// <summary>The flag reason that rule writes.</summary>
    public const string ReviewAmountReason = "High amount: >= 25000 INR";

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
        Guid? sourceAiJobId,
        MoneyDirection? direction,
        decimal? quantity,
        string? unit,
        decimal? unitPrice,
        string? paymentMode,
        string? vendorName,
        string? clientAttachmentIdsJson)
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
        Direction = direction;
        Quantity = quantity;
        Unit = unit;
        UnitPrice = unitPrice;
        PaymentMode = paymentMode;
        VendorName = vendorName;
        ClientAttachmentIdsJson = clientAttachmentIdsJson;
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

    /// <summary>
    /// Which way the money moved, as the farmer stated it.
    /// <c>null</c> means NOBODY EVER SAID — every row written before the
    /// direction field existed, and any producer that omits it. Read it as
    /// unknown; never as <see cref="MoneyDirection.Expense"/>, even though this
    /// type is called <c>CostEntry</c> and every such row used to be counted as
    /// one. That silent equation is precisely what made a farmer's ₹50,000 sale
    /// read back as ₹50,000 spent.
    /// </summary>
    public MoneyDirection? Direction { get; private set; }

    // ── Line detail the client used to hold locally and drop at the outbox ──
    // All nullable, and null means NOT STATED. Nothing here is used to compute
    // <see cref="Amount"/>: the total is the farmer's own figure, and a row with
    // a quantity and a unit price but no stated total is deliberately left
    // without one rather than multiplied into existence.

    /// <summary>How much of it — 12 (kg), 3 (bags). Null = not stated.</summary>
    public decimal? Quantity { get; private set; }

    /// <summary>The farmer's own unit word. Null = not stated.</summary>
    public string? Unit { get; private set; }

    /// <summary>Price per unit as stated. Null = not stated.</summary>
    public decimal? UnitPrice { get; private set; }

    /// <summary>Cash / UPI / Bank / Credit, as stated. Null = not stated.</summary>
    public string? PaymentMode { get; private set; }

    /// <summary>Who it was paid to or received from. Null = not stated.</summary>
    public string? VendorName { get; private set; }

    /// <summary>
    /// The attachment ids the CLIENT stated at capture time, as a JSON string
    /// array. Null = the producer made no statement; <c>"[]"</c> = it said
    /// "none".
    /// <para>
    /// This is NOT the authoritative photo linkage — that is
    /// <c>ssf.attachments.linked_entity_id</c>, which is what the app's
    /// attachment list actually reads. It is kept because the two can
    /// legitimately disagree: a receipt the farmer attached on his phone and
    /// that never finished uploading appears here and not there, and that gap
    /// is a real, detectable condition rather than something to paper over.
    /// </para>
    /// </summary>
    public string? ClientAttachmentIdsJson { get; private set; }

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
        Guid? sourceAiJobId = null,
        // Optional, and OMITTED means the caller made no statement about which
        // way the money moved — which is the truth for the HTTP endpoint, the
        // demo seeder and every client shipped before the field existed. Do not
        // default this to Expense to "keep the old behaviour": the old
        // behaviour is the defect.
        MoneyDirection? direction = null,
        decimal? quantity = null,
        string? unit = null,
        decimal? unitPrice = null,
        string? paymentMode = null,
        string? vendorName = null,
        string? clientAttachmentIdsJson = null)
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
            sourceAiJobId,
            direction,
            quantity,
            Normalize(unit),
            unitPrice,
            Normalize(paymentMode),
            Normalize(vendorName),
            Normalize(clientAttachmentIdsJson));

        entry.Raise(new CostEntryCreatedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            entry.Amount,
            entry.CurrencyCode));

        return entry;
    }

    /// <summary>
    /// Blank is not a statement. A whitespace-only unit or vendor name is the
    /// absence of an answer, so it is stored as NULL rather than as an empty
    /// string that later reads like the farmer typed something.
    /// </summary>
    private static string? Normalize(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

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
            sourceAiJobId,
            // Not a guess and not derived: settling a job card IS paying money
            // out. The factory's own name is the statement, and there is no
            // caller of it for which the money moves the other way.
            direction: MoneyDirection.Expense,
            quantity: null,
            unit: null,
            unitPrice: null,
            paymentMode: null,
            vendorName: null,
            clientAttachmentIdsJson: null);

        entry.JobCardId = jobCardId;

        entry.Raise(new CostEntryCreatedEvent(
            Guid.NewGuid(),
            createdAtUtc,
            id,
            entry.Amount,
            entry.CurrencyCode));

        return entry;
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-S fix pass 1, B002) — the record this money was made from was moved to another place and/or
    /// day: the money follows it. The amount never changes (P7); only the place (plot, or none for several plots / the
    /// whole farm), its crop season and the day. The clock only moves forward, so the pull carries it to every phone.
    /// </summary>
    public void FollowRecord(Guid? plotId, Guid? cropCycleId, DateOnly entryDate, DateTime movedAtUtc)
    {
        PlotId = plotId;
        CropCycleId = cropCycleId;
        EntryDate = entryDate;
        if (movedAtUtc > ModifiedAtUtc)
        {
            ModifiedAtUtc = movedAtUtc;
        }
    }

    /// <summary>
    /// spec: plr-d10 (lane OF-M fix passes 1 and 3) — flag money for the person who reviews money, later than it was made
    /// (an edit's correction raised it past <see cref="ReviewAmountThreshold"/>, review 6). Server-side only: no phone
    /// shows a money flag yet (F90, open in the D-12 approval lane). The amount never changes; its clock moves forward.
    /// </summary>
    public void FlagForReview(string reason, DateTime atUtc)
    {
        Flag(reason);
        if (atUtc > ModifiedAtUtc)
        {
            ModifiedAtUtc = atUtc;
        }
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
        // lane PRV fix pass 1 (L6) — forward only: never back below a cursor that already read this money.
        if (correctedAtUtc > ModifiedAtUtc)
        {
            ModifiedAtUtc = correctedAtUtc;
        }

        Raise(new CostEntryCorrectedEvent(
            Guid.NewGuid(),
            correctedAtUtc,
            Id,
            correctionId,
            correctedAmount,
            currencyCode));
    }

    /// <summary>
    /// spec: plr-d10 lane PRV (founder D-26) — who may see this money record, as the farm's primary account holder chose
    /// it. <see cref="RecordAudience.Team"/> (the default, exactly today's behaviour) until he narrows it.
    /// </summary>
    public RecordAudience Audience { get; private set; } = RecordAudience.Team;

    /// <summary>lane PRV — when the audience last changed; <c>null</c> when it never did.</summary>
    public DateTime? AudienceChangedAtUtc { get; private set; }

    /// <summary>
    /// lane PRV — the audience changed. Moves the entry past every phone's cursor and nothing else: the amount, its
    /// corrections and its history are untouched (P3).
    /// </summary>
    public void SetAudience(RecordAudience audience, DateTime changedAtUtc)
    {
        if (!Enum.IsDefined(audience))
        {
            throw new ArgumentOutOfRangeException(nameof(audience), audience, "Unknown audience.");
        }

        Audience = audience;
        ModifiedAtUtc = AudienceStamp.NextModified(ModifiedAtUtc, changedAtUtc);
        AudienceChangedAtUtc = ModifiedAtUtc;
    }

    public void AttachLocation(LocationSnapshot location)
    {
        if (Location is not null)
        {
            throw new InvalidOperationException("Location is immutable once attached.");
        }

        Location = location;
        if (location.CapturedAtUtc > ModifiedAtUtc)
        {
            ModifiedAtUtc = location.CapturedAtUtc;
        }
    }
}
