using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

public sealed record EditScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    /// <summary>
    /// The highest AppRole the caller holds on any active farm membership.
    /// Supplied by the API layer from the authenticated JWT/session.
    /// </summary>
    AppRole CallerRole,
    string? NewName,
    string? NewStage,
    string? ClientCommandId,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown",
    // lane 2b — the farm whose seat authorises a Team / Licensed write (schedule templates).
    Guid? FarmId = null,
    // spec: plr-d10 lane SCH-OWN (D7) — the stages and works of a farm's own schedule, written WHOLE as the next version. Stages given: the
    // version is exactly these stages and exactly these works (none given = none; nothing is carried over silently). Works without stages are
    // refused. Neither given: the old rename (P11). Each item is the phone's own shape.
    IReadOnlyList<EditScheduleStageInput>? Stages = null,
    IReadOnlyList<EditScheduleActivityInput>? Activities = null);

/// <summary>One stage of an edit that writes the version whole (spec: plr-d10 lane SCH-OWN).</summary>
public sealed record EditScheduleStageInput(string Name, int StartDay, int EndDay);

/// <summary>
/// One work of an edit that writes the version whole (spec: plr-d10 lane SCH-OWN). <c>Part</c> is irrigation | nutrition | spray | work;
/// <c>FrequencyMode</c> is one_time | every_n_days | per_week.
/// </summary>
public sealed record EditScheduleActivityInput(
    string Name,
    string Part,
    string? OperationKey,
    int StartDay,
    int EndDay,
    string FrequencyMode,
    int IntervalDays);
