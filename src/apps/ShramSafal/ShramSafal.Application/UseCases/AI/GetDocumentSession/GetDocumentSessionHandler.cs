using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.GetDocumentSession;

public sealed class GetDocumentSessionHandler(IDocumentExtractionSessionRepository sessionRepository)
{
    public async Task<Result<GetDocumentSessionResult>> HandleAsync(
        GetDocumentSessionQuery query,
        CancellationToken ct = default)
    {
        if (query.SessionId == Guid.Empty || query.UserId == Guid.Empty)
        {
            return Result.Failure<GetDocumentSessionResult>(ShramSafalErrors.InvalidCommand);
        }

        var session = await sessionRepository.GetByIdAsync(query.SessionId, ct);
        if (session is null)
        {
            return Result.Failure<GetDocumentSessionResult>(
                Error.NotFound("ShramSafal.SessionNotFound", "Document extraction session was not found."));
        }

        if (session.UserId != query.UserId)
        {
            return Result.Failure<GetDocumentSessionResult>(ShramSafalErrors.Forbidden);
        }

        return Result.Success(new GetDocumentSessionResult(
            session.Id,
            session.DocumentType.ToString(),
            session.Status.ToString(),
            ParseJsonOrNull(session.DraftResultJson),
            session.DraftConfidence,
            session.DraftProvider,
            session.DraftAiJobId,
            ParseJsonOrNull(session.VerifiedResultJson),
            session.VerifiedConfidence,
            session.VerificationProvider,
            session.VerificationAiJobId,
            session.CreatedAtUtc,
            session.ModifiedAtUtc));
    }

    private static object? ParseJsonOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<object>(json);
        }
        catch (JsonException ex)
        {
            // Sub-plan 03 Task 10: malformed payload → raw string
            // fallback. Activity event for observability.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "GetDocumentSession.MalformedPayload",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return json;
        }
    }
}

public sealed record GetDocumentSessionResult(
    Guid SessionId,
    string DocumentType,
    string Status,
    object? DraftResult,
    decimal DraftConfidence,
    string? DraftProvider,
    Guid? DraftJobId,
    object? VerifiedResult,
    decimal? VerifiedConfidence,
    string? VerificationProvider,
    Guid? VerificationJobId,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
