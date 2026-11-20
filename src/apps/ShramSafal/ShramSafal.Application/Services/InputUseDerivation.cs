// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice B)
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// Works out, for each product of a saved application record, what the server can say about it, and stores that beside the record
/// (<c>ssf.input_use_facts</c> and <c>ssf.input_use_ingredients</c>). It READS what he said and never changes it (P7): the product words,
/// the amount, how sure he was and the method stay in <c>application_input_items</c>. Each derived row records what it was derived with
/// (the library version, the facts-file version, which schedule gave day zero and where that day zero came from, P8). A value that cannot
/// be worked out is left blank, never guessed (P4): a product the library does not know has no ingredients, a plot with no main schedule
/// has no day and no stage, a use dated before day zero has no day.
///
/// <para><b>Rebuildable (P10).</b> It reads only rows the server holds, so <see cref="RebuildFarmAsync"/> can recompute every use of a
/// farm from its saved records at any time.</para>
/// </summary>
public interface IInputUseDerivation
{
    /// <summary>Derives the products of one saved record. Throws on failure; the caller keeps the record whatever happens here (P1).</summary>
    Task<int> DeriveForLogAsync(Guid farmId, Guid dailyLogId, CancellationToken ct = default);

    /// <summary>Derives every current use of the farm in the range (all of them when no range is given). Returns how many uses it derived.</summary>
    Task<int> RebuildFarmAsync(Guid farmId, DateOnly? from = null, DateOnly? to = null, CancellationToken ct = default);
}

/// <inheritdoc cref="IInputUseDerivation"/>
public sealed class InputUseDerivation(
    IInputUseStore store,
    IShramSafalRepository repository,
    IPlotSeasonReader plotSeasons,
    IIdGenerator ids,
    IClock clock) : IInputUseDerivation
{
    public Task<int> DeriveForLogAsync(Guid farmId, Guid dailyLogId, CancellationToken ct = default) =>
        DeriveAsync(farmId, dailyLogId, null, null, ct);

    public Task<int> RebuildFarmAsync(Guid farmId, DateOnly? from = null, DateOnly? to = null, CancellationToken ct = default) =>
        DeriveAsync(farmId, null, from, to, ct);

    private async Task<int> DeriveAsync(Guid farmId, Guid? dailyLogId, DateOnly? from, DateOnly? to, CancellationToken ct)
    {
        var uses = await store.ReadCurrentUsesAsync(farmId, dailyLogId, from, to, ct);
        if (uses.Count == 0)
        {
            return 0;
        }

        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        var ownerUserId = farm?.OwnerUserId.Value ?? Guid.Empty;
        var cache = new Dictionary<Guid, PlotSeason>();
        var now = clock.UtcNow;
        var facts = new List<InputUseFact>(uses.Count);
        var ingredients = new List<InputUseIngredient>();

        foreach (var use in uses)
        {
            var season = PlotSeason.None;
            if (use.PlotId is { } plotId && ownerUserId != Guid.Empty)
            {
                if (!cache.TryGetValue(plotId, out var cached))
                {
                    cached = await plotSeasons.ReadAsync(farmId, plotId, ownerUserId, ct);
                    cache[plotId] = cached;
                }

                season = cached;
            }

            var product = LibraryProductOf(use);
            var factId = ids.New();
            var rows = product is null ? [] : IngredientsOf(farmId, factId, product, use);
            int? day = season.DayZero is { } zero && use.UseDate >= zero ? use.UseDate.DayNumber - zero.DayNumber : null;
            var groups = rows.Select(r => r.GroupCode).Where(g => !string.IsNullOrWhiteSpace(g)).Distinct(StringComparer.Ordinal).ToList();

            facts.Add(new InputUseFact(
                factId, farmId, use.PlotId, use.OperationId, use.ItemId, use.UseDate, use.ProductName,
                product?.Id, InputCatalog.Version, IngredientFactsReference.Version, season.Crop,
                season.DayZero, season.DayZeroSource, season.TemplateId, day,
                season.StageOn(use.UseDate), groups.Count == 0 ? null : string.Join("; ", groups), now));
            ingredients.AddRange(rows);
        }

        await store.ReplaceAsync(farmId, uses.Select(u => u.ItemId).ToList(), facts, ingredients, ct);
        return uses.Count;
    }

    /// <summary>The library product his words come to when it is exactly one product. More than one, or none, is no product (P4).</summary>
    private static CatalogProduct? LibraryProductOf(UsedInput use)
    {
        var match = InputCatalog.Match(use.ProductName, use.NpkGrade);
        return match is { State: MatchState.Found, ProductId: { } id } ? InputCatalog.Get(id) : null;
    }

    private List<InputUseIngredient> IngredientsOf(Guid farmId, Guid factId, CatalogProduct product, UsedInput use)
    {
        var rows = new List<InputUseIngredient>();
        var ordinal = 0;
        foreach (var ingredient in product.ActiveIngredients)
        {
            var name = !string.IsNullOrWhiteSpace(ingredient.En) ? ingredient.En! : ingredient.Mr;
            if (string.IsNullOrWhiteSpace(name)) continue;
            var known = IngredientFactsReference.Find(ingredient.En);
            rows.Add(new InputUseIngredient(ids.New(), farmId, factId, ordinal++, known?.Key, name, ingredient.Mr, ingredient.Pct, known?.Group));
        }

        // A fertilizer sold by its grade ("19:19:19"): the numbers are the label's, so nitrogen, phosphorus and potash are listed with them.
        var grade = (product.NpkGrade ?? use.NpkGrade ?? string.Empty).Split(':');
        if (grade.Length >= 3 && grade.Select(g => decimal.TryParse(g, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out _)).All(ok => ok))
        {
            var names = new[] { ("nitrogen", "Nitrogen (N)", "नत्र (N)"), (null as string, "Phosphorus (P)", "स्फुरद (P)"), ("potassium", "Potash (K)", "पालाश (K)") };
            for (var i = 0; i < 3; i++)
            {
                var amount = decimal.Parse(grade[i], System.Globalization.CultureInfo.InvariantCulture);
                var (key, en, mr) = names[i];
                if (amount <= 0 || (key is not null && rows.Any(r => r.IngredientKey == key))) continue;
                rows.Add(new InputUseIngredient(ids.New(), farmId, factId, ordinal++, key, en, mr, amount.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture) + "%", key is null ? null : IngredientFactsReference.GroupOfKey(key)));
            }
        }

        return rows;
    }
}
