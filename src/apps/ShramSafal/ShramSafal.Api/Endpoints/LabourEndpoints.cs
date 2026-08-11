using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Application.UseCases.Labour.GetFieldOperators;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Application.UseCases.Labour.RenameFieldOperator;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Task 1.3 (spec: 2026-07-13-labour-attendance-approval-design) — thin HTTP
/// wiring for the Task 1.2 <see cref="GetLabourDataHandler"/> read-model.
/// </summary>
public static class LabourEndpoints
{
    public static RouteGroupBuilder MapLabourEndpoints(this RouteGroupBuilder group)
    {
        // Self-authorizing farm-scoped read — mirrors AiEndpoints.HandleVoiceParseAsync
        // (ICallerFarmTenantScope.EstablishForCallerAsync is the SOLE authorization
        // gate: admin-elevate, then confirm the caller is a member/owner of farmId
        // and set the single-farm GUCs, or Forbidden with no farm_id GUC ever set).
        //
        // NOT added to TenantTransactionMiddleware.SkipPathPrefixes (unlike
        // /shramsafal/farms/mine). CallerFarmTenantScope does NOT open its own
        // transaction — its sequential set_config(..., is_local: true) calls rely
        // entirely on the ambient per-request transaction TenantTransactionMiddleware
        // opens for NON-skip-listed routes (RunPipelineInTransactionsAsync). Skip-
        // listing this path would make the middleware admin-elevate WITHOUT opening
        // that transaction (see the /shramsafal/farms/mine skip entry + its
        // GetMyFarmsAsync comment, which opens its OWN transaction specifically
        // because it IS skip-listed) — each set_config would then land in its own
        // auto-commit transaction and the user_id GUC set in EstablishForCallerAsync
        // step 3 would never survive to the step 4 membership read. This exactly
        // mirrors why /shramsafal/ai/voice-parse, /ai/receipt-extract, /ai/patti-
        // extract, /ai/cove-reverify, and /ai/document-sessions/* are ALSO absent
        // from the skip list — every CallerFarmTenantScope consumer needs the
        // ambient transaction, not admin-elevate-without-a-transaction.
        group.MapGet("/farms/{farmId:guid}/labour", async Task<IResult> (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<GetLabourDataQuery, LabourDataDto> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var result = await handler.HandleAsync(
                new GetLabourDataQuery(new FarmId(farmId), new UserId(userId)),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetLabourData")
        .RequireAuthorization();

        // ── Task 11 (spec: 2026-07-13-labour-attendance-approval-design) —
        // Field Operator identity commands + list read. Every route below is
        // farm-scoped (`/farms/{farmId:guid}/labour/field-operators...`) for
        // the SAME reason as GetLabourData above: ICallerFarmTenantScope.
        // EstablishForCallerAsync is the sole authorization gate on this
        // endpoint group and it is what sets the agrisync.farm_id GUC — a
        // route with no farmId in the path cannot set it. None of these are
        // added to TenantTransactionMiddleware.SkipPathPrefixes, for the
        // exact reason documented in the banner above.

        group.MapPost("/farms/{farmId:guid}/labour/field-operators", async Task<IResult> (
            Guid farmId,
            CreateFieldOperatorRequest request,
            ClaimsPrincipal user,
            IHandler<CreateFieldOperatorCommand, FieldOperatorDto> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var command = new CreateFieldOperatorCommand(
                new FarmId(farmId), request.DisplayName, request.FullName, new UserId(userId));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/farms/{farmId}/labour/field-operators/{result.Value!.Id}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CreateFieldOperator")
        .RequireAuthorization();

        group.MapPost("/farms/{farmId:guid}/labour/field-operators/{id:guid}/attach", async Task<IResult> (
            Guid farmId,
            Guid id,
            AttachFieldOperatorRequest request,
            ClaimsPrincipal user,
            IHandler<AttachFieldOperatorCommand, AttachFieldOperatorResult> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var command = new AttachFieldOperatorCommand(
                new FarmId(farmId), id, request.LabourAssignmentId, new UserId(userId));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AttachFieldOperator")
        .RequireAuthorization();

        group.MapPatch("/farms/{farmId:guid}/labour/field-operators/{id:guid}", async Task<IResult> (
            Guid farmId,
            Guid id,
            RenameFieldOperatorRequest request,
            ClaimsPrincipal user,
            IHandler<RenameFieldOperatorCommand, FieldOperatorDto> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var command = new RenameFieldOperatorCommand(
                new FarmId(farmId), id, request.DisplayName, new UserId(userId));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("RenameFieldOperator")
        .RequireAuthorization();

        // Task 12 (spec: 2026-07-13-labour-attendance-approval-design) — the
        // field-operator read PATH proper, via GetFieldOperatorsHandler.
        // Replaces Task 11's direct-repo-read minimum wiring ("Task 12 owns
        // the field-operator read PATH proper" — the comment this route used
        // to carry). Same authorization shape as every other route in this
        // group: EstablishForCallerAsync is the sole gate.
        group.MapGet("/farms/{farmId:guid}/labour/field-operators", async Task<IResult> (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<GetFieldOperatorsQuery, IReadOnlyList<FieldOperatorSummaryDto>> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var result = await handler.HandleAsync(
                new GetFieldOperatorsQuery(new FarmId(farmId), new UserId(userId)),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFieldOperatorsForFarm")
        .RequireAuthorization();

        return group;
    }

    /// <summary>
    /// Mirrors AiEndpoints.ToErrorResult — Forbidden/Unauthenticated keep the
    /// {error, message} body (off which farmer-facing UI renders the right
    /// Marathi message) rather than Results.Forbid()'s empty body.
    /// </summary>
    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Validation => Results.BadRequest(body),
            _ => Results.BadRequest(body),
        };
    }
}

/// <summary>Task 11 — POST /farms/{farmId}/labour/field-operators body.</summary>
public sealed record CreateFieldOperatorRequest(string DisplayName, string? FullName);

/// <summary>Task 11 — POST /farms/{farmId}/labour/field-operators/{id}/attach body.</summary>
public sealed record AttachFieldOperatorRequest(Guid LabourAssignmentId);

/// <summary>Task 11 — PATCH /farms/{farmId}/labour/field-operators/{id} body.</summary>
public sealed record RenameFieldOperatorRequest(string DisplayName);
