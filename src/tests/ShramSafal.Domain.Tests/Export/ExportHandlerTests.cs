using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Export.ExportDailySummary;
using ShramSafal.Application.UseCases.Export.ExportMonthlyCost;
using ShramSafal.Application.UseCases.Export.ExportVerificationReport;
using Xunit;

namespace ShramSafal.Domain.Tests.Export;

public sealed class ExportHandlerTests
{
    [Fact]
    public async Task DailySummary_GeneratesNonEmptyPdfBytes()
    {
        var service = new RecordingReportExportService
        {
            DailySummaryBytes = "%PDF-daily-summary"u8.ToArray(),
        };
        var handler = new ExportDailySummaryHandler(service);
        var farmId = Guid.NewGuid();
        var date = new DateOnly(2026, 2, 26);

        var result = await handler.HandleAsync(new ExportDailySummaryQuery(farmId, date));

        Assert.NotEmpty(result);
        Assert.Equal(farmId, service.LastDailySummaryFarmId);
        Assert.Equal(date, service.LastDailySummaryDate);
    }

    [Fact]
    public async Task MonthlyCost_NoData_ReturnsEmptyStatePdfWithoutError()
    {
        var service = new RecordingReportExportService
        {
            MonthlyCostBytes = "%PDF-empty-state"u8.ToArray(),
        };
        var handler = new ExportMonthlyCostHandler(service);
        var farmId = Guid.NewGuid();

        var result = await handler.HandleAsync(new ExportMonthlyCostQuery(farmId, 2026, 2));

        Assert.NotEmpty(result);
        Assert.Equal(farmId, service.LastMonthlyCostFarmId);
        Assert.Equal(2026, service.LastMonthlyCostYear);
        Assert.Equal(2, service.LastMonthlyCostMonth);
    }

    [Fact]
    public async Task VerificationReport_ForwardsRequestedDateRange()
    {
        var service = new RecordingReportExportService
        {
            VerificationBytes = "%PDF-verification"u8.ToArray(),
        };
        var handler = new ExportVerificationReportHandler(service);
        var farmId = Guid.NewGuid();
        var fromDate = new DateOnly(2026, 2, 1);
        var toDate = new DateOnly(2026, 2, 20);

        var result = await handler.HandleAsync(new ExportVerificationReportQuery(farmId, fromDate, toDate));

        Assert.NotEmpty(result);
        Assert.Equal(farmId, service.LastVerificationFarmId);
        Assert.Equal(fromDate, service.LastVerificationFromDate);
        Assert.Equal(toDate, service.LastVerificationToDate);
    }

    private sealed class RecordingReportExportService : IReportExportService
    {
        public byte[] DailySummaryBytes { get; set; } = [];
        public byte[] MonthlyCostBytes { get; set; } = [];
        public byte[] VerificationBytes { get; set; } = [];

        public Guid? LastDailySummaryFarmId { get; private set; }
        public DateOnly? LastDailySummaryDate { get; private set; }
        public Guid? LastMonthlyCostFarmId { get; private set; }
        public int? LastMonthlyCostYear { get; private set; }
        public int? LastMonthlyCostMonth { get; private set; }
        public Guid? LastVerificationFarmId { get; private set; }
        public DateOnly? LastVerificationFromDate { get; private set; }
        public DateOnly? LastVerificationToDate { get; private set; }

        public Task<byte[]> GenerateDailySummaryAsync(Guid farmId, DateOnly date, CancellationToken ct)
        {
            LastDailySummaryFarmId = farmId;
            LastDailySummaryDate = date;
            return Task.FromResult(DailySummaryBytes.Length > 0 ? DailySummaryBytes : "%PDF-default-daily"u8.ToArray());
        }

        public Task<byte[]> GenerateMonthlyCostReportAsync(Guid farmId, int year, int month, CancellationToken ct)
        {
            LastMonthlyCostFarmId = farmId;
            LastMonthlyCostYear = year;
            LastMonthlyCostMonth = month;
            return Task.FromResult(MonthlyCostBytes.Length > 0 ? MonthlyCostBytes : "%PDF-default-monthly"u8.ToArray());
        }

        public Task<byte[]> GenerateVerificationReportAsync(Guid farmId, DateOnly fromDate, DateOnly toDate, CancellationToken ct)
        {
            LastVerificationFarmId = farmId;
            LastVerificationFromDate = fromDate;
            LastVerificationToDate = toDate;
            return Task.FromResult(VerificationBytes.Length > 0 ? VerificationBytes : "%PDF-default-verification"u8.ToArray());
        }
    }
}
