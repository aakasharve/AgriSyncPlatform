using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.GetAiJobStatus;

/// <summary>
/// <c>/ai/jobs/{id}</c> — a job's status and its parse.
/// <para><b>Who reads the parse (lane MU-3 fix 1, review item 12; F3).</b> The parse is a record's words and
/// values before it is saved, so it follows the record rules: a reader must read the job's farm
/// (<see cref="FarmReadScope"/>; a कामगार seat reads only his OWN jobs). Someone else's parse goes only to a
/// reader allowed to hear that farm's words (<see cref="RecordWordsGate"/>: the primary owner or a confirm-records
/// holder), and when it mentions money (<see cref="MoneyMention"/>) only to one who also sees the farm's money.
/// Otherwise the status comes back without the parse (<c>Result</c> withheld whole, with the reason). The person
/// who asked for the job, and a platform admin, read it whole.</para>
/// </summary>
public sealed class GetAiJobStatusHandler(
    IShramSafalRepository repository,
    IAiJobRepository aiJobRepository,
    IClock clock)
{
    /// <summary>The parse was withheld: the reader may not hear this farm's words.</summary>
    public const string ResultWithheldWords = "words";

    /// <summary>The parse was withheld: it mentions money and the reader does not see the farm's money (F3).</summary>
    public const string ResultWithheldMoney = "money";

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

        string? withheld = null;
        if (!query.IsAdmin)
        {
            var now = clock.UtcNow;
            var access = await repository.GetFarmAccessForUserAsync(job.FarmId, query.ActorUserId, ct);
            var scope = FarmReadScope.Of(job.FarmId, access, now);
            var ownJob = job.UserId == query.ActorUserId;
            if (scope is null || (scope.OwnRecordsOnly && !ownJob))
            {
                return Result.Failure<AiJobStatusDto>(ShramSafalErrors.Forbidden);
            }

            var role = access!.IsRegistrant ? AppRole.PrimaryOwner : access.Role;
            var mayHear = await RecordWordsGate.MayHearAsync(
                query.ActorUserId,
                job.UserId,
                role,
                () => Task.FromResult(FarmAccessPolicy.Holds(access, Domain.Farms.FarmAuthority.ConfirmRecords, now)));
            // His own parse comes back whole (the words gate already admits the speaker).
            if (!mayHear)
            {
                withheld = ResultWithheldWords;
            }
            else if (!ownJob && !MoneyMention.HearsMoneyWords(scope) && MentionsMoney(job.NormalizedResultJson))
            {
                withheld = ResultWithheldMoney;
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
            withheld is null ? ParseJsonOrNull(job.NormalizedResultJson) : null,
            withheld);

        return Result.Success(dto);
    }

    /// <summary>The F3 test on a parse: an amount key or a money word anywhere in it (unreadable = yes).</summary>
    private static bool MentionsMoney(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(json);
            return MoneyMention.InDocument(document.RootElement);
        }
        catch (JsonException ex)
        {
            // An unreadable parse is read as text (a false match only withholds it); the event is recorded.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "GetAiJobStatus.UnreadableParseForMoneyRule",
                tags: new System.Diagnostics.ActivityTagsCollection { ["exception.type"] = ex.GetType().Name }));
            return MoneyMention.InText(json);
        }
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
                "GetAiJobStatus.MalformedPayload",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
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
    object? Result,
    /// <summary>
    /// lane MU-3 fix 1 — why <see cref="Result"/> is absent for this reader: <c>"words"</c> (he may not hear this
    /// farm's words) or <c>"money"</c> (the parse mentions money and he does not see the farm's money, F3);
    /// <c>null</c> = nothing was withheld. Additive.
    /// </summary>
    string? ResultWithheld = null);

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
