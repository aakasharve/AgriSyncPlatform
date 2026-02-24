using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.Contracts.Dtos;

internal static class DtoMappingExtensions
{
    public static FarmDto ToDto(this Farm farm) =>
        new(farm.Id, farm.Name, farm.OwnerUserId, farm.CreatedAtUtc, farm.ModifiedAtUtc);

    public static PlotDto ToDto(this Plot plot) =>
        new(plot.Id, plot.FarmId, plot.Name, plot.AreaInAcres, plot.CreatedAtUtc, plot.ModifiedAtUtc);

    public static CropCycleDto ToDto(this CropCycle cropCycle) =>
        new(
            cropCycle.Id,
            cropCycle.FarmId,
            cropCycle.PlotId,
            cropCycle.CropName,
            cropCycle.Stage,
            cropCycle.StartDate,
            cropCycle.EndDate,
            cropCycle.CreatedAtUtc,
            cropCycle.ModifiedAtUtc);

    public static LocationDto ToDto(this LocationSnapshot location) =>
        new(
            location.Latitude,
            location.Longitude,
            location.AccuracyMeters,
            location.Altitude,
            location.CapturedAtUtc,
            location.Provider,
            location.PermissionState);

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
            log.ModifiedAtUtc,
            log.Location?.ToDto(),
            log.LastVerificationStatus?.ToString(),
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
            entry.ModifiedAtUtc,
            entry.Location?.ToDto(),
            entry.IsCorrected);

    public static FinanceCorrectionDto ToDto(this FinanceCorrection correction) =>
        new(
            correction.Id,
            correction.CostEntryId,
            correction.OriginalAmount,
            correction.CorrectedAmount,
            correction.CurrencyCode,
            correction.Reason,
            correction.CorrectedByUserId,
            correction.CorrectedAtUtc,
            correction.ModifiedAtUtc);

    public static DayLedgerAllocationDto ToDto(this DayLedgerAllocation allocation) =>
        new(
            allocation.Id,
            allocation.PlotId,
            allocation.AllocatedAmount,
            allocation.CurrencyCode,
            allocation.AllocatedAtUtc);

    public static DayLedgerDto ToDto(this DayLedger ledger) =>
        new(
            ledger.Id,
            ledger.FarmId,
            ledger.SourceCostEntryId,
            ledger.LedgerDate,
            ledger.AllocationBasis,
            ledger.CreatedByUserId,
            ledger.CreatedAtUtc,
            ledger.ModifiedAtUtc,
            ledger.Allocations
                .OrderBy(a => a.AllocatedAtUtc)
                .Select(ToDto)
                .ToList());

    public static PriceConfigDto ToDto(this PriceConfig config) =>
        new(
            config.Id,
            config.ItemName,
            config.UnitPrice,
            config.CurrencyCode,
            config.EffectiveFrom,
            config.Version,
            config.CreatedByUserId,
            config.CreatedAtUtc,
            config.ModifiedAtUtc);

    public static PlannedActivityDto ToDto(this PlannedActivity activity) =>
        new(
            activity.Id,
            activity.CropCycleId,
            activity.ActivityName,
            activity.Stage,
            activity.PlannedDate,
            activity.CreatedAtUtc,
            activity.ModifiedAtUtc);

    public static AuditEventDto ToDto(this AuditEvent auditEvent) =>
        new(
            auditEvent.Id,
            auditEvent.FarmId,
            auditEvent.EntityType,
            auditEvent.EntityId,
            auditEvent.Action,
            auditEvent.ActorUserId,
            auditEvent.ActorRole,
            auditEvent.Payload,
            auditEvent.OccurredAtUtc,
            auditEvent.ClientCommandId);

    public static AttachmentDto ToDto(this Attachment attachment) =>
        new(
            attachment.Id,
            attachment.FarmId,
            attachment.LinkedEntityId,
            attachment.LinkedEntityType,
            attachment.FileName,
            attachment.MimeType,
            attachment.Status.ToString(),
            attachment.LocalPath,
            attachment.SizeBytes,
            attachment.CreatedByUserId,
            attachment.CreatedAtUtc,
            attachment.ModifiedAtUtc,
            attachment.UploadedAtUtc,
            attachment.FinalizedAtUtc);

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
