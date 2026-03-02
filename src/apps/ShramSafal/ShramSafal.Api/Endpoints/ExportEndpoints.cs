
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using System.Security.Claims;
using ShramSafal.Application.Ports;
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
            [FromServices] ExportDailySummaryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var isFarmMember = await repository.IsUserMemberOfFarmAsync(farmId, actorUserId, ct);
            if (!isFarmMember)
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportDailySummaryQuery(farmId, date));
            return Results.File(pdfBytes, "application/pdf", $"daily-summary-{date:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportDailySummary");

        group.MapGet("/export/monthly-cost", async (
            [FromQuery] Guid farmId,
            [FromQuery] int year,
            [FromQuery] int month,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            [FromServices] ExportMonthlyCostHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var isFarmMember = await repository.IsUserMemberOfFarmAsync(farmId, actorUserId, ct);
            if (!isFarmMember)
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportMonthlyCostQuery(farmId, year, month));
            return Results.File(pdfBytes, "application/pdf", $"monthly-cost-{year}-{month:D2}.pdf");
        })
        .WithName("ExportMonthlyCost");

        group.MapGet("/export/verification", async (
            [FromQuery] Guid farmId,
            [FromQuery] DateOnly fromDate,
            [FromQuery] DateOnly toDate,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            [FromServices] ExportVerificationReportHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var isFarmMember = await repository.IsUserMemberOfFarmAsync(farmId, actorUserId, ct);
            if (!isFarmMember)
            {
                return Results.Forbid();
            }

            var pdfBytes = await handler.HandleAsync(new ExportVerificationReportQuery(farmId, fromDate, toDate));
            return Results.File(pdfBytes, "application/pdf", $"verification-report-{fromDate:yyyy-MM-dd}-to-{toDate:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportVerificationReport");

        return group;
    }
}
