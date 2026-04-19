using System.Diagnostics;
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.ExtractPattiImage;

public sealed class ExtractPattiImageHandler(
    IShramSafalRepository repository,
    IAiOrchestrator aiOrchestrator,
    IAiPromptBuilder promptBuilder,
    IAnalyticsWriter analytics,
    IClock clock)
{
    public async Task<Result<ExtractPattiImageResult>> HandleAsync(
        ExtractPattiImageCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty ||
            command.FarmId == Guid.Empty ||
            command.ImageStream is null ||
            string.IsNullOrWhiteSpace(command.CropName) ||
            string.IsNullOrWhiteSpace(command.MimeType))
        {
            return Result.Failure<ExtractPattiImageResult>(ShramSafalErrors.InvalidCommand);
        }

        var canAccessFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.UserId, ct);
        if (!canAccessFarm)
        {
            return Result.Failure<ExtractPattiImageResult>(ShramSafalErrors.Forbidden);
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(command.IdempotencyKey)
            ? Guid.NewGuid().ToString("N")
            : command.IdempotencyKey.Trim();

        var prompt = promptBuilder.BuildPattiExtractionPrompt(command.CropName);
        var stopwatch = Stopwatch.StartNew();
        var orchestration = await aiOrchestrator.ExtractPattiWithFallbackAsync(
            command.UserId,
            command.FarmId,
            command.ImageStream,
            command.MimeType,
            prompt,
            idempotencyKey,
            ct);
        stopwatch.Stop();

        await EmitAiInvocationAsync(command, orchestration, stopwatch.ElapsedMilliseconds, ct);

        if (!orchestration.Result.Success)
        {
            return Result.Failure<ExtractPattiImageResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    orchestration.Result.Error ?? ShramSafalErrors.AiParsingFailed.Description));
        }

        return Result.Success(new ExtractPattiImageResult(
            ParseJsonOrNull(orchestration.Result.NormalizedJson),
            orchestration.Result.OverallConfidence,
            orchestration.JobId,
            orchestration.ProviderUsed.ToString(),
            orchestration.FallbackUsed,
            orchestration.Result.Warnings));
    }

    private Task EmitAiInvocationAsync(
        ExtractPattiImageCommand command,
        (ShramSafal.Domain.AI.ReceiptExtractCanonicalResult Result, Guid JobId, ShramSafal.Domain.AI.AiProviderType ProviderUsed, bool FallbackUsed) orchestration,
        long latencyMs,
        CancellationToken ct)
    {
        return analytics.EmitAsync(new AnalyticsEvent(
            EventId: Guid.NewGuid(),
            EventType: AnalyticsEventType.AiInvocation,
            OccurredAtUtc: clock.UtcNow,
            ActorUserId: new UserId(command.UserId),
            FarmId: new FarmId(command.FarmId),
            OwnerAccountId: null,
            ActorRole: "operator",
            Trigger: "photo",
            DeviceOccurredAtUtc: null,
            SchemaVersion: "v1",
            PropsJson: JsonSerializer.Serialize(new
            {
                operation = "patti.extract",
                cropName = command.CropName,
                jobId = orchestration.JobId,
                providerUsed = orchestration.ProviderUsed.ToString(),
                fallbackUsed = orchestration.FallbackUsed,
                latencyMs,
                outcome = orchestration.Result.Success ? "success" : "failure",
                overallConfidence = orchestration.Result.Success ? orchestration.Result.OverallConfidence : (decimal?)null,
                error = orchestration.Result.Success ? null : orchestration.Result.Error
            })
        ), ct);
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

public sealed record ExtractPattiImageResult(
    object? NormalizedJson,
    decimal OverallConfidence,
    Guid JobId,
    string ProviderUsed,
    bool FallbackUsed,
    IReadOnlyList<string> Warnings);
