// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C)
using System.Globalization;
using System.Text;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;

namespace ShramSafal.Application.UseCases.Inputs.InputUseLedger;

/// <summary>One product of one application in the season ledger: what he SAID, then what the server worked out beside it (blank where it could not).</summary>
public sealed record InputUseLedgerRowDto(
    Guid InputItemId,
    Guid? DailyLogId,
    DateOnly Date,
    Guid? PlotId,
    string? PlotName,
    string? CropName,
    int? DayOfSeason,
    string? StageName,
    string ProductSaid,
    string? LibraryProductId,
    IReadOnlyList<string> Ingredients,
    // the same ingredients' Marathi names in the same order (null where the library holds none), so a Marathi screen shows Marathi only
    IReadOnlyList<string?> IngredientsMr,
    string? GroupCodes,
    // what he said, as he said it
    decimal? Amount,
    string? Unit,
    decimal? PerQuantity,
    string? PerUnit,
    string? AmountCertainty,
    string? AmountSpokenText,
    string? Method,
    decimal? CarrierWaterLitres,
    // what it was derived with
    string? LibraryVersion,
    string? FactsVersion,
    string? DayZeroSource,
    bool Derived);

/// <summary>A roll-up by product. <see cref="Total"/> is filled only when EVERY use of the product states an amount, in one unit, with no "per" basis: never a sum of guesses (P4).</summary>
public sealed record InputUseProductTotalDto(string Product, string? LibraryProductId, int Uses, DateOnly LastUsed, decimal? Total, string? Unit, string? NoTotalBecause);

/// <summary>A roll-up by ingredient: how many uses held it, with its group code when the facts file has one.</summary>
public sealed record InputUseIngredientTotalDto(string Ingredient, string? IngredientMr, string? Key, string? GroupCode, int Uses);

public sealed record InputUseLedgerDto(
    DateOnly From, DateOnly To,
    IReadOnlyList<InputUseLedgerRowDto> Rows,
    IReadOnlyList<InputUseProductTotalDto> Products,
    IReadOnlyList<InputUseIngredientTotalDto> Ingredients,
    int NotYetDerived);

/// <summary>
/// The season ledger of a farm's inputs, sortable and extractable: every current application record in a date range, with the product,
/// the amount in HIS words and units, the method, the day of the season and the stage, the ingredients and their group codes. Read
/// only. Owner (the primary account holder) only: a ledger holds every record of the farm and the record audience rules are not applied
/// row by row here.
/// </summary>
public sealed class GetInputUseLedgerHandler(IInputUseStore store, IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<InputUseLedgerDto>> HandleAsync(Guid farmId, Guid callerUserId, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        if (scope is not { IsPrimaryAccountHolder: true })
        {
            return Result.Failure<InputUseLedgerDto>(ShramSafalErrors.Forbidden);
        }

        var today = FarmLocalDay.From(clock.UtcNow); // the farmer's day: until 05:30 IST the UTC date is still yesterday
        var last = to ?? today;
        var first = from ?? last.AddYears(-1);
        if (first > last)
        {
            return Result.Failure<InputUseLedgerDto>(ShramSafalErrors.Forbidden);
        }

        var rows = await store.ReadLedgerAsync(farmId, first, last, ct);
        return Result.Success(Build(first, last, rows));
    }

    internal static InputUseLedgerDto Build(DateOnly from, DateOnly to, IReadOnlyList<InputUseLedgerRow> rows)
    {
        var dtos = rows.Select(r =>
        {
            var u = r.Used;
            var f = r.Facts;
            return new InputUseLedgerRowDto(
                u.ItemId, u.SourceDailyLogId, u.UseDate, u.PlotId, u.PlotName, f?.CropName, f?.DayOfSeason, f?.StageName,
                u.ProductName, f?.LibraryProductId, r.Ingredients.OrderBy(i => i.Ordinal).Select(i => i.IngredientName).ToList(),
                r.Ingredients.OrderBy(i => i.Ordinal).Select(i => i.IngredientNameMr).ToList(), f?.GroupCodes,
                u.DoseAmount, u.DoseUnit, u.DoseBasisQty, u.DoseBasisUnit, u.DoseCertainty, u.DoseSpokenText, u.Method, u.CarrierWaterLitres,
                f?.LibraryVersion, f?.FactsVersion, f?.DayZeroSource, f is not null);
        }).OrderBy(r => r.Date).ThenBy(r => r.PlotName, StringComparer.Ordinal).ToList();

        var products = dtos.GroupBy(r => r.LibraryProductId ?? ("said:" + r.ProductSaid.Trim().ToLowerInvariant())).Select(g =>
        {
            var list = g.ToList();
            var units = list.Select(r => r.Unit?.Trim().ToLowerInvariant()).Distinct().ToList();
            string? why = null;
            if (list.Any(r => r.Amount is null)) why = "some uses state no amount";
            else if (list.Any(r => r.PerQuantity is not null)) why = "some amounts are per a quantity of water";
            else if (units.Count > 1) why = "the amounts are in different units";
            return new InputUseProductTotalDto(
                list[0].LibraryProductId is null ? list[0].ProductSaid : list[0].ProductSaid, list[0].LibraryProductId, list.Count, list.Max(r => r.Date),
                why is null ? list.Sum(r => r.Amount!.Value) : null, why is null ? list[0].Unit : null, why);
        }).OrderByDescending(p => p.Uses).ThenBy(p => p.Product, StringComparer.Ordinal).ToList();

        var ingredients = rows.SelectMany(r => r.Ingredients.Select(i => (i.IngredientKey, i.IngredientName, i.IngredientNameMr, i.GroupCode, Fact: r.Facts!.Id)))
            .GroupBy(x => x.IngredientKey ?? x.IngredientName.ToLowerInvariant())
            .Select(g => new InputUseIngredientTotalDto(g.First().IngredientName, g.First().IngredientNameMr, g.First().IngredientKey, g.First().GroupCode, g.Select(x => x.Fact).Distinct().Count()))
            .OrderByDescending(i => i.Uses).ThenBy(i => i.Ingredient, StringComparer.Ordinal).ToList();

        return new InputUseLedgerDto(from, to, dtos, products, ingredients, dtos.Count(r => !r.Derived));
    }
}

/// <summary>Rebuilds the derived rows of a farm from its saved records (P10). Owner only. Idempotent: it replaces, never duplicates.</summary>
public sealed class RebuildInputUseHandler(IInputUseDerivation derivation, IShramSafalRepository repository, IClock clock)
{
    public async Task<Result<int>> HandleAsync(Guid farmId, Guid callerUserId, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
        if (scope is not { IsPrimaryAccountHolder: true })
        {
            return Result.Failure<int>(ShramSafalErrors.Forbidden);
        }

        return Result.Success(await derivation.RebuildFarmAsync(farmId, from, to, ct));
    }
}

/// <summary>
/// The ledger as a CSV that Excel opens with Marathi readable: UTF-8 with a byte-order mark, a header in both languages, one line per
/// product used, every field quoted, and a leading apostrophe-free text (a field that starts with = + - @ is prefixed so a spreadsheet never runs it).
/// </summary>
public static class InputUseLedgerCsv
{
    private static readonly string[] Header =
    [
        "Date / तारीख", "Plot / प्लॉट", "Crop / पीक", "Day of season / दिवस", "Stage / अवस्था", "Product said / सांगितलेले औषध",
        "Library product / यादीतील औषध", "Ingredients / घटक", "Group codes / गट", "Amount / प्रमाण", "Unit / एकक", "Per / प्रति",
        "How sure / खात्री", "His words / त्याचे शब्द", "Method / पद्धत", "Carrier water (L) / पाणी (लि.)", "Record / नोंद",
        "Library version", "Facts version", "Day zero from",
    ];

    public static byte[] Build(InputUseLedgerDto ledger)
    {
        var sb = new StringBuilder();
        sb.Append(string.Join(",", Header.Select(Quote))).Append("\r\n");
        foreach (var r in ledger.Rows)
        {
            var per = r.PerQuantity is { } q ? Number(q) + (string.IsNullOrWhiteSpace(r.PerUnit) ? string.Empty : " " + r.PerUnit) : string.Empty;
            string[] cells =
            [
                r.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), r.PlotName ?? string.Empty, r.CropName ?? string.Empty,
                r.DayOfSeason?.ToString(CultureInfo.InvariantCulture) ?? string.Empty, r.StageName ?? string.Empty, r.ProductSaid,
                r.LibraryProductId ?? string.Empty, string.Join("; ", r.Ingredients), r.GroupCodes ?? string.Empty,
                r.Amount is { } a ? Number(a) : string.Empty, r.Unit ?? string.Empty, per, r.AmountCertainty ?? string.Empty, r.AmountSpokenText ?? string.Empty,
                r.Method ?? string.Empty, r.CarrierWaterLitres is { } w ? Number(w) : string.Empty, r.DailyLogId?.ToString() ?? string.Empty,
                r.LibraryVersion ?? string.Empty, r.FactsVersion ?? string.Empty, r.DayZeroSource ?? string.Empty,
            ];
            sb.Append(string.Join(",", cells.Select(Quote))).Append("\r\n");
        }

        var body = new UTF8Encoding(false).GetBytes(sb.ToString());
        return [.. Encoding.UTF8.GetPreamble(), .. body];
    }

    private static string Number(decimal value) => value.ToString("0.##", CultureInfo.InvariantCulture);

    private static string Quote(string value)
    {
        // A cell starting with = + - @ would be run as a formula by a spreadsheet: a farmer's free words must never be.
        var safe = value.Length > 0 && "=+-@\t\r".Contains(value[0]) ? "'" + value : value;
        return "\"" + safe.Replace("\"", "\"\"") + "\"";
    }
}
