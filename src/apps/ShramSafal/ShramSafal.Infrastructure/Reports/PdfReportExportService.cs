using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;

namespace ShramSafal.Infrastructure.Reports;

public class PdfReportExportService : IReportExportService
{
    private readonly IShramSafalRepository _repository;
    private readonly IClock _clock;

    public PdfReportExportService(IShramSafalRepository repository, IClock clock)
    {
        _repository = repository;
        _clock = clock;
    }

    /// <summary>
    /// spec: plr-d10 lane PRV fix pass 1 (M5) — the day-ledgers of a period this reader may see, and the W4 line when
    /// one was left out. Public so the real-Postgres proof reads exactly what a report is built from.
    /// </summary>
    public async Task<ExportLedgers> LedgersForAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, Guid readerUserId, CancellationToken ct = default)
    {
        var ledgers = await _repository.GetDayLedgersForFarm(farmId, fromDate, toDate, ct);
        var visibility = await RecordVisibility.ForFarmAsync(_repository, farmId, readerUserId, _clock.UtcNow, ct);
        return ExportVisibility.Of(ledgers, visibility);
    }

    public async Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, Guid readerUserId, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var ledgers = await LedgersForAsync(farmId, date, date, readerUserId, ct);

        var report = new DailySummaryReport(farm, date, ledgers.Shown, ledgers.RuleNote);
        return report.GeneratePdf();
    }

    public async Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, Guid readerUserId, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var fromDate = new DateOnly(year, month, 1);
        var toDate = fromDate.AddMonths(1).AddDays(-1);

        var ledgers = await LedgersForAsync(farmId, fromDate, toDate, readerUserId, ct);

        var report = new MonthlyCostReport(farm, fromDate, toDate, ledgers.Shown, ledgers.RuleNote);
        return report.GeneratePdf();
    }

    public async Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, Guid readerUserId, CancellationToken ct = default)
    {
        var farm = await _repository.GetFarmByIdAsync(farmId, ct);
        if (farm == null) throw new ArgumentException("Farm not found");

        var ledgers = await LedgersForAsync(farmId, fromDate, toDate, readerUserId, ct);

        var report = new VerificationReport(farm, fromDate, toDate, ledgers.Shown, ledgers.RuleNote);
        return report.GeneratePdf();
    }
}
