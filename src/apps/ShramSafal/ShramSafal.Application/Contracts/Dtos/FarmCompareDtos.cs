namespace ShramSafal.Application.Contracts.Dtos;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2; D-68, D-83 = 1, D-86 note / R33, R34, R12, R10, R28, P4, P11)

/// <summary>
/// What the farm's तुलना says, worked out on the server by the one engine (<c>ScheduleFollowEngine</c>): per plot, what every schedule
/// the plot follows ASKED, what was DONE, what is NOT YET, what he said he did NOT do and what he did MORE THAN asked, STAGE by stage,
/// plus the plot's own work. The phone only draws it (thin client). There is no amber, no partial and no "day changed" field (R33):
/// a record is yes or no. No quantity and no dose is compared (P4). Primary owner or "तुलना पाहणे" only (CMP-D1).
/// </summary>
public sealed record FarmCompareDto(
    DateTime ServerTimeUtc,
    IReadOnlyList<PlotCompareDto> Plots,
    RecogniserVersionsDto RecogniserVersions);

/// <summary>The two tables the sameness of work rests on (so the screen and a later correction can cite them).</summary>
public sealed record RecogniserVersionsDto(string Vocabulary, string Catalog);

/// <summary>
/// One plot's current season. <see cref="Day"/> is today minus the मुख्य schedule's day 0 (else the season start); <see cref="TotalDays"/> is
/// the last stage's end on that count, null when the मुख्य schedule stores no stages. After the trial with nothing followed NOTHING is counted
/// (no stages, no schedules, no lists: an ask is the phone's and the pull's planning state, D-83 = 1 - तुलना never names the gate).
/// <see cref="InTrial"/> true = only today's stage is counted (R10).
/// </summary>
public sealed record PlotCompareDto(
    Guid PlotId,
    Guid CropCycleId,
    bool InTrial,
    int Day,
    int? TotalDays,
    IReadOnlyList<CompareStageDto> Stages,
    IReadOnlyList<ScheduleCompareDto> Schedules,
    IReadOnlyList<OwnWorkDto> OwnWork,
    IReadOnlyList<NotRecognisedDto> NotRecognised);

/// <summary>One stage of the मुख्य schedule: <c>passed | current | ahead</c>, its days on the plot's count, and the days left (current only).</summary>
public sealed record CompareStageDto(string Name, string State, int StartDay, int EndDay, int? DaysLeft);

/// <summary>
/// One followed schedule. <see cref="Stages"/> lines up with the plot's stages one for one; an entry is <c>null</c> when that stage carries no
/// numbers (an ahead stage, P4; any stage but today's in the trial, R10; every stage when nothing is followed or the मुख्य schedule stores no stages).
/// <see cref="Check"/> is null for his own schedule (D-82 = 3).
/// </summary>
public sealed record ScheduleCompareDto(
    Guid SubscriptionId,
    Guid TemplateId,
    string Name,
    ScheduleCheckDto? Check,
    short? Slot,
    string Origin,
    bool IsMain,
    IReadOnlyList<StageCompareCountsDto?> Stages,
    IReadOnlyList<OrderNoteDto> Order);

/// <summary>
/// One schedule's numbers in one stage. <see cref="Asked"/> / <see cref="NotYet"/> / <see cref="Done"/> total ONLY the works whose days the schedule
/// stores (null = none does); <see cref="SaidNotDone"/> and <see cref="MoreThanAsked"/> total every work.
/// </summary>
public sealed record StageCompareCountsDto(
    int? Asked,
    int? Done,
    int? NotYet,
    int SaidNotDone,
    int MoreThanAsked,
    IReadOnlyList<ComparePartDto> Parts);

/// <summary>The works of one part: <c>irrigation | nutrition | spray | work</c>.</summary>
public sealed record ComparePartDto(string Part, IReadOnlyList<CompareItemDto> Items);

/// <summary><see cref="Asked"/> / <see cref="NotYet"/> are null when the schedule does not store this work's days (words only).</summary>
public sealed record CompareItemDto(
    Guid ActivityId,
    string Title,
    int? Asked,
    int Done,
    int? NotYet,
    int SaidNotDone,
    int MoreThanAsked);

/// <summary>
/// The schedule stores that <see cref="FirstTitle"/> comes before <see cref="ThenTitle"/>, and the later work was done first (or alone). The titles are the
/// SCHEDULE's words, never a record's. The days are on the plot's count. Left out entirely for a reader who may not see one or both records (R34).
/// </summary>
public sealed record OrderNoteDto(string FirstTitle, string ThenTitle, int? FirstDay, int ThenDay);

/// <summary>
/// A record of work none of the plot's schedules asks in that stage ("तुमचं स्वतःचं काम"). <see cref="Title"/> and <see cref="MatchedWords"/> are the record's
/// own words, withheld (null / empty) from a reader who may not hear the words of a record that states money (D-66). <see cref="Reason"/> is CMP-D3's: the
/// reason kept on this item of this record ("का केलं"), null when none was kept.
/// </summary>
public sealed record OwnWorkDto(
    Guid DailyLogId,
    string WorkKey,
    int Day,
    string StageName,
    string Part,
    string? Title,
    IReadOnlyList<string> MatchedWords,
    LogReasonDto? Reason);

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 (D-68 round 2; D-66 / D-69). The reason kept on one item of one record: its
/// <see cref="Kind"/> (always given: <c>Practice | Extra | Weather</c>) and his <see cref="Words"/>, which are null when he said none, when erasure
/// removed them, or when this reader may not hear them (the record states money and he does not hear wages, or the words state it themselves).
/// <see cref="SaidByVoice"/> is true only with words from the mic.
/// </summary>
public sealed record LogReasonDto(string Kind, string? Words, bool SaidByVoice);

/// <summary>A record the work recogniser could not read (R12): told neutrally, never counted as anything else.</summary>
public sealed record NotRecognisedDto(Guid DailyLogId, string WorkKey, int Day, string StageName, string? Title);
