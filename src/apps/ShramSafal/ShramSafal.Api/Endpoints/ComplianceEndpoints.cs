using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
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
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
                return Results.Unauthorized();

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
            ClaimsPrincipal user,
            IHandler<AcknowledgeSignalCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new AcknowledgeSignalCommand(
                SignalId: signalId,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("AcknowledgeComplianceSignal");

        // POST /compliance/{signalId}/resolve
        group.MapPost("/compliance/{signalId:guid}/resolve", async (
            Guid signalId,
            ResolveSignalRequest request,
            ClaimsPrincipal user,
            IHandler<ResolveSignalCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new ResolveSignalCommand(
                SignalId: signalId,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                Note: request.Note ?? string.Empty);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("ResolveComplianceSignal");

        // POST /compliance/evaluate/{farmId} → 202 Accepted
        group.MapPost("/compliance/evaluate/{farmId:guid}", async (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<EvaluateComplianceCommand, EvaluateComplianceResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
                return Results.Unauthorized();

            var callerRole = EndpointActorContext.GetActorRoleEnum(user);
            if (!EvaluateAllowedRoles.Contains(callerRole))
                return Results.Forbid();

            var command = new EvaluateComplianceCommand(new FarmId(farmId));
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
}

// ------------------------------------------------------------------- request DTOs
public sealed record ResolveSignalRequest(string? Note);
