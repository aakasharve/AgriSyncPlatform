using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;

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
