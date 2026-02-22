using System.Text;
using AgriSync.SharedKernel.Contracts.Roles;
using Moq;
using QuestPDF.Infrastructure;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Reports;
using Xunit;

namespace ShramSafal.Domain.Tests.Export;

public sealed class ExportHandlerTests
{
    static ExportHandlerTests()
    {
        QuestPDF.Settings.License = LicenseType.Community;
    }

    [Fact]
    public async Task DailySummary_GeneratesNonEmptyPdf()
    {
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var date = new DateOnly(2026, 2, 22);
        var createdAtUtc = new DateTime(2026, 2, 22, 8, 0, 0, DateTimeKind.Utc);

        var farm = Farm.Create(farmId, "Demo Farm", Guid.NewGuid(), createdAtUtc);
        var plot = Plot.Create(plotId, farmId, "North Plot", 2.5m, createdAtUtc);
        var log = DailyLog.Create(Guid.NewGuid(), farmId, plotId, Guid.NewGuid(), Guid.NewGuid(), date, "log-1", createdAtUtc);
        log.AddTask(Guid.NewGuid(), "Sowing", "Seed bed prepared", createdAtUtc.AddMinutes(15));
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.PrimaryOwner, Guid.NewGuid(), createdAtUtc.AddMinutes(30));
        log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.PrimaryOwner, Guid.NewGuid(), createdAtUtc.AddMinutes(45));

        var costEntry = CostEntry.Create(
            Guid.NewGuid(),
            farmId,
            plotId,
            Guid.NewGuid(),
            "Seeds",
            "Hybrid seeds",
            1200m,
            "INR",
            date,
            Guid.NewGuid(),
            createdAtUtc);

        var repository = CreateRepositoryMock();
        repository
            .Setup(x => x.GetFarmByIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(farm);
        repository
            .Setup(x => x.GetPlotsByFarmIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([plot]);
        repository
            .Setup(x => x.GetDailyLogsForFarmByDateRangeAsync(farmId, date, date, It.IsAny<CancellationToken>()))
            .ReturnsAsync([log]);
        repository
            .Setup(x => x.GetCostEntriesForFarmByDateRangeAsync(farmId, date, date, It.IsAny<CancellationToken>()))
            .ReturnsAsync([costEntry]);
        repository
            .Setup(x => x.GetCorrectionsForEntriesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var service = new PdfReportExportService(repository.Object);

        var pdf = await service.GenerateDailySummaryAsync(farmId, date, CancellationToken.None);

        AssertPdfDocument(pdf);
    }

    [Fact]
    public async Task MonthlyCost_WithNoData_ReturnsEmptyStatePdf()
    {
        var farmId = Guid.NewGuid();
        var farm = Farm.Create(farmId, "Demo Farm", Guid.NewGuid(), DateTime.UtcNow);

        var repository = CreateRepositoryMock();
        repository
            .Setup(x => x.GetFarmByIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(farm);
        repository
            .Setup(x => x.GetPlotsByFarmIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        repository
            .Setup(x => x.GetCostEntriesForFarmByDateRangeAsync(
                farmId,
                new DateOnly(2026, 2, 1),
                new DateOnly(2026, 2, 28),
                It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        repository
            .Setup(x => x.GetCorrectionsForEntriesAsync(It.IsAny<IEnumerable<Guid>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var service = new PdfReportExportService(repository.Object);

        var pdf = await service.GenerateMonthlyCostReportAsync(farmId, 2026, 2, CancellationToken.None);

        AssertPdfDocument(pdf);
    }

    [Fact]
    public async Task VerificationReport_CoversRequestedDateRange()
    {
        var farmId = Guid.NewGuid();
        var fromDate = new DateOnly(2026, 2, 1);
        var toDate = new DateOnly(2026, 2, 15);

        var repository = CreateRepositoryMock();
        repository
            .Setup(x => x.GetFarmByIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(Farm.Create(farmId, "Demo Farm", Guid.NewGuid(), DateTime.UtcNow));
        repository
            .Setup(x => x.GetPlotsByFarmIdAsync(farmId, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);
        repository
            .Setup(x => x.GetDailyLogsForFarmByDateRangeAsync(farmId, fromDate, toDate, It.IsAny<CancellationToken>()))
            .ReturnsAsync([]);

        var service = new PdfReportExportService(repository.Object);

        var pdf = await service.GenerateVerificationReportAsync(farmId, fromDate, toDate, CancellationToken.None);

        AssertPdfDocument(pdf);
        repository.Verify(
            x => x.GetDailyLogsForFarmByDateRangeAsync(farmId, fromDate, toDate, It.IsAny<CancellationToken>()),
            Times.Once);
    }

    private static Mock<IShramSafalRepository> CreateRepositoryMock()
    {
        return new Mock<IShramSafalRepository>(MockBehavior.Strict);
    }

    private static void AssertPdfDocument(byte[] pdf)
    {
        Assert.NotNull(pdf);
        Assert.NotEmpty(pdf);
        Assert.True(pdf.Length > 64);

        var header = Encoding.ASCII.GetString(pdf, 0, 5);
        Assert.Equal("%PDF-", header);
    }
}
