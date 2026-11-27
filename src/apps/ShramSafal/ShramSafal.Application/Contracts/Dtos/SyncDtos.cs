using System.Text.Json.Serialization;
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
    string Role,
    // spec: plr-d10 pilot lane IDENT (S3; P11) - ADDITIVE, last, and written ONLY to a phone that asks (people=1) and only when there is a value
    // (PeopleOnThePull): the name in Marathi and in English letters the person saved on his own identity card (typed or confirmed by him), and
    // the pointer to his face when this reader may see it (PictureViewer). An older phone's rows are byte-for-byte what they were.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? NameMr = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? NameEn = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    Guid? PictureId = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    string? PictureSha256 = null);

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
    IReadOnlyList<PlotPlanningStateDto>? PlotPlanningState = null,
    // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1, the switch) - what the server lets THIS caller's farms do (FULL on every pull: a switch is
    // flipped and no row changes). NEVER A KEY when there is nothing to say - the schedule mechanism is off for every farm of the pull - so with the switch
    // off the pull's bytes are exactly what they were (P11); the phone reads an absent key as off. Additive and last: 1.0.17 parses the pull with no schema
    // and never reads it.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    SyncCapabilitiesDto? Capabilities = null,
    // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - the works of each plot-season's OWN schedule still being built (active and removed, each with
    // its newest revision number), for the farms of this pull the switch is on for and the plots this person reads; FULL on every pull (a few works per season).
    // Sent ONLY to a phone that asks for the new format (scheduleFormat=2): NEVER A KEY otherwise, so a 1.0.17 phone's pull is byte for byte what it was (P11).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnScheduleItemDto>? OwnScheduleItems = null,
    // spec: plr-d10 schedule slice 3 - every save and removal of those works (their append-only history), oldest first, under the same rule: new-format phones,
    // switch-on farms, the plots he reads; FULL on every pull; never a key otherwise.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnScheduleItemRevisionDto>? OwnScheduleItemRevisions = null,
    // spec: plr-d10 schedule slice 11 - the answers of the season-end review of these plots (one per work), FULL on every pull; same rule: new-format phones, switch-on farms,
    // the plots he reads; never a key otherwise. A pair of seasons with rows here was answered: the review is asked once.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnScheduleSeasonCarryDto>? OwnScheduleCarries = null,
    // spec: plr-d10 schedule slice 12b - the owner's voice. Messages of the schedules these farms follow or own copies from (FULL on every pull), their clips' METADATA (never bytes: the phone
    // fetches those online and keeps them) and the farms' own state of each (heard / decided / answered, append-only). Same rule as the keys above: new-format phones, switch-on farms, the
    // plots he reads; NEVER A KEY otherwise, so an old phone's pull is byte for byte what it was (P11).
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnerMessageSyncDto>? OwnerMessages = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnerClipSyncDto>? OwnerClips = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<OwnerMessageStateSyncDto>? OwnerMessageStates = null,
    // spec: plr-d10 repair D-9 (founder 27 Nov: "send it to server; the phone is only a door") - each farm's SETUP: water sources with their motors, the power
    // timetable, machines and each plot's water arrangement. FULL on every pull (a farm has a handful of rows), ONE entry per farm this person reads, even when
    // the farm has nothing yet (so the phone tells "empty" from "not sent"); only active rows. Sent ONLY to a phone that asks (farmSetup=1): NEVER A KEY
    // otherwise, so an old phone's pull is what it was (P11). Not behind the schedule switch: it is for every farm. No money is in any of it.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<FarmSetupDto>? FarmSetup = null);

/// <summary>
/// spec: plr-d10 repair D-9 - one farm's setup as the pull sends it. The phone replaces its copy of the farm WHOLE. Every Active member receives the sources,
/// motors, power times and machines; <see cref="PlotWater"/> only for the plots his seat covers (the pull's own plot rule). Values are the contract's lower-case words.
/// </summary>
public sealed record FarmSetupDto(
    Guid FarmId,
    IReadOnlyList<FarmWaterSourceDto> WaterSources,
    FarmPowerTimesDto? PowerTimes,
    IReadOnlyList<FarmMachineDto> Machines,
    IReadOnlyList<PlotWaterDto> PlotWater);

/// <summary>One water source with its active motors. <see cref="Revision"/> is the base revision the phone sends back with its next change of this source.</summary>
public sealed record FarmWaterSourceDto(
    Guid Id, int Revision, string Name, string SourceType, bool IsAvailable, string? Notes, IReadOnlyList<FarmMotorDto> Motors, DateTime UpdatedAtUtc);

/// <summary>One motor of a water source. <see cref="Drip"/> is null when no drip details were given.</summary>
public sealed record FarmMotorDto(Guid Id, string Name, decimal Hp, int Phase, string PowerSource, string? PowerSourceName, FarmMotorDripDto? Drip);

public sealed record FarmMotorDripDto(string? PipeSize, bool HasFilter, decimal? FlowLitresPerHour);

/// <summary>The farm's power timetable in its one canonical form (both phases; <c>weekBOffWindows</c> always present, empty when none).</summary>
public sealed record FarmPowerTimesDto(int Revision, DateTime UpdatedAtUtc, System.Text.Json.JsonElement Timetable);

/// <summary>One machine of the farm. An optional detail that was never given is null (unknown), never 0.</summary>
public sealed record FarmMachineDto(
    Guid Id, int Revision, string Name, string MachineType, string Ownership, string? Company, string? Model, decimal? Hp, int? NozzleCount, decimal? TankLitres,
    string? DetailLine, DateTime UpdatedAtUtc);

/// <summary>
/// One plot's water arrangement. A plot with NO entry was never asked (it shows बाकी); <c>method: "none"</c> is the stated "no water facility". An entry with a
/// method and no link is a plot whose source is still to be named.
/// </summary>
public sealed record PlotWaterDto(Guid PlotId, int Revision, string Method, IReadOnlyList<PlotWaterLinkDto> Links, DateTime UpdatedAtUtc);

/// <summary>One link of a plot to a water source; <see cref="MotorId"/> is null for water that comes without a motor (a canal by gravity).</summary>
public sealed record PlotWaterLinkDto(Guid WaterSourceId, Guid? MotorId);

/// <summary>
/// spec: plr-d10 schedule slice 12b - one message of a schedule owner. <see cref="Kind"/> is <c>tip</c>, <c>change</c> or <c>look</c>. A change names <see cref="NewVersionId"/> (the checked
/// version whose task is the "now"; the "before" is the task of <see cref="ScheduleVersionId"/>); a look carries its two answers in words and the follow-up clip played after each.
/// </summary>
public sealed record OwnerMessageSyncDto(
    Guid Id,
    Guid ChainId,
    Guid ScheduleVersionId,
    string TaskKey,
    string Kind,
    Guid ClipId,
    Guid? NewVersionId,
    string? AnswerFirst,
    string? AnswerSecond,
    Guid? FollowUpFirstClipId,
    Guid? FollowUpSecondClipId,
    DateTime SentAtUtc);

/// <summary>spec: plr-d10 schedule slice 12b - the metadata of one clip (never its bytes): fetch them from <c>GET /shramsafal/schedule-owner-clips/{id}?farmId=</c> while online.</summary>
public sealed record OwnerClipSyncDto(Guid Id, Guid ChainId, string MimeType, long SizeBytes, int DurationMs, string ContentHash, DateTime CreatedAtUtc);

/// <summary>
/// spec: plr-d10 schedule slice 12b - one fact about what a farm's plot did with a message. <see cref="Kind"/> is <c>heard</c>, <c>accepted</c>, <c>kept_old</c>, <c>taken_back</c> or
/// <c>answered</c>; a decision's <see cref="Sequence"/> counts from 1 (the highest standing decision of a plot-season and message is its state); an answer is <c>first</c> or <c>second</c>.
/// An accept names the own work it moved (<see cref="ItemId"/>) and the job (<see cref="JobId"/>): the job's card plays the clip of the message that changed it.
/// </summary>
public sealed record OwnerMessageStateSyncDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    Guid MessageId,
    string Kind,
    int Sequence,
    string? Answer,
    Guid? ItemId,
    bool ItemCreated,
    Guid? JobId,
    Guid ByUserId,
    DateTime AtUtc);

/// <summary>
/// spec: plr-d10 schedule slice 11 - one answer of the season-end review: the work of the season that ended (<see cref="PreviousItemId"/>, null for a plan-only work picked), the copy
/// it made (<see cref="NewItemId"/>, null when it was not carried), what was said (<c>schedule</c>, <c>mine</c>, <c>skip</c>, <c>planonly</c>) and whether the farmer answered it
/// (<see cref="Answered"/> false = it was carried as written).
/// </summary>
public sealed record OwnScheduleSeasonCarryDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid FromCropCycleId,
    Guid CropCycleId,
    string TaskKey,
    Guid? PreviousItemId,
    Guid? NewItemId,
    string Choice,
    bool Answered,
    int? RecordedStoredDay,
    DateTime DecidedAtUtc);

/// <summary>spec: plr-d10 schedule slice 3 - one save or removal of one own work, as the server keeps it (append-only). <see cref="Action"/> is <c>saved</c> or <c>removed</c>.</summary>
public sealed record OwnScheduleItemRevisionDto(
    Guid Id,
    Guid ItemId,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string TaskKey,
    int RevisionNumber,
    string Action,
    string State,
    System.Text.Json.JsonElement Task,
    string ContentHash,
    Guid ByUserId,
    DateTime AtUtc);

/// <summary>
/// spec: plr-d10 schedule slice 3 - one work of a plot-season's own schedule as the server holds it now: the phone's server cache (P10: the server is the truth;
/// the phone's queued saves are intent until applied). <see cref="Task"/> is the canonical task JSON; <see cref="State"/> is <c>active</c> or <c>removed</c>;
/// <see cref="MainVersionId"/> is the version the season's works were last frozen into by "हेच मुख्य करा" (null while it is only being built).
/// </summary>
public sealed record OwnScheduleItemDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid CropCycleId,
    string TaskKey,
    int Revision,
    string State,
    System.Text.Json.JsonElement Task,
    string ContentHash,
    string? Origin,
    Guid? MainVersionId,
    DateTime UpdatedAtUtc);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1) - the pull's <c>capabilities</c>: one key per capability, each present only when it
/// has something to say. A later slice adds a key beside <see cref="ScheduleMechanism"/>; a phone ignores a key it does not know.
/// </summary>
public sealed record SyncCapabilitiesDto(
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    ScheduleMechanismCapabilityDto? ScheduleMechanism = null);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 1) - the farms of this pull (the ones this person reads) the <c>schedule_mechanism</c>
/// switch is on for, by id, in a stable order. A farm not listed is off. Never lists a farm this caller does not read.
/// </summary>
public sealed record ScheduleMechanismCapabilityDto(IReadOnlyList<Guid> FarmIds);

/// <summary>spec: plr-d10 lane L8b-3 - the मुख्य schedule of one plot-season: the subscription (an Active row) the stage line follows.</summary>
public sealed record PlotMainScheduleDto(Guid PlotId, Guid CropCycleId, Guid SubscriptionId);

/// <summary>
/// spec: plr-d10 pilot lane PERM (contract §3.3 S3) — the reader-specific, name-free "who sees this" of one farm, for the saved screen's read-only line.
/// <see cref="Work"/>: the other live seats that would see a work record THIS reader makes; <see cref="Attendance"/>: the seats that see हजेरी;
/// <see cref="Money"/>: the seats that see money (none while the farm's money is private). The registrant is implied (always first) and the reader
/// himself is never listed. Built from real seats only (P4).
/// </summary>
public sealed record SeenByDto(
    IReadOnlyList<SeenByEntryDto> Work,
    IReadOnlyList<SeenByEntryDto> Attendance,
    IReadOnlyList<SeenByEntryDto> Money);

/// <summary>
/// pilot lane PERM — one seat kind in <see cref="SeenByDto"/>: its label (<c>CoOwner</c> / <c>Family</c> / <c>Mukadam</c> / <c>Worker</c>), else its
/// role (<c>SecondaryOwner</c> / <c>Mukadam</c> / <c>Worker</c>), never guessed (D-8); and, for a seat on chosen plots only, those plots (left out for a
/// seat on every plot).
/// </summary>
public sealed record SeenByEntryDto(
    string Who,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<Guid>? PlotIds = null);

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
    bool? SeeAllTasks = null,
    // spec: plr-d10 repair D-177 (founder 27 Nov, B1.4) - the FARM's own-bill switch: true when its primary owner allowed a person who checks money
    // to approve a bill he made himself. Written ONLY when true: off (the default for every farm) is no key at all, so an old phone's bytes are
    // unchanged and it keeps the stricter behaviour (P11). A not-readable entry carries none. The server decides again when an approval arrives.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? ReviewerMayApproveOwnBill = null,
    // spec: plr-d10 pilot lane PERM (founder 27 Nov follow-up 2) - the FARM's "पैशांच्या नोंदी फक्त मला दिसू दे": true while its registrant has it on.
    // Written ONLY when on: off (every farm's default) is no key at all, so an old phone's bytes are unchanged (P11). A not-readable entry carries none.
    // The server stamps each NEW money record when it arrives; the phone only shows the line and its waiting state.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    bool? MoneyPrivate = null,
    // spec: plr-d10 pilot lane PERM (founder 27 Nov "kinds of work he may record") - the kinds of work THIS reader may record on this farm, in the
    // contract's order (sync-contract/schemas/work-kinds.json). Written ONLY when his seat is limited: absent = every kind (every seat today, and every
    // older server), so an old phone's bytes are unchanged (P11). A not-readable entry carries none. The server decides again on every write.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    IReadOnlyList<string>? WorkKinds = null,
    // spec: plr-d10 pilot lane PERM (contract S3; founder 27 Nov: the saved screen's read-only "हे दिसतं: मालक, मुकादम") - who besides the farm's
    // registrant (implied) and this reader would see a work record he makes, who sees हजेरी and who sees money, as seat labels only (no name, no id,
    // no count). Written ONLY for a phone that asks (seenBy=1): every other pull is byte-for-byte as before (P11). A not-readable entry carries none.
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    SeenByDto? SeenBy = null)
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
