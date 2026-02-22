using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Contracts.Dtos;

internal static class DtoMappingExtensions
{
    public static FarmDto ToDto(this Farm farm) =>
        new(farm.Id, farm.Name, farm.OwnerUserId, farm.CreatedAtUtc);

    public static PlotDto ToDto(this Plot plot) =>
        new(plot.Id, plot.FarmId, plot.Name, plot.AreaInAcres, plot.CreatedAtUtc);

    public static CropCycleDto ToDto(this CropCycle cropCycle) =>
        new(
            cropCycle.Id,
            cropCycle.FarmId,
            cropCycle.PlotId,
            cropCycle.CropName,
            cropCycle.Stage,
            cropCycle.StartDate,
            cropCycle.EndDate,
            cropCycle.CreatedAtUtc);

    public static LogTaskDto ToDto(this LogTask task) =>
        new(task.Id, task.ActivityType, task.Notes, task.OccurredAtUtc);

    public static VerificationEventDto ToDto(this VerificationEvent verificationEvent) =>
        new(
            verificationEvent.Id,
            verificationEvent.Status.ToSyncVerificationStatus(),
            verificationEvent.Reason,
            verificationEvent.VerifiedByUserId,
            verificationEvent.OccurredAtUtc);

    public static DailyLogDto ToDto(this DailyLog log) =>
        new(
            log.Id,
            log.FarmId,
            log.PlotId,
            log.CropCycleId,
            log.OperatorUserId,
            log.LogDate,
            log.IdempotencyKey,
            log.CreatedAtUtc,
            log.CurrentVerificationStatus.ToSyncVerificationStatus(),
            log.Tasks
                .OrderBy(t => t.OccurredAtUtc)
                .Select(ToDto)
                .ToList(),
            log.VerificationEvents
                .OrderBy(v => v.OccurredAtUtc)
                .Select(ToDto)
                .ToList());

    public static CostEntryDto ToDto(this CostEntry entry) =>
        new(
            entry.Id,
            entry.FarmId,
            entry.PlotId,
            entry.CropCycleId,
            entry.Category,
            entry.Description,
            entry.Amount,
            entry.CurrencyCode,
            entry.EntryDate,
            entry.CreatedByUserId,
            entry.CreatedAtUtc,
            entry.IsCorrected,
            entry.IsFlagged,
            entry.FlagReason);

    public static PlotAllocationDto ToDto(this PlotAllocation allocation) =>
        new(
            allocation.PlotId,
            allocation.CropCycleId,
            allocation.AllocationPercent,
            allocation.AllocatedAmount);

    public static DayLedgerDto ToDto(this DayLedger ledger) =>
        new(
            ledger.Id,
            ledger.FarmId,
            ledger.DateKey,
            ledger.GlobalExpenseIds.ToList(),
            ledger.AllocationStrategy.ToString(),
            ledger.TotalGlobalCost,
            ledger.CreatedAtUtc,
            ledger.PlotAllocations.Select(ToDto).ToList());

    public static FinanceCorrectionDto ToDto(this FinanceCorrection correction) =>
        new(
            correction.Id,
            correction.CostEntryId,
            correction.OriginalAmount,
            correction.CorrectedAmount,
            correction.CurrencyCode,
            correction.Reason,
            correction.CorrectedByUserId,
            correction.CorrectedAtUtc);

    public static PriceConfigDto ToDto(this PriceConfig config) =>
        new(
            config.Id,
            config.ItemName,
            config.UnitPrice,
            config.CurrencyCode,
            config.EffectiveFrom,
            config.Version,
            config.CreatedByUserId,
            config.CreatedAtUtc);

    public static PlannedActivityDto ToDto(this PlannedActivity activity) =>
        new(
            activity.Id,
            activity.CropCycleId,
            activity.ActivityName,
            activity.Stage,
            activity.PlannedDate,
            activity.CreatedAtUtc);

    private static string ToSyncVerificationStatus(this VerificationStatus status) =>
        status switch
        {
            VerificationStatus.Draft => "draft",
            VerificationStatus.Confirmed => "confirmed",
            VerificationStatus.Verified => "verified",
            VerificationStatus.Disputed => "disputed",
            VerificationStatus.CorrectionPending => "correction_pending",
            _ => "draft"
        };
}
