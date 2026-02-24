using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Reports;

public class PdfReportExportService : IReportExportService
{
    private readonly IShramSafalRepository _repository;

    public PdfReportExportService(IShramSafalRepository repository)
    {
        _repository = repository;
    }

    public async Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var ledgers = await _repository.GetDayLedgersForFarm(farmId, date, date, ct);

        var report = new DailySummaryReport(farm, date, ledgers);
        return report.GeneratePdf();
    }

    public async Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var fromDate = new DateOnly(year, month, 1);
        var toDate = fromDate.AddMonths(1).AddDays(-1);

        var ledgers = await _repository.GetDayLedgersForFarm(farmId, fromDate, toDate, ct);
        
        var report = new MonthlyCostReport(farm, fromDate, toDate, ledgers);
        return report.GeneratePdf();
    }

    public async Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var ledgers = await _repository.GetDayLedgersForFarm(farmId, fromDate, toDate, ct);

        var report = new VerificationReport(farm, fromDate, toDate, ledgers);
        return report.GeneratePdf();
    }
}
