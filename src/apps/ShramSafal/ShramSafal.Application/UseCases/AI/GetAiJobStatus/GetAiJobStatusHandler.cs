using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.GetAiJobStatus;

public sealed class GetAiJobStatusHandler(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository)
{
    private static readonly Error AiJobNotFound =
        new("ShramSafal.AiJobNotFound", "AI job was not found.");

    public async Task<Result<AiJobStatusDto>> HandleAsync(
        GetAiJobStatusQuery query,
        CancellationToken ct = default)
    {
        if (query.JobId == Guid.Empty || query.ActorUserId == Guid.Empty)
        {
            return Result.Failure<AiJobStatusDto>(ShramSafalErrors.InvalidCommand);
        }

        var job = await aiJobRepository.GetByIdAsync(query.JobId, ct);
        if (job is null)
        {
            return Result.Failure<AiJobStatusDto>(AiJobNotFound);
        }

        if (!query.IsAdmin)
        {
            var canAccessFarm = await repository.IsUserMemberOfFarmAsync(job.FarmId, query.ActorUserId, ct);
            if (!canAccessFarm)
            {
                return Result.Failure<AiJobStatusDto>(ShramSafalErrors.Forbidden);
            }
        }

        var attempts = job.Attempts
            .OrderBy(x => x.AttemptNumber)
            .Select(x => new AiJobAttemptStatusDto(
                x.AttemptNumber,
                x.Provider.ToString(),
                x.IsSuccess,
                x.FailureClass.ToString(),
                x.ErrorMessage,
                x.LatencyMs,
                x.ConfidenceScore,
                x.EstimatedCostUnits,
                query.IsAdmin ? x.RequestPayloadHash : null,
                query.IsAdmin ? ParseJsonOrNull(x.RawProviderResponse) : null,
                x.AttemptedAtUtc))
            .ToList();

        var dto = new AiJobStatusDto(
            job.Id,
            job.Status.ToString(),
            job.OperationType.ToString(),
            job.CreatedAtUtc,
            job.CompletedAtUtc,
            job.InputSpeechDurationMs,
            job.InputRawDurationMs,
            query.IsAdmin ? ParseJsonOrNull(job.InputSessionMetadataJson) : null,
            attempts,
            ParseJsonOrNull(job.NormalizedResultJson));

        return Result.Success(dto);
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
        catch (JsonException)
        {
            return json;
        }
    }
}

public sealed record AiJobStatusDto(
    Guid Id,
    string Status,
    string OperationType,
    DateTime CreatedAtUtc,
    DateTime? CompletedAtUtc,
    int? InputSpeechDurationMs,
    int? InputRawDurationMs,
    object? InputSessionMetadata,
    IReadOnlyList<AiJobAttemptStatusDto> Attempts,
    object? Result);

public sealed record AiJobAttemptStatusDto(
    int AttemptNumber,
    string Provider,
    bool IsSuccess,
    string FailureClass,
    string? ErrorMessage,
    int LatencyMs,
    decimal? ConfidenceScore,
    decimal? EstimatedCostUnits,
    string? RequestPayloadHash,
    object? RawProviderResponse,
    DateTime AttemptedAtUtc);
