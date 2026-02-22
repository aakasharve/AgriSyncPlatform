using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;

namespace ShramSafal.Api.Endpoints;

public static class AiEndpoints
{
    public static RouteGroupBuilder MapAiEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/ai/parse-voice", async (
            ParseVoiceInputRequest request,
            ParseVoiceInputHandler handler,
            CancellationToken ct) =>
        {
            var command = new ParseVoiceInputCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.TextTranscript,
                request.AudioBase64,
                request.AudioMimeType);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ParseVoiceInput")
        .RequireAuthorization();

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record ParseVoiceInputRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string? TextTranscript,
    string? AudioBase64,
    string? AudioMimeType);
