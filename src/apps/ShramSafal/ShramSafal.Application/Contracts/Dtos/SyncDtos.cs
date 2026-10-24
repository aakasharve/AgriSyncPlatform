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

/// <summary>
/// Labour V2 R1 Task 3.5c — one attendance ruling on the pull wire.
/// <c>DayMark</c>/<c>NightMark</c> are enum NAMES; <c>null</c> means
/// Unmarked — "nobody said" survives the wire, never as a zero.
/// <c>WorkDate</c> is the farmer's day as <c>yyyy-MM-dd</c>, not a timestamp.
/// </summary>
public sealed record AttendanceMarkDto(
    Guid Id,
    Guid FarmId,
    Guid FieldOperatorId,
    string WorkDate,
    string? DayMark,
    string? NightMark,
    decimal? HoursWorked,
    decimal? ExtraHours,
    string? HoursBasis,
    Guid RecordedByUserId,
    DateTime RecordedAtUtc,
    DateTime ModifiedAtUtc);

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
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — was IReadOnlyList<string>;
    // now ships canonical codes + per-language display labels so the
    // mobile-web client renders mr / hi / en without an extra round-trip.
    IReadOnlyList<CostCategoryRefDto> CostCategories,
    string ReferenceDataVersionHash,
    AttentionBoardDto? AttentionBoard,   // null = no cards; pull still succeeds
                                         // CEI Phase 2 §4.5 — test stack
    IReadOnlyList<TestInstanceDto> TestInstances,
    IReadOnlyList<TestRecommendationDto> TestRecommendations,
    // CEI Phase 3 §4.6 — compliance signals
    IReadOnlyList<ComplianceSignalDto> ComplianceSignals,
    // CEI Phase 4 §4.8 — Work Trust Ledger
    IReadOnlyList<JobCardDto> JobCards,
    // Labour V2 R1 — server-acknowledged attendance rulings. Enum names as
    // strings, NULL for Unmarked ("nobody said" survives the wire — never 0).
    IReadOnlyList<AttendanceMarkDto> AttendanceMarks,
    // Sub-plan 03 Task 10 — partial-failure surface. When non-empty,
    // the response carries PARTIAL data: at least one component fetch
    // failed and the named components should display a degraded state
    // in the UI. NextCursorUtc is FROZEN at the caller's SinceUtc when
    // any component degraded, so the next pull retries the same window
    // and missed rows reach the client without silent data loss.
    //
    // Optional with a default of empty so all existing callers remain
    // wire-compatible — null/missing in the JSON deserializes to []
    // for clients that haven't been updated.
    IReadOnlyList<AgriSync.BuildingBlocks.Results.DegradedComponent>? DegradedComponents = null);
