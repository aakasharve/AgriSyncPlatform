// spec: data-principle-spine-2026-05-05/10.4
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Privacy.PiiReview;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy.Pii;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — admin review-queue
/// surface for the heuristic PII detector outputs. All routes are
/// gated by the <c>"pii_reviewer"</c> policy (OQ-6 allow-list).
/// </summary>
public static class PiiReviewEndpoints
{
    public static RouteGroupBuilder MapPiiReviewEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/admin/pii-review/queue", HandleListQueueAsync)
            .WithName("ListPiiReviewQueue")
            .RequireAuthorization(ShramSafal.Api.Authorization.PiiReviewerRequirement.PolicyName);

        group.MapPost("/admin/pii-review/{id:guid}/approve", HandleApproveAsync)
            .WithName("ApprovePiiReviewEntry")
            .RequireAuthorization(ShramSafal.Api.Authorization.PiiReviewerRequirement.PolicyName);

        group.MapPost("/admin/pii-review/{id:guid}/reject", HandleRejectAsync)
            .WithName("RejectPiiReviewEntry")
            .RequireAuthorization(ShramSafal.Api.Authorization.PiiReviewerRequirement.PolicyName);

        return group;
    }

    private static async Task<IResult> HandleListQueueAsync(
        string? status,
        IShramSafalRepository repository,
        CancellationToken ct)
    {
        var parsedStatus = PiiReviewStatus.Pending;
        if (!string.IsNullOrWhiteSpace(status) &&
            !Enum.TryParse(status, ignoreCase: true, out parsedStatus))
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = $"Unknown status '{status}'. Expected Pending|AutoRedacted|ReviewApproved|ReviewRejected|Discarded.",
            });
        }

        var entries = await repository.ListPiiReviewQueueAsync(parsedStatus, limit: 100, ct);
        var dto = entries.Select(ProjectToDto).ToArray();
        return Results.Ok(new { count = dto.Length, status = parsedStatus.ToString(), entries = dto });
    }

    private static async Task<IResult> HandleApproveAsync(
        Guid id,
        HttpContext httpContext,
        PiiReviewDecisionRequest? request,
        ReviewPiiQueueEntryHandler handler,
        CancellationToken ct)
        => await ProcessDecisionAsync(id, httpContext, request, handler, PiiReviewDecision.Approve, ct);

    private static async Task<IResult> HandleRejectAsync(
        Guid id,
        HttpContext httpContext,
        PiiReviewDecisionRequest? request,
        ReviewPiiQueueEntryHandler handler,
        CancellationToken ct)
        => await ProcessDecisionAsync(id, httpContext, request, handler, PiiReviewDecision.Reject, ct);

    private static async Task<IResult> ProcessDecisionAsync(
        Guid id,
        HttpContext httpContext,
        PiiReviewDecisionRequest? request,
        ReviewPiiQueueEntryHandler handler,
        PiiReviewDecision decision,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();

        var command = new ReviewPiiQueueEntryCommand(
            EntryId: id,
            ReviewerUserId: userId,
            Decision: decision,
            Note: request?.Note,
            ClientAppVersion: appVersion,
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        return Results.Ok(ProjectToDto(result.Value));
    }

    private static object ProjectToDto(PiiReviewQueueEntry e) => new
    {
        id = e.Id,
        transcriptId = e.TranscriptId,
        status = e.Status.ToString(),
        originalText = e.OriginalText,
        redactedText = e.RedactedText,
        detectionJson = e.DetectionJson,
        reviewedByUserId = e.ReviewedByUserId,
        reviewNote = e.ReviewNote,
        occurredAtUtc = e.OccurredAtUtc,
        reviewedAtUtc = e.ReviewedAtUtc,
    };

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

public sealed record PiiReviewDecisionRequest(string? Note);
