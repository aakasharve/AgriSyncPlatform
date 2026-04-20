using System.Threading;
using System.Threading.Tasks;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Application.UseCases.Export.ExportVerificationReport;

public class ExportVerificationReportHandler
{
    private readonly IReportExportService _exportService;

    public ExportVerificationReportHandler(IReportExportService exportService)
    {
        _exportService = exportService;
    }

    public async Task<byte[]> HandleAsync(ExportVerificationReportQuery request, CancellationToken cancellationToken = default)
    {
        return await _exportService.GenerateVerificationReportAsync(request.FarmId, request.FromDate, request.ToDate, cancellationToken);
    }
}
