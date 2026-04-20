using System.Threading;
using System.Threading.Tasks;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Application.UseCases.Export.ExportDailySummary;

public class ExportDailySummaryHandler
{
    private readonly IReportExportService _exportService;

    public ExportDailySummaryHandler(IReportExportService exportService)
    {
        _exportService = exportService;
    }

    public async Task<byte[]> HandleAsync(ExportDailySummaryQuery request, CancellationToken cancellationToken = default)
    {
        return await _exportService.GenerateDailySummaryAsync(request.FarmId, request.Date, cancellationToken);
    }
}
