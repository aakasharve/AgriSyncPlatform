using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Export.ExportDailySummary;

public sealed class ExportDailySummaryHandler(
    IShramSafalRepository repository,
    IReportExportService reportExportService)
{
    public async Task<Result<byte[]>> HandleAsync(ExportDailySummaryQuery query, CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty || query.Date == default)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(query.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.FarmNotFound);
        }

        var pdfBytes = await reportExportService.GenerateDailySummaryAsync(query.FarmId, query.Date, ct);
        return Result.Success(pdfBytes);
    }
}
