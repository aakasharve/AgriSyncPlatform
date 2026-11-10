using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;

/// <summary>
/// spec: plr-d10 lane SCH-OWN (Task 3; founder D-74, D-82 = 3) - "start blank": make his OWN schedule, empty, for a crop the farm grows.
/// The id is made on the phone (a re-sent request is the same schedule); the farm is named (it decides who may; its OWNER is whose the schedule is -
/// SCH-OWN-c, D-137 Q9 = 1: the owner owns a holder-typed schedule, the version names the typist); the caller is always the authenticated user.
/// The four made-for tags (SCH-OWN-c, Q10 = 1) are optional list codes in the phone's own shape; the handler builds the record.
/// </summary>
public sealed record CreateOwnScheduleCommand(
    Guid ScheduleTemplateId,
    Guid FarmId,
    string CropKey,
    string Name,
    Guid CallerUserId,
    AppRole CallerRole,
    string? ClientCommandId,
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    string? Variety = null,
    string? SoilType = null,
    string? Region = null,
    string? Climate = null);
