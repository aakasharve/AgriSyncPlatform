using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

namespace ShramSafal.Application.Contracts.Dtos;

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

public sealed record SyncOperatorDto(
    Guid UserId,
    string DisplayName,
    string Role);

public static class SyncMutationTypes
{
    public const string AllocateGlobalExpense = "allocate_global_expense";
    public const string VerifyLogV2 = "verify_log_v2";
}

public sealed record SyncPullResponseDto(
    DateTime ServerTimeUtc,
    DateTime NextCursorUtc,
    IReadOnlyList<FarmDto> Farms,
    IReadOnlyList<PlotDto> Plots,
    IReadOnlyList<CropCycleDto> CropCycles,
    IReadOnlyList<DailyLogDto> DailyLogs,
    IReadOnlyList<AttachmentDto> Attachments,
    IReadOnlyList<CostEntryDto> CostEntries,
    IReadOnlyList<FinanceCorrectionDto> FinanceCorrections,
    IReadOnlyList<DayLedgerDto> DayLedgers,
    IReadOnlyList<PriceConfigDto> PriceConfigs,
    IReadOnlyList<PlannedActivityDto> PlannedActivities,
    IReadOnlyList<AuditEventDto> AuditEvents,
    IReadOnlyList<SyncOperatorDto> Operators,
    IReadOnlyList<ScheduleTemplateDto> ScheduleTemplates,
    IReadOnlyList<CropTypeDto> CropTypes,
    IReadOnlyList<string> ActivityCategories,
    IReadOnlyList<string> CostCategories,
    string ReferenceDataVersionHash,
    AttentionBoardDto? AttentionBoard,   // null = no cards; pull still succeeds
    // CEI Phase 2 §4.5 — test stack
    IReadOnlyList<TestInstanceDto> TestInstances,
    IReadOnlyList<TestRecommendationDto> TestRecommendations);
