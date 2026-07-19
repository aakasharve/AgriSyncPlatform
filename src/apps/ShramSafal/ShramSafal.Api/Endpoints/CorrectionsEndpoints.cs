// spec: correctionevent-server-persistence
// spec: dfes-companion-2026-07-11 — tenant-scope prelude fix.
using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http.HttpResults;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Corrections;
using ShramSafal.Domain.Corrections;

namespace ShramSafal.Api.Endpoints;

public static class CorrectionsEndpoints
{
    public static RouteGroupBuilder MapCorrectionsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/corrections", HandleRecordCorrectionAsync)
            .WithName("RecordCorrectionEvent")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleRecordCorrectionAsync(
        RecordCorrectionRequest request,
        ClaimsPrincipal user,
        IRecordCorrectionEventHandler handler,
        ICallerUserTenantScope scope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        // spec: dfes-companion-2026-07-11 — establish the user-scoped tenant
        // claim (agrisync.user_id GUC) BEFORE the handler's first DbCommand.
        // ssf.correction_events' RLS policy p_user_correction_events
        // (20260517010000_AddDeferredAuditRls) is keyed entirely on that GUC;
        // without this prelude the write fail-closes in
        // TenantConnectionInterceptor ("no tenant claim set and not in admin
        // scope") exactly as founder testing hit on 2026-07-19. See
        // ICallerUserTenantScope for why this is a distinct, farm-less port
        // from the DFES endpoints' ICallerFarmTenantScope.
        var scopeResult = await scope.EstablishForCallerAsync(userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return Results.BadRequest(new
            {
                error = scopeResult.Error?.Code,
                description = scopeResult.Error?.Description,
            });
        }

        var command = new RecordCorrectionEventCommand(
            userId,
            request.OriginalParseId,
            request.OriginalParseRaw,
            request.CorrectedParse,
            request.PromptVersion,
            request.Locale ?? "mr-IN",
            request.Trigger);

        var result = await handler.HandleAsync(command, ct);
        return result.IsSuccess
            ? Results.Created($"/shramsafal/corrections/{result.Value}", result.Value)
            : Results.BadRequest(new { error = result.Error?.Code, description = result.Error?.Description });
    }
}

/// <summary>Request body for POST /corrections.</summary>
public sealed record RecordCorrectionRequest(
    Guid OriginalParseId,
    string OriginalParseRaw,
    string CorrectedParse,
    string PromptVersion,
    string? Locale,
    CorrectionTrigger Trigger);
