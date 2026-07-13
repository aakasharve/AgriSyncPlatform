using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// DFES Phase 5 — D8 question-engine telemetry surface.
///   POST /shramsafal/question-events          → append one shown/answered row
///   GET  /shramsafal/question-events/recent    → cooldown / anti-repeat feed
/// Both require farm membership (enforced in the handlers; RLS scopes reads).
/// </summary>
public static class DfesQuestionEndpoints
{
    public static RouteGroupBuilder MapDfesQuestionEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/question-events", async (
            RecordQuestionEventRequest request,
            ClaimsPrincipal user,
            RecordQuestionEventHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var cmd = new RecordQuestionEventCommand(
                actorUserId, request.FarmId, request.PlotId, request.DailyLogId,
                request.QuestionKey, request.Crop, request.ExpectedStage, request.ActualStageApplicability,
                request.AnchorDateType, request.TriggerType, request.QuestionType, request.Lens,
                request.DepthLevel, request.Priority, request.Cooldown, request.AnswerModes, request.SafetyClass,
                request.AgronomistApproved, request.MarathiApproved, request.BankVersion, request.QuestionEngineVersion,
                request.AnswerObservationId, request.ShownAtUtc, request.TriggerReason, request.WeatherContext,
                request.Response, request.StageConfirmed, request.PhotoSubmitted, request.Skipped);

            var result = await handler.HandleAsync(cmd, ct);
            return result.IsSuccess ? Results.Ok(new { id = result.Value }) : ToErrorResult(result.Error);
        })
        .WithName("RecordDfesQuestionEvent");

        group.MapGet("/question-events/recent", async (
            Guid farmId, int? sinceDays,
            ClaimsPrincipal user,
            GetRecentQuestionEventsHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var result = await handler.HandleAsync(
                new GetRecentQuestionEventsQuery(actorUserId, farmId, sinceDays ?? 14), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetRecentDfesQuestionEvents");

        return group;
    }

    public sealed record RecordQuestionEventRequest(
        Guid FarmId, Guid? PlotId, Guid? DailyLogId,
        string QuestionKey, string Crop, string? ExpectedStage, string? ActualStageApplicability,
        string AnchorDateType, string TriggerType, string QuestionType, string Lens,
        int DepthLevel, int Priority, int Cooldown, string AnswerModes, string SafetyClass,
        bool AgronomistApproved, bool MarathiApproved, string BankVersion, string QuestionEngineVersion,
        Guid? AnswerObservationId, DateTime? ShownAtUtc, string? TriggerReason, string? WeatherContext,
        string? Response, bool? StageConfirmed, bool? PhotoSubmitted, bool? Skipped);

    private static IResult ToErrorResult(Error error) =>
        error.Code.Contains("NotFound") ? Results.NotFound(error.Description)
        : error.Code.Contains("Forbidden") ? Results.Forbid()
        : Results.BadRequest(error.Description);
}
