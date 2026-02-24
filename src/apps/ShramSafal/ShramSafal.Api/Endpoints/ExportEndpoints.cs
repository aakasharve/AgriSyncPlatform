
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Routing;
using ShramSafal.Application.UseCases.Export.ExportDailySummary;
using ShramSafal.Application.UseCases.Export.ExportMonthlyCost;
using ShramSafal.Application.UseCases.Export.ExportVerificationReport;

namespace ShramSafal.Api.Endpoints;

public static class ExportEndpoints
{
    public static void MapExportEndpoints(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/shramsafal/export").RequireAuthorization();

        group.MapGet("/daily-summary", async (
            [FromQuery] Guid farmId, 
            [FromQuery] DateOnly date, 
            [FromServices] ExportDailySummaryHandler handler) =>
        {
            var pdfBytes = await handler.HandleAsync(new ExportDailySummaryQuery(farmId, date));
            return Results.File(pdfBytes, "application/pdf", $"daily-summary-{date:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportDailySummary");

        group.MapGet("/monthly-cost", async (
            [FromQuery] Guid farmId, 
            [FromQuery] int year, 
            [FromQuery] int month, 
            [FromServices] ExportMonthlyCostHandler handler) =>
        {
            var pdfBytes = await handler.HandleAsync(new ExportMonthlyCostQuery(farmId, year, month));
            return Results.File(pdfBytes, "application/pdf", $"monthly-cost-{year}-{month:D2}.pdf");
        })
        .WithName("ExportMonthlyCost");

        group.MapGet("/verification", async (
            [FromQuery] Guid farmId, 
            [FromQuery] DateOnly fromDate, 
            [FromQuery] DateOnly toDate, 
            [FromServices] ExportVerificationReportHandler handler) =>
        {
            var pdfBytes = await handler.HandleAsync(new ExportVerificationReportQuery(farmId, fromDate, toDate));
            return Results.File(pdfBytes, "application/pdf", $"verification-report-{fromDate:yyyy-MM-dd}-to-{toDate:yyyy-MM-dd}.pdf");
        })
        .WithName("ExportVerificationReport");
    }
}
