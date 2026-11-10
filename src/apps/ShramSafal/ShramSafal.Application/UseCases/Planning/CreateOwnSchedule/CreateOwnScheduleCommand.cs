using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;

/// <summary>
/// spec: plr-d10 lane SCH-OWN (Task 3; founder D-74, D-82 = 3) - "start blank": make the farm's OWN schedule, empty, for a crop the farm grows.
/// The id is made on the phone (a re-sent request is the same schedule); the farm is named (it decides who may, and whose it is); the
/// caller is always the authenticated user.
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
    string AuditIpHash = "sha256:unknown");
