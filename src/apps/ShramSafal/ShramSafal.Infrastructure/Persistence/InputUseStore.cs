// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slices B and C)
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Inputs;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// <see cref="IInputUseStore"/> over <c>ssf.farm_operations</c> + <c>ssf.application_input_items</c> (what he said, read only here) and
/// <c>ssf.input_use_facts</c> / <c>ssf.input_use_ingredients</c> (what the server worked out, replaced on a re-derivation). Reads go
/// through the same row security as every other farm table; nothing here can see another farm's rows.
/// </summary>
internal sealed class InputUseStore(ShramSafalDbContext db) : IInputUseStore
{
    private const int Chunk = 500;

    public async Task<IReadOnlyList<UsedInput>> ReadCurrentUsesAsync(
        Guid farmId, Guid? sourceDailyLogId, DateOnly? from, DateOnly? to, CancellationToken ct = default)
    {
        var farm = new FarmId(farmId);
        var ops = db.FarmOperations.AsNoTracking()
            .Where(o => o.FarmId == farm && o.OperationType == "application" && o.IsCurrentVersion);
        if (sourceDailyLogId is { } logId) ops = ops.Where(o => o.SourceDailyLogId == logId);
        if (from is { } f) ops = ops.Where(o => o.OperationDate >= f);
        if (to is { } t) ops = ops.Where(o => o.OperationDate <= t);

        var rows = await (
            from o in ops
            join i in db.ApplicationInputItems.AsNoTracking() on o.Id equals i.OperationId
            join p in db.Plots.AsNoTracking() on o.PlotId equals (Guid?)p.Id into plots
            from p in plots.DefaultIfEmpty()
            orderby o.OperationDate, o.CreatedAtUtc, i.Ordinal
            select new
            {
                o.PlotId,
                PlotName = p == null ? null : p.Name,
                OperationId = o.Id,
                o.SourceDailyLogId,
                o.CreatedByUserId,
                o.OperationDate,
                ItemId = i.Id,
                i.Ordinal,
                i.ProductName,
                i.ProductType,
                i.NpkGrade,
                i.DoseAmount,
                i.DoseUnit,
                i.DoseBasisQty,
                i.DoseBasisUnit,
                i.DoseCertainty,
                i.DoseSpokenText,
                i.Method,
                i.CarrierWaterLitres,
            }).ToListAsync(ct);

        return rows.Select(r => new UsedInput(
            farmId, r.PlotId, r.PlotName, r.OperationId, r.SourceDailyLogId, r.CreatedByUserId.Value, r.OperationDate,
            r.ItemId, r.Ordinal, r.ProductName, r.ProductType, r.NpkGrade, r.DoseAmount, r.DoseUnit, r.DoseBasisQty,
            r.DoseBasisUnit, r.DoseCertainty?.ToString(), r.DoseSpokenText, r.Method, r.CarrierWaterLitres)).ToList();
    }

    public async Task ReplaceAsync(
        Guid farmId, IReadOnlyCollection<Guid> inputItemIds,
        IReadOnlyList<InputUseFact> facts, IReadOnlyList<InputUseIngredient> ingredients, CancellationToken ct = default)
    {
        foreach (var ids in inputItemIds.Chunk(Chunk))
        {
            var oldFacts = await db.InputUseFacts.Where(f => f.FarmId == farmId && ids.Contains(f.InputItemId)).ToListAsync(ct);
            if (oldFacts.Count == 0) continue;
            var oldFactIds = oldFacts.Select(f => f.Id).ToList();
            var oldIngredients = await db.InputUseIngredients.Where(i => i.FarmId == farmId && oldFactIds.Contains(i.InputUseFactId)).ToListAsync(ct);
            db.InputUseIngredients.RemoveRange(oldIngredients);
            db.InputUseFacts.RemoveRange(oldFacts);
        }

        // The old rows go first so the one-row-per-item key never sees two of the same item.
        await db.SaveChangesAsync(ct);
        db.InputUseFacts.AddRange(facts);
        db.InputUseIngredients.AddRange(ingredients);
        await db.SaveChangesAsync(ct);
    }

    public async Task<IReadOnlyList<InputUseLedgerRow>> ReadLedgerAsync(Guid farmId, DateOnly firstDay, DateOnly lastDay, CancellationToken ct = default)
    {
        var uses = await ReadCurrentUsesAsync(farmId, null, firstDay, lastDay, ct);
        var facts = await db.InputUseFacts.AsNoTracking()
            .Where(f => f.FarmId == farmId && f.UseDate >= firstDay && f.UseDate <= lastDay).ToListAsync(ct);
        var ingredients = await (
            from i in db.InputUseIngredients.AsNoTracking()
            join f in db.InputUseFacts.AsNoTracking() on i.InputUseFactId equals f.Id
            where f.FarmId == farmId && i.FarmId == farmId && f.UseDate >= firstDay && f.UseDate <= lastDay
            orderby i.Ordinal
            select i).ToListAsync(ct);

        var factByItem = facts.GroupBy(f => f.InputItemId).ToDictionary(g => g.Key, g => g.OrderByDescending(f => f.DerivedAtUtc).First());
        var ingredientsByFact = ingredients.GroupBy(i => i.InputUseFactId).ToDictionary(g => g.Key, g => (IReadOnlyList<InputUseIngredient>)g.ToList());
        return uses.Select(u =>
        {
            factByItem.TryGetValue(u.ItemId, out var fact);
            var list = fact is not null && ingredientsByFact.TryGetValue(fact.Id, out var found) ? found : [];
            return new InputUseLedgerRow(u, fact, list);
        }).ToList();
    }
}
