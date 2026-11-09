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
    IReadOnlyList<AgriSync.BuildingBlocks.Results.DegradedComponent>? DegradedComponents = null,
    // lane MU-3 (plan step 4a) — what this person may read on EACH farm this pull covers, one entry
    // per farm. A farm the phone holds that is NOT listed is no longer his to read (paused, removed,
    // never approved): the phone purges it. Additive and last (P11): an older phone ignores it and
    // simply receives less; an older server never sends it (the phone then purges nothing).
    IReadOnlyList<FarmAccessScopeDto>? AccessScopes = null,
    // spec: plr-d10 lane PRV (founder D-26) — records this person held (they were made before his cursor) whose
    // audience changed after it and that he may no longer see: kind + id, NOTHING else. The phone removes them and
    // everything that hangs from them. Additive and last (P11): an older phone ignores it and keeps its copy (D-65).
    IReadOnlyList<WithdrawnRecordDto>? WithdrawnRecords = null,
    // spec: plr-d10 lane RATE-1 part A (founder D-72) — the versions of each farm's OWN rate list made since this phone's
    // cursor, as he may read them (input prices with see money; work rates also need see wages). Additive and last (P11):
    // 1.0.17 parses the pull with no schema and never reads it; `priceConfigs` above keeps its F99 answer exactly.
    IReadOnlyList<FarmRateDto>? FarmRates = null,
    // spec: plr-d10 lane BILL-1 fix round 1 (review M4) — true from a server that sends every cost entry with its bill version
    // (and its review state and stamp). A phone that pulled its bills before that holds them with no version and asks once
    // for a full pull (the F1 path); an older server never sends it, so a phone never asks it. Additive and last (P11).
    bool? BillVersions = null,
    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2; founders D-92 / D-95) — his हो / नाही / फोटो answers about the
    // products of saved records, kept since this phone's cursor, for the records he may see: the newest answer of each item
    // (the speaker's and the check separately). Their own delta - an answer never moves its record's clock. Additive and last
    // (P11): 1.0.17 parses the pull with no schema and never reads it.
    IReadOnlyList<InputIdentityAssertionDto>? InputIdentityAssertions = null,
    // spec: plr-d10 lane L8b-2 (founder D-32, register F09) - each plot's chosen schedule, changed since this phone's cursor
    // (every state: Active, Migrated, Abandoned, Completed, so a phone sees a switch), for the farms and plots this person may
    // read the farm overview of (the rule planned work follows). Additive and last (P11): 1.0.17 parses the pull with no
    // schema and never reads it; a phone that does not know the key simply keeps its own choice.
    IReadOnlyList<ScheduleSubscriptionDto>? ScheduleSubscriptions = null,
    // spec: plr-d10 lane L8c-1 (founder D-24c, D-26, D-79) - the tasks and reminders of the farms he reads, changed since his
    // cursor, as HE may see them (PlannedWorkVisibility: the maker, the assignee, the primary owner, a holder of SeeAllTasks;
    // a chosen-plots seat only his plots' rows). A task taken from him (a reassign) is named in WithdrawnRecords under kind
    // "PlannedWork". Additive and last (P11): 1.0.17 parses the pull with no schema and never reads it.
    IReadOnlyList<PlannedWorkDto>? PlannedWork = null,
    // spec: plr-d10 lane L8b-3 (R6, D-76) - which followed schedule is the मुख्य one of each plot-season this person may see, computed by
    // the server (MainSchedule.Pick) and sent in FULL on every pull (the subscriptions above are a delta: a flag stamped on each would go
    // stale when ANOTHER row changed or a check was withdrawn). Same filter as the subscriptions: farms whose overview he reads, his
    // plots, Active only. Additive and last (P11): 1.0.17 never reads it; a phone that does not know it keeps its own best guess.
    IReadOnlyList<PlotMainScheduleDto>? PlotMainSchedules = null,
    // spec: plr-d10 lane SCH-GATE-a (founder D-76, D-83 = 1) - what the planning gate says about EACH plot this person may see (the trial, whether
    // the plot follows a schedule it may, whether there is something to choose, today's trial stage, whether he must choose first), computed by
    // the server and sent in FULL on every pull: the trial ends with no row changing, so a delta would go stale (the reason PlotMainSchedules is full).
    // Same filter as PlotMainSchedules: farms whose overview he reads, his plots. Additive and last (P11): 1.0.17 parses the pull with no schema and
    // never reads it. Only planning, the schedule page and the comparison read it; no record door ever does.
    IReadOnlyList<PlotPlanningStateDto>? PlotPlanningState = null);

/// <summary>spec: plr-d10 lane L8b-3 - the मुख्य schedule of one plot-season: the subscription (an Active row) the stage line follows.</summary>
public sealed record PlotMainScheduleDto(Guid PlotId, Guid CropCycleId, Guid SubscriptionId);

/// <summary>
/// lane PRV — one record taken back from a phone: its kind (<c>DailyLog</c> / <c>CostEntry</c>) and id. Content-free.
/// </summary>
public sealed record WithdrawnRecordDto(string Kind, Guid Id);

/// <summary>
/// lane PRV — one kind of record on one day that this person's totals do not count (W4: "By ShramSafal's rules, some
/// records are not counted here"). Kind is <c>work</c> or <c>money</c>; the day is the record's own day. No id, no
/// amount, no words: the phone only needs to know WHICH totals to label.
/// </summary>
public sealed record WithheldRecordDayDto(string Kind, DateOnly Date);

/// <summary>
/// lane MU-3 — one farm's read scope on the pull wire (<c>Services.FarmReadScope</c>), for the phone's
/// purge and its screens. Booleans only: no authority names, no expiry (those stay on <c>/me/context</c>).
/// <para>MU-3 fix 1 (F9) — <see cref="Status"/> says what the farm IS to this person: <c>Active</c> (read
/// per the flags), or — only for a farm the phone said it holds and may no longer read — <c>Paused</c>,
/// <c>Waiting</c> or <c>Removed</c> (every flag false). The phone removes a farm's data only on one of these
/// three, never because a farm is absent from the list.</para>
/// </summary>
/// <param name="FarmId">The farm.</param>
/// <param name="OwnRecordsOnly">Only the records this person made are sent; the phone drops everyone else's.</param>
/// <param name="SeeMoney">Money is sent (cost entries, corrections, day ledger, crew totals, a record's stated money).</param>
/// <param name="SeeWages">A named worker's pay is sent (per-person wages, job-card rates and payouts, earnings).</param>
/// <param name="SeeAttendance">Attendance rulings are sent.</param>
/// <param name="SeeTests">Test records are sent.</param>
/// <param name="SeeCompliance">Compliance warnings are sent.</param>
/// <param name="SeeFarmOverview">The attention board, the planned work and the job cards are sent.</param>
/// <param name="Status"><c>Active</c>, <c>Paused</c>, <c>Waiting</c> or <c>Removed</c> (additive; absent = Active).</param>
public sealed record FarmAccessScopeDto(
    Guid FarmId,
    bool OwnRecordsOnly,
    bool SeeMoney,
    bool SeeWages,
    bool SeeAttendance,
    bool SeeTests,
    bool SeeCompliance,
    bool SeeFarmOverview,
    string Status = FarmAccessScopeDto.Active,
    // spec: plr-d10 lane PRV — the days of this farm whose totals leave out a record by rule (W4). Additive; absent or
    // empty = every record the farm holds is counted for him.
    IReadOnlyList<WithheldRecordDayDto>? WithheldRecordDays = null,
    // spec: plr-d10 lane MU-4 — which plots this seat covers: "AllPlots", "ChosenPlots" or "OwnWork" (additive; absent =
    // every plot, an older server), and, for chosen plots only, the plots (null otherwise). The phone's pickers offer only
    // these plots and its purge removes what lies outside them. A not-readable entry carries neither.
    string? PlotScope = null,
    IReadOnlyList<Guid>? PlotIds = null,
    // spec: plr-d10 lane L8c-1 fix round 1 (L001) - this person holds "see all tasks" now, computed with the clock (an ended
    // grant is false). Additive and nullable (P11): absent = an older server, and the phone removes no task. With PlotScope and
    // PlotIds it is all the phone needs to mirror which tasks he may see. A not-readable entry carries none.
    bool? SeeAllTasks = null)
{
    public const string Active = "Active";
    public const string Paused = "Paused";
    public const string Waiting = "Waiting";
    public const string Removed = "Removed";

    public static FarmAccessScopeDto From(Services.FarmReadScope scope) =>
        new(
            scope.FarmId,
            scope.OwnRecordsOnly,
            scope.SeeMoney,
            scope.SeeWages,
            scope.SeeAttendance,
            scope.SeeTests,
            scope.SeeCompliance,
            scope.SeeFarmOverview,
            PlotScope: scope.PlotScope.ToString(),
            PlotIds: scope.PlotIds?.Order().ToList(),
            SeeAllTasks: scope.SeeAllTasks);

    /// <summary>
    /// A farm the phone holds that this person may no longer read: a paused seat says Paused, a waiting
    /// request Waiting, and no live seat at all (removed, exited, never a member) Removed.
    /// </summary>
    public static FarmAccessScopeDto NotReadable(Guid farmId, Services.FarmAccess? access) =>
        new(
            farmId, OwnRecordsOnly: false, SeeMoney: false, SeeWages: false, SeeAttendance: false,
            SeeTests: false, SeeCompliance: false, SeeFarmOverview: false,
            Status: access?.Status switch
            {
                Domain.Farms.MembershipStatus.Suspended => Paused,
                Domain.Farms.MembershipStatus.PendingApproval or Domain.Farms.MembershipStatus.PendingOtpClaim => Waiting,
                _ => Removed,
            });
}
