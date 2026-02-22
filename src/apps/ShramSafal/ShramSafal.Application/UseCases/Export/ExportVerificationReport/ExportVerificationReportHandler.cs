using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Export.ExportVerificationReport;

public sealed class ExportVerificationReportHandler(
    IShramSafalRepository repository,
    IReportExportService reportExportService)
{
    public async Task<Result<byte[]>> HandleAsync(ExportVerificationReportQuery query, CancellationToken ct = default)
    {
        if (query.FarmId == Guid.Empty ||
            query.FromDate == default ||
            query.ToDate == default ||
            query.FromDate > query.ToDate)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(query.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<byte[]>(ShramSafalErrors.FarmNotFound);
        }

        var pdfBytes = await reportExportService.GenerateVerificationReportAsync(
            query.FarmId,
            query.FromDate,
            query.ToDate,
            ct);

        return Result.Success(pdfBytes);
    }
}
