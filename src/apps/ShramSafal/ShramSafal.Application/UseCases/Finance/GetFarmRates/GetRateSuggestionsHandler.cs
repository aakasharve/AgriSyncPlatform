using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Application.UseCases.Finance.GetFarmRates;

/// <summary>
/// spec: plr-d10 lane RATE-1 part A (founder D-72; D-17 "inspect the admin price list before reusing it"; D-43 "a reference
/// rate is offered as a suggestion to confirm, never a silent wage") — "ShramSafal सुचवलेला दर": the shared list as
/// SUGGESTIONS only (<c>GET /shramsafal/finance/farm-rates/suggestions</c>), on its own door (pre-flight T8: the pull's
/// <c>priceConfigs</c> keeps its F99 answer — a farmer's own rows only — exactly, for 1.0.17).
///
/// <para><b>What the admin list is, inspected (D-17):</b> <c>PriceConfig</c> holds an item name, a price, a currency, a
/// from-date and a client-numbered version — no unit, no kind, no farm. Until F99 any farm member could push a row into
/// it, so it can hold a farmer's own price. Only rows written by ShramSafal's platform admin are offered; another
/// farmer's row is never shown to anyone else as "ShramSafal's" (a cross-farm leak and a false provenance). Of each item,
/// the newest version (highest version, then from-date) is offered.</para>
/// </summary>
public sealed class GetRateSuggestionsHandler(IShramSafalRepository repository, IEntitlementResolver adminResolver)
{
    public async Task<Result<RateSuggestionsDto>> HandleAsync(CancellationToken ct = default)
    {
        var rows = await repository.GetPriceConfigsAsync(ct);
        // fix round 1 (review F7) — every author asked in ONE query (the same rule as IsPlatformOwnerAsync).
        var admins = await adminResolver.PlatformOwnersAmongAsync(rows.Select(r => r.CreatedByUserId).Distinct().ToList(), ct);

        var suggestions = rows
            .Where(r => admins.Contains(r.CreatedByUserId.Value))
            .GroupBy(r => r.ItemName, StringComparer.Ordinal)
            .Select(g => g.OrderByDescending(r => r.Version).ThenByDescending(r => r.EffectiveFrom).First())
            .Where(r => r.UnitPrice > 0)
            .OrderBy(r => r.ItemName, StringComparer.Ordinal)
            .Select(r => new RateSuggestionDto(r.Id, r.ItemName, r.UnitPrice, r.CurrencyCode, r.EffectiveFrom))
            .ToList();

        return Result.Success(new RateSuggestionsDto(suggestions));
    }
}
