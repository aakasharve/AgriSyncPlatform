
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Export.ExportDailySummary;
using ShramSafal.Application.UseCases.Export.ExportMonthlyCost;
using ShramSafal.Application.UseCases.Export.ExportVerificationReport;

namespace ShramSafal.Api.Endpoints;

public static class ExportEndpoints
{
    public static RouteGroupBuilder MapExportEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/export/daily-summary", async (
            [FromQuery] Guid farmId,
            [FromQuery] DateOnly date,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IClock clock,
            ICallerFarmTenantScope tenantScope,
            [FromServices] ExportDailySummaryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane MU-3 fix 1 (F94) — open the caller's farm scope first, as every working farm route does:
            // without it the first read failed closed in TenantConnectionInterceptor (500 for everyone).
            if (!(await tenantScope.EstablishForCallerAsync(farmId, actorUserId, ct)).IsSuccess
                || !await MayExportAsync(repository, clock, farmId, actorUserId, ct))
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportDailySummaryQuery(farmId, date, actorUserId), ct);
            return Results.File(pdfBytes, "application/pdf", $"daily-summary-{date:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportDailySummary");

        group.MapGet("/export/monthly-cost", async (
            [FromQuery] Guid farmId,
            [FromQuery] int year,
            [FromQuery] int month,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IClock clock,
            ICallerFarmTenantScope tenantScope,
            [FromServices] ExportMonthlyCostHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane MU-3 fix 1 (F94) — open the caller's farm scope first, as every working farm route does:
            // without it the first read failed closed in TenantConnectionInterceptor (500 for everyone).
            if (year is < 1 or > 9999 || month is < 1 or > 12)
            {
                return Results.BadRequest();
            }

            var monthStart = new DateOnly(year, month, 1);
            if (!(await tenantScope.EstablishForCallerAsync(farmId, actorUserId, ct)).IsSuccess
                || !await MayExportAsync(repository, clock, farmId, actorUserId, ct))
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportMonthlyCostQuery(farmId, year, month, actorUserId), ct);
            return Results.File(pdfBytes, "application/pdf", $"monthly-cost-{year}-{month:D2}.pdf");
        })
        .WithName("ExportMonthlyCost");

        group.MapGet("/export/verification", async (
            [FromQuery] Guid farmId,
            [FromQuery] DateOnly fromDate,
            [FromQuery] DateOnly toDate,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IClock clock,
            ICallerFarmTenantScope tenantScope,
            [FromServices] ExportVerificationReportHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane MU-3 fix 1 (F94) — open the caller's farm scope first, as every working farm route does:
            // without it the first read failed closed in TenantConnectionInterceptor (500 for everyone).
            if (!(await tenantScope.EstablishForCallerAsync(farmId, actorUserId, ct)).IsSuccess
                || !await MayExportAsync(repository, clock, farmId, actorUserId, ct))
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportVerificationReportQuery(farmId, fromDate, toDate, actorUserId), ct);
            return Results.File(pdfBytes, "application/pdf", $"verification-report-{fromDate:yyyy-MM-dd}-to-{toDate:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportVerificationReport");

        return group;
    }

    /// <summary>
    /// lane MU-3 (founder D-22 / D-26) — every export is a FARM report that carries amounts (the day
    /// ledger's allocations), so it goes only to a seat that sees the farm's money and reads the farm's
    /// records (not an own-records-only seat). Public so the REST-door proof runs the route's own rule.
    /// </summary>
    /// <para>spec: plr-d10 lane PRV fix pass 1 (M5) — a record of the period kept from him never refuses the export:
    /// the report is built from what he may see and carries the W4 line when something is left out
    /// (<c>ExportVisibility</c>, inside the export service).</para>
    public static async Task<bool> MayExportAsync(
        IShramSafalRepository repository, IClock clock, Guid farmId, Guid userId, CancellationToken ct)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, clock.UtcNow, ct);
        return scope is { SeeMoney: true, OwnRecordsOnly: false };
    }
}
