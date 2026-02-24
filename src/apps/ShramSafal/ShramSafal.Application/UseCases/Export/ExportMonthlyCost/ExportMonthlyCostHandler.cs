using System.Threading;
using System.Threading.Tasks;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Application.UseCases.Export.ExportMonthlyCost;

public class ExportMonthlyCostHandler
{
    private readonly IReportExportService _exportService;

    public ExportMonthlyCostHandler(IReportExportService exportService)
    {
        _exportService = exportService;
    }

    public async Task<byte[]> HandleAsync(ExportMonthlyCostQuery request, CancellationToken cancellationToken = default)
    {
        return await _exportService.GenerateMonthlyCostReportAsync(request.FarmId, request.Year, request.Month, cancellationToken);
    }
}
