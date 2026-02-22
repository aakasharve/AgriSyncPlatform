using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Export.ExportMonthlyCost;

public sealed class ExportMonthlyCostHandler(
    IShramSafalRepository repository,
    IReportExportService reportExportService)
{
    public async Task<Result<byte[]>> HandleAsync(ExportMonthlyCostQuery query, CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty ||
            query.Year is < 2000 or > 2100 ||
            query.Month is < 1 or > 12)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(query.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.FarmNotFound);
        }

        var pdfBytes = await reportExportService.GenerateMonthlyCostReportAsync(query.FarmId, query.Year, query.Month, ct);
        return Result.Success(pdfBytes);
    }
}
