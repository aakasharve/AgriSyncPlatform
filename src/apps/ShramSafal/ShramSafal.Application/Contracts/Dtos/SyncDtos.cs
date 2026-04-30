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
    IReadOnlyList<TestRecommendationDto> TestRecommendations,
    // CEI Phase 3 §4.6 — compliance signals
    IReadOnlyList<ComplianceSignalDto> ComplianceSignals,
    // CEI Phase 4 §4.8 — Work Trust Ledger
    IReadOnlyList<JobCardDto> JobCards,
    // Sub-plan 03 Task 10 — partial-failure surface. When non-empty,
    // the response carries PARTIAL data: at least one component fetch
    // failed and the named components should display a degraded state
    // in the UI.
    //
    // Cursor semantics today (post-af7aa83): NextCursorUtc ADVANCES
    // even on partial failure. Frontend clients must inspect
    // DegradedComponents (or the X-Degraded response header) and
    // decide whether to retry the same window — they cannot rely on
    // the cursor staying at SinceUtc as proof of "data missed."
    //
    // The cursor-freeze invariant ("if degraded, do not advance the
    // cursor so the next pull retries this window") is filed as
    // T-IGH-03-PULL-CURSOR-FREEZE pending a real-DB fail-injection
    // test; do not consume the freeze as a contract until that lands.
    //
    // Optional with a default of empty so all existing callers remain
    // wire-compatible — null/missing in the JSON deserializes to []
    // for clients that haven't been updated.
    IReadOnlyList<AgriSync.BuildingBlocks.Results.DegradedComponent>? DegradedComponents = null);
