using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.UseCases.Tests.WaiveTestInstance;

/// <summary>
/// Transition a <see cref="ShramSafal.Domain.Tests.TestInstance"/> from
/// <c>Due</c> or <c>Overdue</c> to <c>Waived</c>. Allowed roles:
/// PrimaryOwner, Agronomist. Requires a non-empty reason. See CEI §4.5.
/// </summary>
public sealed record WaiveTestInstanceCommand(
    Guid TestInstanceId,
    string Reason,
    UserId CallerUserId,
    AppRole CallerRole,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the endpoint's HttpContext.AuditClaims() + X-App-Version
    // header. Defaults match the worker / unknown path so direct-construction
    // unit tests stay green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
