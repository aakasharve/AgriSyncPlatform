using System;
using System.Reflection;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Ledger;

public sealed class AppendOnlyTests
{
    [Fact]
    public void DailyLog_CoreFields_DoNotHavePublicSetters()
    {
        AssertNoPublicSetter(typeof(DailyLog), nameof(DailyLog.LogDate));
        AssertNoPublicSetter(typeof(DailyLog), nameof(DailyLog.FarmId));
        AssertNoPublicSetter(typeof(DailyLog), nameof(DailyLog.PlotId));
        AssertNoPublicSetter(typeof(DailyLog), nameof(DailyLog.CropCycleId));
        AssertNoPublicSetter(typeof(DailyLog), nameof(DailyLog.OperatorUserId));
    }

    [Fact]
    public void CostEntry_CoreFields_DoNotHavePublicSetters()
    {
        AssertNoPublicSetter(typeof(CostEntry), nameof(CostEntry.Amount));
        AssertNoPublicSetter(typeof(CostEntry), nameof(CostEntry.Category));
        AssertNoPublicSetter(typeof(CostEntry), nameof(CostEntry.PlotId));
        AssertNoPublicSetter(typeof(CostEntry), nameof(CostEntry.CreatedByUserId));
        AssertNoPublicSetter(typeof(CostEntry), nameof(CostEntry.CreatedAtUtc));
    }

    [Fact]
    public void DailyLog_Edit_AppendsDraftVerificationWithoutMutatingCoreFields()
    {
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cycleId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();
        var logDate = new DateOnly(2026, 2, 22);

        var log = DailyLog.Create(
            Guid.NewGuid(),
            farmId,
            plotId,
            cycleId,
            actorUserId,
            logDate,
            "device-a:req-1",
            null,
            DateTime.UtcNow);

        var originalFarmId = log.FarmId;
        var originalPlotId = log.PlotId;
        var originalCycleId = log.CropCycleId;
        var originalLogDate = log.LogDate;

        var editEvent = log.Edit(Guid.NewGuid(), actorUserId, DateTime.UtcNow, "Adjusted notes");

        Assert.Equal(VerificationStatus.Draft, editEvent.Status);
        Assert.Equal(originalFarmId, log.FarmId);
        Assert.Equal(originalPlotId, log.PlotId);
        Assert.Equal(originalCycleId, log.CropCycleId);
        Assert.Equal(originalLogDate, log.LogDate);
        Assert.Contains(log.VerificationEvents, x => x.Id == editEvent.Id);
    }

    [Fact]
    public void CostEntry_CorrectionFlow_UsesFinanceCorrectionRecord()
    {
        var costEntry = CostEntry.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "Labour",
            "Pruning wages",
            1400m,
            "INR",
            new DateOnly(2026, 2, 21),
            Guid.NewGuid(),
            null,
            DateTime.UtcNow);

        var correction = FinanceCorrection.Create(
            Guid.NewGuid(),
            costEntry.Id,
            costEntry.Amount,
            1320m,
            costEntry.CurrencyCode,
            "Duplicate person removed",
            Guid.NewGuid(),
            DateTime.UtcNow);

        costEntry.MarkCorrected(
            correction.Id,
            correction.CorrectedAmount,
            correction.CurrencyCode,
            correction.CorrectedAtUtc);

        Assert.True(costEntry.IsCorrected);
        Assert.Equal(costEntry.Id, correction.CostEntryId);
    }

    [Fact]
    public void Attachment_Finalized_BecomesImmutable()
    {
        var attachment = Attachment.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            "DailyLog",
            "receipt.jpg",
            "image/jpeg",
            Guid.NewGuid(),
            DateTime.UtcNow);

        attachment.MarkUploaded("attachments/test/receipt.jpg", 1280, DateTime.UtcNow);
        attachment.FinalizeUpload(DateTime.UtcNow);

        Assert.Equal(AttachmentStatus.Finalized, attachment.Status);
        Assert.Throws<InvalidOperationException>(() =>
            attachment.MarkUploaded("attachments/test/receipt2.jpg", 1280, DateTime.UtcNow));
    }

    private static void AssertNoPublicSetter(Type type, string propertyName)
    {
        var property = type.GetProperty(propertyName, BindingFlags.Public | BindingFlags.Instance);
        Assert.NotNull(property);
        Assert.False(property!.SetMethod?.IsPublic ?? false);
    }
}
