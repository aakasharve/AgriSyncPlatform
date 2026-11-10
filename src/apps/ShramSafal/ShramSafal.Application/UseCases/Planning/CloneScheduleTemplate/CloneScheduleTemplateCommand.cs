using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

public sealed record CloneScheduleTemplateCommand(
    Guid SourceTemplateId,
    Guid NewTemplateId,
    Guid CallerUserId,
    /// <summary>
    /// The highest AppRole the caller holds on any active farm membership.
    /// Supplied by the API layer from the authenticated JWT/session.
    /// </summary>
    AppRole CallerRole,
    TenantScope NewScope,
    string Reason,
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
    // spec: plr-d10 lane SCH-OWN (D-82 = 3; D4, D5) — true: copy a CHECKED Public schedule INTO the farm's own schedule (FarmId required,
    // NewScope Team): the copy names that farm and stores the source's days; OwnScheduleGate decides who may. False: a plain copy, as before.
    bool IntoFarmOwn = false);
