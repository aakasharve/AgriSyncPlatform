namespace ShramSafal.Application.Contracts.Dtos;

public sealed record LocationDto(
    decimal Latitude,
    decimal Longitude,
    decimal AccuracyMeters,
    decimal? Altitude,
    DateTime CapturedAtUtc,
    string Provider,
    string PermissionState);

public sealed record SyncMutationResultDto(
    string ClientRequestId,
    string MutationType,
    string Status,
    object? Data,
    string? ErrorCode,
    string? ErrorMessage);

public sealed record SyncPushResponseDto(
    DateTime ServerTimeUtc,
    IReadOnlyList<SyncMutationResultDto> Results);

public static class SyncMutationTypes
{
    public const string AllocateGlobalExpense = "allocate_global_expense";
    public const string VerifyLogV2 = "verify_log_v2";
    public const string CreateAttachment = "create_attachment";
}

public sealed record SyncPullResponseDto(
    DateTime ServerTimeUtc,
    DateTime NextCursorUtc,
    IReadOnlyList<FarmDto> Farms,
    IReadOnlyList<PlotDto> Plots,
    IReadOnlyList<CropCycleDto> CropCycles,
    IReadOnlyList<DailyLogDto> DailyLogs,
    IReadOnlyList<CostEntryDto> CostEntries,
    IReadOnlyList<FinanceCorrectionDto> FinanceCorrections,
    IReadOnlyList<PriceConfigDto> PriceConfigs,
    IReadOnlyList<AttachmentDto> Attachments,
    IReadOnlyList<DayLedgerDto> DayLedgers,
    IReadOnlyList<PlannedActivityDto> PlannedActivities);
