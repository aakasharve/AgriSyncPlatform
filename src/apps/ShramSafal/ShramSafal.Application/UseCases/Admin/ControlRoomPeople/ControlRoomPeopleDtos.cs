// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using ShramSafal.Application.Contracts.Dtos;

namespace ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

/// <summary>
/// One row of the People page. The founder row has no <see cref="PersonId"/>, every tick and no actions.
/// <see cref="Phone"/> is the ten digits as stored.
/// </summary>
public sealed record PersonDto(
    Guid? PersonId,
    bool IsFounder,
    string DisplayName,
    string Phone,
    string StartingRole,
    IReadOnlyList<string> Ticks,
    string? BoundAccountName,
    DateTime? LastSignedInUtc,
    DateTime? KeptAtUtc);

public sealed record TickInfoDto(string Key, bool IsPersonalData);

public sealed record PeopleAnswerDto(
    IReadOnlyList<PersonDto> People,
    IReadOnlyList<TickInfoDto> Ticks,
    IReadOnlyDictionary<string, IReadOnlyList<string>> Presets);

public sealed record HistoryLineDto(
    DateTime AtUtc,
    string Action,
    string ActorName,
    string? SubjectName,
    IReadOnlyDictionary<string, string?> Details);

public sealed record HistoryAnswerDto(IReadOnlyList<HistoryLineDto> Lines, bool HitLimit, int Limit);

/// <summary>Every count is a value or the reason it is not measured (P4); never both, never a made-up zero.</summary>
public sealed record TrustReportDto(
    DateTime CountedAtUtc,
    int PeopleWithAccess,
    IReadOnlyDictionary<string, int> PeopleByRole,
    MisValueDto PhoneLooks,
    MisValueDto PhoneFarms,
    MisValueDto PhoneLookers,
    MisValueDto Downloads,
    MisValueDto DownloadFarmRows,
    MisValueDto Downloaders,
    IReadOnlyList<PersonDto> NotSignedIn30Days,
    string? NotSignedInNotMeasuredReason,
    MisValueDto RefusedAtDoor);

// K11: the route adds the audit fields (the request's device and IP hash) to each request to make the command.
public sealed record AddPersonRequest(string? DisplayName, string? Phone, string? StartingRole, string[]? Ticks);

public sealed record ChangePersonRequest(string? DisplayName, string? StartingRole, string[]? Ticks);

public sealed record AddPersonCommand(
    Guid ActorId, string? DisplayName, string? Phone, string? StartingRole, string[]? Ticks,
    string AuditDeviceId, string AuditIpHash);

public sealed record ChangePersonCommand(
    Guid ActorId, Guid PersonId, string? DisplayName, string? StartingRole, string[]? Ticks,
    string AuditDeviceId, string AuditIpHash);

public sealed record RemovePersonCommand(Guid ActorId, Guid PersonId, string AuditDeviceId, string AuditIpHash);

public sealed record KeepPersonCommand(Guid ActorId, Guid PersonId, string AuditDeviceId, string AuditIpHash);

public static class ControlRoomPeopleCodes
{
    public const string PhoneInvalid = "control_room.phone_invalid";
    public const string AlreadyListed = "control_room.already_listed";
    public const string AlreadyFounder = "control_room.already_founder";
    public const string RoleNotAllowed = "control_room.role_not_allowed";
    public const string TickUnknown = "control_room.tick_unknown";
    public const string NameInvalid = "control_room.name_invalid";
    public const string PersonNotFound = "control_room.person_not_found";
    public const string RangeInvalid = "control_room.history_range_invalid";
    public const string ActionUnknown = "control_room.history_action_unknown";
    public const string FounderOnly = "control_room.founder_only";
}
