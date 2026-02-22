using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Export.ExportDailySummary;
using ShramSafal.Application.UseCases.Export.ExportMonthlyCost;
using ShramSafal.Application.UseCases.Export.ExportVerificationReport;

namespace ShramSafal.Api.Endpoints;

public static class ExportEndpoints
{
    public static RouteGroupBuilder MapExportEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/export/daily-summary", async (
            Guid farmId,
            DateOnly date,
            ExportDailySummaryHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ExportDailySummaryQuery(farmId, date), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            if (result.Value is null || result.Value.Length == 0)
            {
                return Results.Problem("Generated PDF content is empty.");
            }

            return Results.File(
                result.Value,
                contentType: "application/pdf",
                fileDownloadName: $"daily-summary-{date:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportDailySummary")
        .RequireAuthorization();

        group.MapGet("/export/monthly-cost", async (
            Guid farmId,
            int year,
            int month,
            ExportMonthlyCostHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ExportMonthlyCostQuery(farmId, year, month), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            if (result.Value is null || result.Value.Length == 0)
            {
                return Results.Problem("Generated PDF content is empty.");
            }

            return Results.File(
                result.Value,
                contentType: "application/pdf",
                fileDownloadName: $"monthly-cost-{year:D4}-{month:D2}.pdf");
        })
        .WithName("ExportMonthlyCost")
        .RequireAuthorization();

        group.MapGet("/export/verification", async (
            Guid farmId,
            DateOnly fromDate,
            DateOnly toDate,
            ExportVerificationReportHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ExportVerificationReportQuery(farmId, fromDate, toDate), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            if (result.Value is null || result.Value.Length == 0)
            {
                return Results.Problem("Generated PDF content is empty.");
            }

            return Results.File(
                result.Value,
                contentType: "application/pdf",
                fileDownloadName: $"verification-{fromDate:yyyy-MM-dd}-to-{toDate:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportVerificationReport")
        .RequireAuthorization();

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}
