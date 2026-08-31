using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Application.UseCases.Compliance.GetComplianceSignalsForFarm;
using ShramSafal.Application.UseCases.Compliance.ResolveSignal;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 3 §4.6 — HTTP surface for compliance signals.
/// </summary>
public static class ComplianceEndpoints
{
    private static readonly HashSet<AppRole> EvaluateAllowedRoles =
    [
        AppRole.PrimaryOwner,
        AppRole.Agronomist,
        AppRole.Consultant,
        AppRole.FpcTechnicalManager
    ];

    public static RouteGroupBuilder MapComplianceEndpoints(this RouteGroupBuilder group)
    {
        // GET /farms/{farmId}/compliance — list signals for a farm
        group.MapGet("/farms/{farmId:guid}/compliance", async (
            Guid farmId,
            bool? includeResolved,
            bool? includeAcknowledged,
            ClaimsPrincipal user,
            GetComplianceSignalsForFarmHandler handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var readerUserId))
                return Results.Unauthorized();

            // ssf.compliance_signals has RLS ENABLED and FORCED. This route is
            // neither skip-listed nor farm-claimed, so nothing had ever set
            // agrisync.farm_id before the read and the very first DbCommand
            // fail-closed in TenantConnectionInterceptor ("no tenant claim set
            // and not in admin scope") → HTTP 500. Same gate the labour and
            // voice read paths use: prove membership, then set the single-farm
            // GUCs, or Forbidden with no GUC ever set.
            var readScope = await scope.EstablishForCallerAsync(farmId, readerUserId, ct);
            if (!readScope.IsSuccess)
                return ToErrorResult(readScope.Error);

            var query = new GetComplianceSignalsForFarmQuery(
                FarmId: new FarmId(farmId),
                IncludeResolved: includeResolved ?? false,
                IncludeAcknowledged: includeAcknowledged ?? false);

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("GetComplianceSignalsForFarm");

        // POST /compliance/{signalId}/acknowledge
        group.MapPost("/compliance/{signalId:guid}/acknowledge", async (
            Guid signalId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<AcknowledgeSignalCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AcknowledgeSignalCommand(
                SignalId: signalId,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("AcknowledgeComplianceSignal");

        // POST /compliance/{signalId}/resolve
        group.MapPost("/compliance/{signalId:guid}/resolve", async (
            Guid signalId,
            ResolveSignalRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<ResolveSignalCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new ResolveSignalCommand(
                SignalId: signalId,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                Note: request.Note ?? string.Empty,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("ResolveComplianceSignal");

        // POST /compliance/evaluate/{farmId} → 202 Accepted
        group.MapPost("/compliance/evaluate/{farmId:guid}", async (
            Guid farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<EvaluateComplianceCommand, EvaluateComplianceResult> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // The role comes from the JWT `membership` claim. That claim used to
            // be MISSING from every password-login token: public.memberships is
            // FORCE-RLS keyed on agrisync.user_id, the whole /user/auth surface
            // is admin-elevated (no GUC), so the auto-included membership join
            // matched nothing and GetActorRoleEnum fell back to AppRole.Worker —
            // 403 for the farm's own PrimaryOwner. Fixed in UserRepository.
            var callerRole = EndpointActorContext.GetActorRoleEnum(user);
            if (!EvaluateAllowedRoles.Contains(callerRole))
                return Results.Forbid();

            // EvaluateComplianceHandler reads ssf.plots / daily_logs /
            // crop_cycles / test_instances and WRITES ssf.compliance_signals +
            // ssf.audit_events — all RLS ENABLED and FORCED. This route is
            // neither skip-listed nor farm-claimed, so without this gate the
            // first DbCommand fail-closed in TenantConnectionInterceptor (500)
            // and, had it not, the compliance_signals INSERT would have been
            // rejected by the policy's WITH CHECK on farm_id.
            var evaluateScope = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!evaluateScope.IsSuccess)
                return ToErrorResult(evaluateScope.Error);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent rows emitted per signal.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new EvaluateComplianceCommand(
                FarmId: new FarmId(farmId),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);
            var result = await handler.HandleAsync(command, ct);

            return result.IsSuccess
                ? Results.Accepted(null, new
                {
                    opened = result.Value!.Opened,
                    refreshed = result.Value.Refreshed,
                    autoResolved = result.Value.AutoResolved
                })
                : ToErrorResult(result.Error);
        })
        .WithName("EvaluateCompliance");

        return group;
    }

    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error)
    {
        if (error.Code.EndsWith("RoleNotAllowed", StringComparison.Ordinal) ||
            error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring
    // the helper used in other endpoint files (ScheduleEndpoints,
    // FarmEndpoints, etc.).
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

// ------------------------------------------------------------------- request DTOs
public sealed record ResolveSignalRequest(string? Note);
