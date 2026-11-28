using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Dfes.GetProductPurposes;
using ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// DFES Phase 5 — D8 question-engine telemetry surface.
///   POST /shramsafal/question-events          → append one shown/answered row
///   GET  /shramsafal/question-events/recent    → cooldown / anti-repeat feed
///   GET  /shramsafal/question-events/product-purposes?farmId&amp;dailyLogId → one record's products and what each was for (part 03 B4)
/// All three require farm membership (enforced in the handlers; RLS scopes reads).
/// </summary>
public static class DfesQuestionEndpoints
{
    public static RouteGroupBuilder MapDfesQuestionEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/question-events", async (
            RecordQuestionEventRequest request,
            ClaimsPrincipal user,
            RecordQuestionEventHandler handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // spec: dfes-companion-2026-07-11 — establish the membership-validated
            // single-farm tenant scope BEFORE the handler runs so the ssf.question_events
            // INSERT passes the farm_id WITH CHECK under prod FORCE-RLS (sets the
            // agrisync.farm_id GUC). Forged/non-member farmId → 403, no row written.
            var scopeResult = await scope.EstablishForCallerAsync(request.FarmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
                return ToErrorResult(scopeResult.Error);

            var cmd = new RecordQuestionEventCommand(
                actorUserId, request.FarmId, request.PlotId, request.DailyLogId,
                request.QuestionKey, request.Crop, request.ExpectedStage, request.ActualStageApplicability,
                request.AnchorDateType, request.TriggerType, request.QuestionType, request.Lens,
                request.DepthLevel, request.Priority, request.Cooldown, request.AnswerModes, request.SafetyClass,
                request.AgronomistApproved, request.MarathiApproved, request.BankVersion, request.QuestionEngineVersion,
                request.AnswerObservationId, request.ShownAtUtc, request.TriggerReason, request.WeatherContext,
                request.Response, request.StageConfirmed, request.PhotoSubmitted, request.Skipped,
                request.PromptText, request.PromptOrigin, request.LookLineIds, request.ScheduleCardRef,
                request.DeviationReasonCode, request.DeviationChallenge, request.PhotoAttachmentId,
                request.InputEventId, request.MixIndex, request.AnswerMode, request.AnswerCode);

            var result = await handler.HandleAsync(cmd, ct);
            return result.IsSuccess ? Results.Ok(new { id = result.Value }) : ToErrorResult(result.Error);
        })
        .WithName("RecordDfesQuestionEvent");

        group.MapGet("/question-events/recent", async (
            Guid farmId, int? sinceDays,
            ClaimsPrincipal user,
            GetRecentQuestionEventsHandler handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // spec: dfes-companion-2026-07-11 — establish the membership-validated
            // single-farm tenant scope BEFORE the handler's first DbCommand so the
            // cooldown-feed read passes under prod FORCE-RLS. Forged/non-member farmId → 403.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
                return ToErrorResult(scopeResult.Error);

            var result = await handler.HandleAsync(
                new GetRecentQuestionEventsQuery(actorUserId, farmId, sinceDays ?? 14), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetRecentDfesQuestionEvents");

        // Part 03 B4 — the products of ONE saved record and what each was for: whether its purpose was said, whether Sathi
        // should ask, and the answer to show on the product row (his voice words only to those who may hear the record's words).
        group.MapGet("/question-events/product-purposes", async (
            Guid farmId, Guid dailyLogId,
            ClaimsPrincipal user,
            GetProductPurposesHandler handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // Same posture as the two routes above: the membership-validated farm scope before the first read (prod FORCE-RLS).
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
                return ToErrorResult(scopeResult.Error);

            var result = await handler.HandleAsync(new GetProductPurposesQuery(actorUserId, farmId, dailyLogId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetDfesProductPurposes");

        return group;
    }

    public sealed record RecordQuestionEventRequest(
        Guid FarmId, Guid? PlotId, Guid? DailyLogId,
        string QuestionKey, string Crop, string? ExpectedStage, string? ActualStageApplicability,
        string AnchorDateType, string TriggerType, string QuestionType, string Lens,
        int DepthLevel, int Priority, int Cooldown, string AnswerModes, string SafetyClass,
        bool AgronomistApproved, bool MarathiApproved, string BankVersion, string QuestionEngineVersion,
        Guid? AnswerObservationId, DateTime? ShownAtUtc, string? TriggerReason, string? WeatherContext,
        string? Response, bool? StageConfirmed, bool? PhotoSubmitted, bool? Skipped,
        // Lane DFES-Q — optional; an older phone's body has none of them and binds unchanged (P11).
        string? PromptText = null, string? PromptOrigin = null, IReadOnlyList<string>? LookLineIds = null,
        string? ScheduleCardRef = null, string? DeviationReasonCode = null, string? DeviationChallenge = null,
        Guid? PhotoAttachmentId = null,
        // Part 03 B4 — the product-purpose question only (questionKey "product.purpose"); an older phone sends none (P11).
        string? InputEventId = null, int? MixIndex = null, string? AnswerMode = null, string? AnswerCode = null);

    private static IResult ToErrorResult(Error error) =>
        error.Code.Contains("NotFound") ? Results.NotFound(error.Description)
        : error.Code.Contains("Forbidden") ? Results.Forbid()
        // Part 03 B4 — "already answered, the first answer is kept" (the only Conflict these routes return).
        : error.Code.EndsWith(".Conflict", StringComparison.Ordinal) ? Results.Conflict(error.Description)
        : Results.BadRequest(error.Description);
}
