using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Finance;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
/// What a rate is FOR: an input's price (product, unit, price) or a work / service rate (a worker category or crew, and a
/// basis per day / hour / acre / trip / task).
/// </summary>
public enum FarmRateKind
{
    /// <summary>An input's price: fertiliser, spray, seed, fuel — per a unit he names (पोते, किलो, लिटर).</summary>
    Input = 1,

    /// <summary>A work or service rate: what one kind of work costs per day / hour / acre / trip / task.</summary>
    Work = 2,
}

/// <summary>What the amount is per (D-43). An input is per a named unit; work is per day / hour / acre / trip / task.</summary>
public enum FarmRateBasis
{
    PerUnit = 1,
    PerDay = 2,
    PerHour = 3,
    PerAcre = 4,
    PerTrip = 5,
    PerTask = 6,
}

/// <summary>
/// spec: plr-d10 lane RATE-1 part A — ONE VERSION of one rate on ONE farm's own list (<c>ssf.farm_rates</c>).
///
/// <para><b>History is the table (doctrine P3).</b> A line (<see cref="RateLineId"/>) is a rate; every change to it is a
/// NEW row with the next <see cref="Version"/>, numbered by the server (never the phone: a client number is the P4 risk the
/// shared list's <c>PriceConfig.Version</c> carries). Current truth is the line's highest version; every earlier row is
/// history ("was X, is now Y"). Stopping a rate is a version with <see cref="Retired"/> — who and when — never a deletion.
/// Nothing here has a setter a handler can reach, and the database grants the app role SELECT and INSERT only.</para>
///
/// <para><b>It rewrites nothing.</b> A rate is the farm's own statement of a price. No bill, cost entry, wage or job card
/// reads it, and nothing computes a wage from it (D-17).</para>
///
/// <para><b>Who set it</b> is a user id only (<see cref="CreatedByUserId"/>), never name text (erasure: KEEP, see
/// <c>ErasureWorker</c>). <see cref="SuggestionId"/> names the ShramSafal suggested rate it was confirmed from, if any
/// (provenance, P8) — the row itself is his, with his unit, basis and kind.</para>
/// </summary>
public sealed class FarmRate : Entity<Guid>
{
    public const int MaxItemName = 120;
    public const int MaxUnit = 40;
    public const int MaxWorkerCategory = 80;
    public const int MaxSeason = 60;
    public const int MaxClientRequestId = 200;
    public const int MaxAppVersion = 64;

    /// <summary>The largest rate one row may state (₹ 1 crore): beyond it the number is a typing slip, not a price.</summary>
    public const decimal MaxAmount = 10_000_000m;

    private FarmRate() : base(Guid.Empty) { } // EF Core

    private FarmRate(Guid id) : base(id) { }

    public FarmId FarmId { get; private set; }
    public Guid RateLineId { get; private set; }
    public int Version { get; private set; }
    public FarmRateKind Kind { get; private set; }
    public string ItemName { get; private set; } = string.Empty;
    public string? Unit { get; private set; }
    public FarmRateBasis Basis { get; private set; }
    public string? WorkerCategory { get; private set; }
    public decimal Amount { get; private set; }
    public string CurrencyCode { get; private set; } = "INR";
    public DateOnly EffectiveFrom { get; private set; }
    public string? Season { get; private set; }
    public DateOnly? EndsOn { get; private set; }
    public bool Retired { get; private set; }
    public Guid? SuggestionId { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public string? ClientRequestId { get; private set; }
    public string? AppVersion { get; private set; }

    /// <summary>
    /// A version of a rate, or the refusal that names what is wrong with it. <paramref name="version"/> is the server's
    /// (the line's previous highest + 1). <paramref name="createdAtUtc"/> is kept to the microsecond Postgres stores and
    /// never exactly on a whole second (a phone's cursor is a whole second; <c>AudienceStamp</c>'s reason).
    /// </summary>
    public static Result<FarmRate> Create(
        Guid id,
        FarmId farmId,
        Guid rateLineId,
        int version,
        FarmRateKind kind,
        string? itemName,
        string? unit,
        FarmRateBasis basis,
        string? workerCategory,
        decimal amount,
        string? currencyCode,
        DateOnly effectiveFrom,
        string? season,
        DateOnly? endsOn,
        bool retired,
        Guid? suggestionId,
        UserId createdByUserId,
        DateTime createdAtUtc,
        string? clientRequestId,
        string? appVersion)
    {
        var name = Clean(itemName);
        var unitText = Clean(unit);
        var category = Clean(workerCategory);
        var seasonText = Clean(season);
        var currency = Clean(currencyCode)?.ToUpperInvariant();

        if (id == Guid.Empty || farmId.IsEmpty || rateLineId == Guid.Empty || version <= 0 || createdByUserId.IsEmpty
            || !Enum.IsDefined(kind) || !Enum.IsDefined(basis)
            || name is null || name.Length > MaxItemName
            || (unitText?.Length ?? 0) > MaxUnit || (category?.Length ?? 0) > MaxWorkerCategory || (seasonText?.Length ?? 0) > MaxSeason
            || currency is not { Length: 3 } || !currency.All(char.IsAsciiLetterUpper)
            || amount <= 0 || amount > MaxAmount
            || (endsOn is { } end && end < effectiveFrom)
            || (suggestionId is { } s && s == Guid.Empty))
        {
            return Result.Failure<FarmRate>(FarmRateErrors.Invalid);
        }

        // An input is per a unit he names (₹ 90 per kg and ₹ 90 per bag are different prices); work is per day / hour /
        // acre / trip / task and names no unit. A worker category or crew belongs to work only.
        if (kind == FarmRateKind.Input && (basis != FarmRateBasis.PerUnit || unitText is null || category is not null))
        {
            return Result.Failure<FarmRate>(FarmRateErrors.Invalid);
        }

        if (kind == FarmRateKind.Work && (basis == FarmRateBasis.PerUnit || unitText is not null))
        {
            return Result.Failure<FarmRate>(FarmRateErrors.Invalid);
        }

        return Result.Success(new FarmRate(id)
        {
            FarmId = farmId,
            RateLineId = rateLineId,
            Version = version,
            Kind = kind,
            ItemName = name,
            Unit = unitText,
            Basis = basis,
            WorkerCategory = category,
            Amount = decimal.Round(amount, 2, MidpointRounding.AwayFromZero),
            CurrencyCode = currency,
            EffectiveFrom = effectiveFrom,
            Season = seasonText,
            EndsOn = endsOn,
            Retired = retired,
            SuggestionId = suggestionId,
            CreatedByUserId = createdByUserId,
            CreatedAtUtc = Stamp(createdAtUtc),
            ClientRequestId = Clip(clientRequestId, MaxClientRequestId),
            AppVersion = Clip(appVersion, MaxAppVersion),
        });
    }

    /// <summary>The next version of this line: the same rate, stopped (who and when are the new row's).</summary>
    public Result<FarmRate> RetiredVersion(
        Guid id, UserId by, DateTime atUtc, string? clientRequestId, string? appVersion) =>
        Create(id, FarmId, RateLineId, Version + 1, Kind, ItemName, Unit, Basis, WorkerCategory, Amount, CurrencyCode,
            EffectiveFrom, Season, EndsOn, retired: true, SuggestionId, by, atUtc, clientRequestId, appVersion);

    /// <summary>Does <paramref name="other"/> state exactly what this version states (a repeat changes nothing)?</summary>
    public bool StatesTheSameAs(FarmRate other) =>
        Kind == other.Kind && ItemName == other.ItemName && Unit == other.Unit && Basis == other.Basis
        && WorkerCategory == other.WorkerCategory && Amount == other.Amount && CurrencyCode == other.CurrencyCode
        && EffectiveFrom == other.EffectiveFrom && Season == other.Season && EndsOn == other.EndsOn
        && Retired == other.Retired && SuggestionId == other.SuggestionId;

    private static string? Clean(string? text) => string.IsNullOrWhiteSpace(text) ? null : text.Trim();

    private static string? Clip(string? text, int max) =>
        Clean(text) is { } t ? t[..Math.Min(t.Length, max)] : null;

    private static DateTime Stamp(DateTime atUtc)
    {
        var utc = atUtc.Kind == DateTimeKind.Utc ? atUtc : DateTime.SpecifyKind(atUtc.ToUniversalTime(), DateTimeKind.Utc);
        var ticks = utc.Ticks - (utc.Ticks % 10);
        if (ticks % TimeSpan.TicksPerSecond == 0)
        {
            ticks += 10;
        }

        return new DateTime(ticks, DateTimeKind.Utc);
    }
}

/// <summary>lane RATE-1 — the refusals of the farm's own rate list. Each code is stable on the wire.</summary>
public static class FarmRateErrors
{
    /// <summary>
    /// Only the farm's primary account holder sets its rates in part A (<c>FarmRateGate.MayWriteRatesAsync</c>). Ends in
    /// "Forbidden": every installed phone parks it visibly (P10), never retries it, never drops it.
    /// </summary>
    public static readonly Error PrimaryHolderOnly = Error.Forbidden(
        "ShramSafal.FarmRate.Forbidden",
        "Only the farm's primary account holder may set its rates.");

    /// <summary>The rate is malformed: what it is for, its unit or basis, its amount or its dates.</summary>
    public static readonly Error Invalid = Error.Validation(
        "ShramSafal.FarmRate.InvalidCommand",
        "This rate is incomplete or malformed: what it is for, its unit or basis, its amount (more than zero) or its dates.");

    /// <summary>The line or version id is already held for another farm: a rate is never continued across farms (E4).</summary>
    public static readonly Error Conflict = Error.Conflict(
        "ShramSafal.FarmRate.Conflict",
        "This rate belongs to another farm's list.");

    /// <summary>A stop names a rate this farm's list does not hold (yet): it may still be on its way.</summary>
    public static readonly Error LineNotFound = Error.NotFound(
        "ShramSafal.FarmRate.LineNotFound",
        "This rate is not on the farm's list.");

    /// <summary>
    /// fix round 1 (review F2) — a rate line keeps ONE kind for life: an input price never becomes a work rate or back (a
    /// reader without see wages would otherwise hold the superseded input version as current, P4). Its tail is in every
    /// new phone's permanent list: the same bytes get the same answer, so it parks instead of retrying.
    /// </summary>
    public static readonly Error KindChangeNotAllowed = Error.Validation(
        "ShramSafal.FarmRate.KindChangeNotAllowed",
        "A rate keeps its kind: an input price cannot become a work rate, or the other way round. Write a new rate instead.");

    /// <summary>The named ShramSafal suggestion is not one of ShramSafal's own suggested rates (P8: no made-up provenance).</summary>
    public static readonly Error UnknownSuggestion = Error.Validation(
        "ShramSafal.FarmRate.UnknownSuggestion",
        "The suggested rate this names is not one of ShramSafal's suggested rates.");
}
