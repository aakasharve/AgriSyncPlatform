using System.Text.Json.Serialization;

namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FarmsListDto(
    IReadOnlyList<FarmSummaryDto> Items,
    int TotalCount,
    int Page,
    int PageSize)
{
    /// <summary>
    /// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, C32). Server-side only, never sent: set by the
    /// repository when the list could not be built as asked, with <see cref="Items"/> empty: the tier filter needs
    /// every farm's checked days, and the platform is above the live-count ceiling
    /// (<c>GetFarmsListHandler.TierFilterTooManyFarmsCode</c>) or a farm could not be read
    /// (<c>GetFarmsListHandler.TierFilterNotMeasuredCode</c>, C33). The handler answers it as a 409 refusal, never as an
    /// empty list.
    /// </summary>
    [JsonIgnore]
    public string? RefusalCode { get; init; }
}

/// <summary>
/// One farm on All Farms. <see cref="Wvfd7d"/> is the farm's checked days in the last complete India week (at most 7),
/// <see cref="SelfOnlyDays7d"/> its self-only days that week (shown apart, never added in), and
/// <see cref="EngagementTier"/> its tier by checked days, all by <c>ConfirmedFarmDays</c> (plan CR-2e, C32). All three
/// are null when the farm saved no counted entry that week ("No entry last week", never tier D, never 0), and then
/// <see cref="ConfirmedDaysNotMeasuredReason"/> is null. When the farm's rows could not be read (no owner account, or
/// its row did not come back under its own row-level security) all three are null and
/// <see cref="ConfirmedDaysNotMeasuredReason"/> is <c>"farm_unreadable"</c> ("not measured", never "No entry last
/// week"); the rest of the page answers normally (C33). When the farm is owned by a test account
/// (<c>CompanyMis:ExcludedUserIds</c>) all three are null and the reason is <c>"test_account"</c> ("Test account, not
/// counted", C35 1).
/// </summary>
public sealed record FarmSummaryDto(
    Guid FarmId,
    string Name,
    string OwnerPhone,
    // spec: company-mis-real-numbers-2026-11-15 — always null: the farm list no longer sends a made-up plan.
    string? Plan,
    decimal? Wvfd7d,
    int? SelfOnlyDays7d,
    string? EngagementTier,
    string? ConfirmedDaysNotMeasuredReason,
    int Errors24h,
    DateTime? LastLogAt,
    DateTime CreatedAt);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4, C10, C26). The farms with no entry for 7 or more
/// India days, or none ever, as of the India day of <see cref="CountedAtUtc"/>, counted live from the same rows and
/// by the same age rule as Company MIS Retention, so the list counted by band equals its band numbers for a range
/// ending today. Farms owned by a test account are left out.
/// <para><see cref="NotMeasuredReason"/> is null when the list is real (an empty <see cref="Farms"/> is then a real
/// "none"). Otherwise <see cref="Farms"/> is empty and the reason is <c>"farm_list_unreadable"</c> (a farm could not
/// be read, so the list would be partial) or <c>"too_many_farms_for_live_count"</c> (above the live-count ceiling,
/// nothing per farm was read).</para>
/// </summary>
public sealed record SilentFarmsDto(
    DateTime CountedAtUtc,
    IReadOnlyList<SilentFarmDto> Farms,
    string? NotMeasuredReason);

/// <summary>
/// One silent farm. <see cref="Band"/> is <c>"7-13"</c>, <c>"14-29"</c>, <c>"30+"</c> or <c>"never"</c> (never
/// logged). <see cref="DaysSilent"/> is India days since the last entry (null for <c>"never"</c>);
/// <see cref="LastEntryUtc"/> the last entry of all time, test accounts left out (null for <c>"never"</c>).
/// <see cref="OwnerPhone"/> is null when none is on record. The plan is the owner account's subscription
/// (<see cref="PlanStatus"/>: 1 trialing, 2 active, 3 past due, 4 expired, 5 cancelled, 6 suspended); both plan
/// fields are null when the account has no subscription ("No plan recorded"), never a made-up plan.
/// </summary>
public sealed record SilentFarmDto(
    Guid FarmId,
    string Name,
    string? OwnerPhone,
    string Band,
    int? DaysSilent,
    DateTime? LastEntryUtc,
    string? PlanCode,
    int? PlanStatus);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2). One farm with three or more problems in the
/// last 7 days on requests that named the farm. ProblemCount is every problem; the four area counts split that
/// same total (ProblemArea). No name: names come from <c>GET /shramsafal/admin/farms/contacts</c>.
/// </summary>
public sealed record SufferingItemDto(
    Guid FarmId,
    int ProblemCount,
    int SyncProblems,
    int EntryProblems,
    int VoiceProblems,
    int OtherProblems,
    DateTime LastProblemAt);

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1). A farm's name and its owner's phone (null when
/// none is on record). OwnerAccountId is for server use (plans); the contacts route does not send it.
/// </summary>
public sealed record FarmContactDto(Guid FarmId, string Name, string? OwnerPhone, Guid OwnerAccountId);
