using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99. The caller's farm scope, opened before the route's first
/// farm read: the pattern lane MU-3 fix 1 (F94) applied by hand to four routes (<c>/finance/plot-summary</c>, the exports,
/// the audit trail, the farm's job cards), named once so every route that lacked it now opens it the same way. Without it
/// the route's first query failed closed in <c>TenantConnectionInterceptor</c> ("no tenant claim set and not in admin
/// scope") and the route answered 500 to everyone.
/// <list type="bullet">
/// <item>A route that names a FARM opens that farm's scope. <see cref="ICallerFarmTenantScope"/> is the gate: an id he is
/// not an active member of (made up, or another farmer's) is refused with no farm GUC ever set.</item>
/// <item>A route that names only a RECORD first finds the record's farm under the caller's OWN user scope (doctrine E4: a
/// record of a farm he is not on is not visible there, so it is not found exactly like a made-up id, with no hint that
/// it exists), then opens that farm's scope as above. The handler then asks its own rules, as before.</item>
/// </list>
/// </summary>
internal static class RouteFarmScope
{
    /// <summary>The farm the request names: <c>null</c> once its scope is open, otherwise the refusal.</summary>
    public static async Task<Error?> OpenAsync(
        ICallerFarmTenantScope farmScope, Guid farmId, Guid callerUserId, CancellationToken ct)
    {
        var opened = await farmScope.EstablishForCallerAsync(farmId, callerUserId, ct);
        return opened.IsSuccess ? null : opened.Error;
    }

    /// <summary>
    /// The record the request names: <paramref name="farmOfRecord"/> is asked under the caller's own user scope;
    /// <paramref name="notFound"/> when it finds nothing there, otherwise that farm's scope is opened.
    /// </summary>
    public static async Task<Error?> OpenForRecordAsync(
        ICallerUserTenantScope userScope,
        ICallerFarmTenantScope farmScope,
        Guid callerUserId,
        Func<CancellationToken, Task<Guid?>> farmOfRecord,
        Error notFound,
        CancellationToken ct)
    {
        var farmId = await userScope.RunForCallerAsync(callerUserId, farmOfRecord, ct);
        return farmId is { } farm ? await OpenAsync(farmScope, farm, callerUserId, ct) : notFound;
    }
}
