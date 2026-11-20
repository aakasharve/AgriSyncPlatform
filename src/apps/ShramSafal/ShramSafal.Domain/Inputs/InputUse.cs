// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice B)
using AgriSync.BuildingBlocks.Domain;

namespace ShramSafal.Domain.Inputs;

/// <summary>
/// One DERIVED row per product he named in a saved application: <c>ssf.input_use_facts</c>. What he SAID (the product words, the amount
/// and how sure he was, the method) stays where it was written, in <c>ssf.application_input_items</c>; this row holds only what the server
/// worked out from it, beside the record of what it was worked out from (doctrine P1 and P8): the library product and library version,
/// the facts-file version, the day-zero date and which schedule gave it, the crop, the day of the season and the stage that day was in.
/// A blank value is a value that could not be worked out (P4); nothing here is a guess. The row is REPLACED when the use is derived again
/// (the app role may delete it); it can always be rebuilt from the farm's saved records (P10).
/// </summary>
public sealed class InputUseFact : Entity<Guid>
{
    public const int MaxName = 500;
    public const int MaxText = 200;

    private InputUseFact() : base(Guid.Empty) { } // EF Core

    public InputUseFact(
        Guid id, Guid farmId, Guid? plotId, Guid operationId, Guid inputItemId, DateOnly useDate, string productSaid,
        string? libraryProductId, string libraryVersion, string factsVersion, string? cropName,
        DateOnly? dayZeroDate, string? dayZeroSource, Guid? scheduleTemplateId, int? dayOfSeason, string? stageName,
        string? groupCodes, DateTime derivedAtUtc)
        : base(id)
    {
        if (id == Guid.Empty) throw new ArgumentException("id must be set.", nameof(id));
        if (dayOfSeason is < 0) throw new ArgumentOutOfRangeException(nameof(dayOfSeason), "A day before day zero has no day (P4).");
        FarmId = farmId;
        PlotId = plotId;
        OperationId = operationId;
        InputItemId = inputItemId;
        UseDate = useDate;
        ProductSaid = Clip(productSaid, MaxName)!;
        LibraryProductId = libraryProductId;
        LibraryVersion = libraryVersion;
        FactsVersion = factsVersion;
        CropName = Clip(cropName, MaxText);
        DayZeroDate = dayZeroDate;
        DayZeroSource = dayZeroSource;
        ScheduleTemplateId = scheduleTemplateId;
        DayOfSeason = dayOfSeason;
        StageName = Clip(stageName, MaxText);
        GroupCodes = Clip(groupCodes, MaxText);
        DerivedAtUtc = derivedAtUtc;
    }

    public Guid FarmId { get; private set; }
    public Guid? PlotId { get; private set; }
    public Guid OperationId { get; private set; }
    public Guid InputItemId { get; private set; }
    public DateOnly UseDate { get; private set; }

    /// <summary>A copy of the product words he said, for reading the row alone; the record's own words stay in the item.</summary>
    public string ProductSaid { get; private set; } = string.Empty;

    public string? LibraryProductId { get; private set; }
    public string LibraryVersion { get; private set; } = string.Empty;
    public string FactsVersion { get; private set; } = string.Empty;
    public string? CropName { get; private set; }

    /// <summary>Day 0 of the season, from the plot's main schedule (its own reference date, else the crop cycle's start). Null = none known.</summary>
    public DateOnly? DayZeroDate { get; private set; }

    /// <summary><c>schedule</c> (the schedule's reference date) or <c>crop-cycle-start</c>; says where <see cref="DayZeroDate"/> came from (P8).</summary>
    public string? DayZeroSource { get; private set; }

    public Guid? ScheduleTemplateId { get; private set; }

    /// <summary>The use date minus day zero. Null when no day zero is known or the use was before it.</summary>
    public int? DayOfSeason { get; private set; }

    public string? StageName { get; private set; }

    /// <summary>The library ingredients' IRAC / FRAC groups, as the facts file holds them ("IRAC 3A; FRAC M3"). Null when none is known.</summary>
    public string? GroupCodes { get; private set; }

    public DateTime DerivedAtUtc { get; private set; }

    private static string? Clip(string? value, int max)
    {
        var trimmed = value?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        return trimmed.Length <= max ? trimmed : trimmed[..max];
    }
}

/// <summary>One ingredient of a used product: <c>ssf.input_use_ingredients</c>, so a season can be sorted and counted by ingredient.</summary>
public sealed class InputUseIngredient : Entity<Guid>
{
    private InputUseIngredient() : base(Guid.Empty) { } // EF Core

    public InputUseIngredient(
        Guid id, Guid farmId, Guid inputUseFactId, int ordinal, string? ingredientKey, string ingredientName,
        string? ingredientNameMr, string? percent, string? groupCode)
        : base(id)
    {
        if (id == Guid.Empty) throw new ArgumentException("id must be set.", nameof(id));
        if (string.IsNullOrWhiteSpace(ingredientName)) throw new ArgumentException("An ingredient needs a name.", nameof(ingredientName));
        FarmId = farmId;
        InputUseFactId = inputUseFactId;
        Ordinal = ordinal;
        IngredientKey = ingredientKey;
        IngredientName = ingredientName.Trim();
        IngredientNameMr = string.IsNullOrWhiteSpace(ingredientNameMr) ? null : ingredientNameMr.Trim();
        Percent = string.IsNullOrWhiteSpace(percent) ? null : percent.Trim();
        GroupCode = groupCode;
    }

    public Guid FarmId { get; private set; }
    public Guid InputUseFactId { get; private set; }
    public int Ordinal { get; private set; }

    /// <summary>The facts file's key for this ingredient, when the file holds it.</summary>
    public string? IngredientKey { get; private set; }

    public string IngredientName { get; private set; } = string.Empty;
    public string? IngredientNameMr { get; private set; }

    /// <summary>The strength as the library prints it ("5%"), or the grade's number for an NPK fertilizer.</summary>
    public string? Percent { get; private set; }

    public string? GroupCode { get; private set; }
}
