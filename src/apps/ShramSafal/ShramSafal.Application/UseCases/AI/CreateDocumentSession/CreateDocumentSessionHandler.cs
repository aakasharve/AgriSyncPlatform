using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.AI.CreateDocumentSession;

public sealed class CreateDocumentSessionHandler(
    IShramSafalRepository repository,
    IDocumentExtractionSessionRepository sessionRepository,
    IAttachmentStorageService storageService,
    IAiOrchestrator aiOrchestrator,
    IAiPromptBuilder promptBuilder,
    IEntitlementPolicy entitlementPolicy,
    ILogger<CreateDocumentSessionHandler> logger)
{
    public async Task<Result<CreateDocumentSessionResult>> HandleAsync(
        CreateDocumentSessionCommand command,
        CancellationToken ct = default)
    {
        if (command.UserId == Guid.Empty ||
            command.FarmId == Guid.Empty ||
            command.ImageStream is null ||
            string.IsNullOrWhiteSpace(command.MimeType))
        {
            return Result.Failure<CreateDocumentSessionResult>(ShramSafalErrors.InvalidCommand);
        }

        if (command.DocumentType == DocumentType.Patti && string.IsNullOrWhiteSpace(command.CropName))
        {
            return Result.Failure<CreateDocumentSessionResult>(ShramSafalErrors.InvalidCommand);
        }

        var canAccessFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.UserId, ct);
        if (!canAccessFarm)
        {
            return Result.Failure<CreateDocumentSessionResult>(ShramSafalErrors.Forbidden);
        }

        var gate = await EntitlementGate.CheckAsync<CreateDocumentSessionResult>(
            entitlementPolicy,
            new UserId(command.UserId),
            new FarmId(command.FarmId),
            PaidFeature.AiParse,
            ct);
        if (gate is not null)
        {
            return gate;
        }

        var session = DocumentExtractionSession.Create(command.UserId, command.FarmId, command.DocumentType);

        // Buffer the image so we can: (1) save to storage for background verification, (2) pass to orchestrator
        using var imageBuffer = new MemoryStream();
        if (command.ImageStream.CanSeek)
        {
            command.ImageStream.Position = 0;
        }

        await command.ImageStream.CopyToAsync(imageBuffer, ct);

        // Save image to local storage for future background verification
        var extension = MimeTypeToExtension(command.MimeType);
        var storagePath = $"ai-sessions/{session.Id}/input{extension}";
        try
        {
            imageBuffer.Position = 0;
            await storageService.SaveAsync(storagePath, imageBuffer, command.MimeType, ct);
            session.SetInput(storagePath, command.MimeType);
        }
        catch (Exception ex)
        {
            // Sub-plan 03 Task 10: storage failure is recoverable for the
            // current call (draft extraction can still proceed in-memory)
            // but MUST be observable. Log a warning so an outage on the
            // S3 / local-file backend surfaces in ops dashboards even
            // though the user-visible request still completes.
            logger.LogWarning(ex,
                "CreateDocumentSession: storage backend SaveAsync failed for session {SessionId} ({StoragePath}); proceeding without persisted input.",
                session.Id, storagePath);
            storagePath = string.Empty;
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(command.IdempotencyKey)
            ? Guid.NewGuid().ToString("N")
            : command.IdempotencyKey.Trim();

        imageBuffer.Position = 0;
        var orchestration = command.DocumentType == DocumentType.Receipt
            ? await aiOrchestrator.ExtractReceiptWithFallbackAsync(
                command.UserId,
                command.FarmId,
                imageBuffer,
                command.MimeType,
                promptBuilder.BuildReceiptExtractionPrompt(),
                idempotencyKey,
                ct)
            : await aiOrchestrator.ExtractPattiWithFallbackAsync(
                command.UserId,
                command.FarmId,
                imageBuffer,
                command.MimeType,
                promptBuilder.BuildPattiExtractionPrompt(command.CropName!),
                idempotencyKey,
                ct);

        if (!orchestration.Result.Success)
        {
            return Result.Failure<CreateDocumentSessionResult>(
                new Error(
                    ShramSafalErrors.AiParsingFailed.Code,
                    orchestration.Result.Error ?? ShramSafalErrors.AiParsingFailed.Description));
        }

        session.SetDraftResult(
            orchestration.Result.NormalizedJson ?? string.Empty,
            orchestration.Result.OverallConfidence,
            orchestration.ProviderUsed.ToString(),
            orchestration.JobId);

        await sessionRepository.SaveAsync(session, ct);

        return Result.Success(new CreateDocumentSessionResult(
            session.Id,
            ParseJsonOrNull(orchestration.Result.NormalizedJson),
            orchestration.Result.OverallConfidence,
            orchestration.JobId,
            orchestration.ProviderUsed.ToString(),
            orchestration.FallbackUsed,
            orchestration.Result.Warnings,
            session.Status.ToString()));
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
            // Sub-plan 03 Task 10: malformed audit payload falls back to
            // the raw string. Emit an OTel/Activity event so the
            // fallback is observable in traces (this is a static helper;
            // no ILogger access).
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "CreateDocumentSession.MalformedPayload",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return json;
        }
    }

    private static string MimeTypeToExtension(string mimeType)
    {
        return mimeType.ToLowerInvariant() switch
        {
            "image/png" => ".png",
            "image/webp" => ".webp",
            "image/heic" or "image/heif" => ".heic",
            _ => ".jpg"
        };
    }
}

public sealed record CreateDocumentSessionResult(
    Guid SessionId,
    object? NormalizedJson,
    decimal OverallConfidence,
    Guid JobId,
    string ProviderUsed,
    bool FallbackUsed,
    IReadOnlyList<string> Warnings,
    string Status);
