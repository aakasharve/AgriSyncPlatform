// spec: correctionevent-server-persistence
using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http.HttpResults;
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
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
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
