using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.UseCases.Dfes.GetDayUnderstanding;
using ShramSafal.Application.UseCases.Dfes.GetFarmerEngagement;
using ShramSafal.Application.UseCases.Dfes.GetPlotDayUnderstanding;

namespace ShramSafal.Api.Endpoints;

public static class DfesEndpoints
{
    // Asia/Kolkata is a fixed +05:30 offset (no DST) — mirrors
    // DailyRichnessDerivationService's local-date computation so the "today"
    // default below resolves to the same farm-local day the aggregate is keyed on.
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    public static RouteGroupBuilder MapDfesEndpoints(this RouteGroupBuilder group)
    {
        // GET /shramsafal/engagement?farmId={guid}
        // Read-only DFES engagement projection (streak / points / rich-day bar).
        group.MapGet("/engagement", async (
            Guid farmId,
            ClaimsPrincipal user,
            [FromServices] GetFarmerEngagementHandler handler,
            [FromServices] ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: dfes-companion-2026-07-11 — establish the membership-validated
            // single-farm tenant scope BEFORE the handler's first DbCommand so the
            // read passes under prod FORCE-RLS (the DFES handlers self-authorize via
            // the repository and never set the tenant claim, so without this the
            // TenantConnectionInterceptor fail-closes on "no tenant claim set").
            // A forged/non-member farmId returns Forbidden here → 403.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var result = await handler.HandleAsync(
                new GetFarmerEngagementQuery(farmId, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmerEngagement");

        // GET /shramsafal/day-understanding?farmId={guid}&date=yyyy-MM-dd
        // The single farmer-facing "Day Understanding Score" (X/10) for the active
        // farm's day — DERIVED server-side from the internal lens scores — plus the
        // day's STORED classification. Returns { score, classification } and nothing
        // else: score is null when nothing scorable is logged, classification is null
        // when there is no aggregate for the day, and the three DFES lenses NEVER
        // cross to the client. Classification was added on founder ruling 2
        // (2026-08-14) so a day the farmer honestly declared as no-work can show him
        // NO number — see DayUnderstandingDto for the full rationale.
        // `date` defaults to the farm-local (IST) today.
        group.MapGet("/day-understanding", async (
            Guid farmId,
            DateOnly? date,
            ClaimsPrincipal user,
            [FromServices] GetDayUnderstandingHandler handler,
            [FromServices] IClock clock,
            [FromServices] ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: dfes-companion-2026-07-11 — establish the membership-validated
            // single-farm tenant scope BEFORE the handler's first DbCommand so the
            // per-day read passes under prod FORCE-RLS. Forged/non-member farmId → 403.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var localDate = date ?? DateOnly.FromDateTime(clock.UtcNow + IstOffset);

            var result = await handler.HandleAsync(
                new GetDayUnderstandingQuery(farmId, localDate, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetDayUnderstanding");

        // GET /shramsafal/day-understanding/plots?farmId={guid}&date=yyyy-MM-dd
        // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2). Each plot's own understanding of the day, derived on
        // read from that plot's records: [{ plotId, score0to10 | null, understood: [{mr,en}], nextHint: {mr,en} | null }].
        // score0to10 is null for a plot with no record that day (and for a declared no-work day); a farm-level record counts for no
        // plot. Shown only on the result screen - no meter or number goes on the farm overview. Another farm -> 403.
        // `date` defaults to the farm-local (IST) today.
        group.MapGet("/day-understanding/plots", async (
            Guid farmId,
            DateOnly? date,
            ClaimsPrincipal user,
            [FromServices] GetPlotDayUnderstandingHandler handler,
            [FromServices] IClock clock,
            [FromServices] ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The membership-validated single-farm tenant scope BEFORE the handler's first DbCommand, so the read passes under
            // prod FORCE-RLS (as the farm-day read above). Forged/non-member farmId -> 403.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var localDate = date ?? DateOnly.FromDateTime(clock.UtcNow + IstOffset);

            var result = await handler.HandleAsync(
                new GetPlotDayUnderstandingQuery(farmId, localDate, actorUserId), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlotDayUnderstanding");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}
