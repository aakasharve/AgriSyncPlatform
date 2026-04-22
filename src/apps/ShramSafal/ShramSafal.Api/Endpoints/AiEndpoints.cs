using System.Net.Mime;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.RateLimiting;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.CreateDocumentSession;
using ShramSafal.Application.UseCases.AI.ExtractPattiImage;
using ShramSafal.Application.UseCases.AI.ExtractReceipt;
using ShramSafal.Application.UseCases.AI.GetAiDashboard;
using ShramSafal.Application.UseCases.AI.GetAiJobStatus;
using ShramSafal.Application.UseCases.AI.GetDocumentSession;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Application.UseCases.AI.UpdateProviderConfig;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Api.Endpoints;

public static class AiEndpoints
{
    private const int MaxAudioPayloadBytes = 12 * 1024 * 1024; // 12 MB
    private const int MaxImagePayloadBytes = 10 * 1024 * 1024; // 10 MB
    private const int MaxVoiceSessionDurationMs = 600_000; // 10 minutes
    private const int MaxVoiceSegmentDurationMs = 120_000; // 2 minutes
    private const int MaxVoiceSegmentsPerSession = 30;
    private const int MaxSegmentMetadataLength = 64 * 1024;
    private const string InvalidSegmentMetadataCode = "ShramSafal.InvalidSegmentMetadata";

    private static readonly HashSet<string> AllowedAudioMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "audio/webm",
        "audio/wav",
        "audio/x-wav",
        "audio/mpeg",
        "audio/mp3",
        "audio/ogg",
        "audio/mp4",
        "audio/aac",
        "audio/flac"
    };

    private static readonly HashSet<string> AllowedImageMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/heic",
        "image/heif"
    };

    public static RouteGroupBuilder MapAiEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/ai/voice-parse", HandleVoiceParseAsync)
            .WithName("ParseVoiceInput")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        // Backward-compatible route alias
        group.MapPost("/ai/parse-voice", HandleVoiceParseAsync)
            .WithName("ParseVoiceInputLegacy")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapPost("/ai/receipt-extract", HandleReceiptExtractAsync)
            .WithName("ExtractReceipt")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapPost("/ai/patti-extract", HandlePattiExtractAsync)
            .WithName("ExtractPatti")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapPost("/ai/document-sessions/receipt", HandleCreateReceiptSessionAsync)
            .WithName("CreateReceiptSession")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapPost("/ai/document-sessions/patti", HandleCreatePattiSessionAsync)
            .WithName("CreatePattiSession")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapGet("/ai/document-sessions/{sessionId:guid}", async Task<IResult> (
            Guid sessionId,
            ClaimsPrincipal user,
            GetDocumentSessionHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetDocumentSessionQuery(sessionId, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetDocumentSession")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        // /ai/jobs/:id — NOT admin-gated. Any authenticated user can query a job's
        // status. The admin flag (passed to handler) controls response sensitivity:
        // raw provider payloads are revealed only to Platform admins. Post-W0-B
        // pivot, "admin" is sourced from the resolver, not the JWT claim.
        group.MapGet("/ai/jobs/{jobId:guid}", async Task<IResult> (
            Guid jobId,
            HttpContext http,
            IEntitlementResolver resolver,
            GetAiJobStatusHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(http.User, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var scope = await AdminScopeHelper.TryResolveSilentlyAsync(http, resolver, ct);
            var isAdmin = scope?.IsPlatformAdmin ?? false;

            var result = await handler.HandleAsync(
                new GetAiJobStatusQuery(jobId, actorUserId, isAdmin),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetAiJobStatus")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        group.MapGet("/ai/health", async Task<IResult> (
            HttpContext http,
            IEntitlementResolver resolver,
            IEnumerable<IAiProvider> providers,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var statuses = new List<object>();
            foreach (var provider in providers.OrderBy(x => x.ProviderType))
            {
                var healthy = await provider.HealthCheckAsync(ct);
                statuses.Add(new
                {
                    provider = provider.ProviderType.ToString(),
                    isHealthy = healthy
                });
            }

            return Results.Ok(new
            {
                module = "ShramSafal.AI",
                statuses
            });
        })
        .WithName("GetAiHealth")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        group.MapGet("/ai/config", async Task<IResult> (
            HttpContext http,
            IEntitlementResolver resolver,
            IAiJobRepository repository,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var config = await repository.GetProviderConfigAsync(ct);
            return Results.Ok(ToConfigResponse(config));
        })
        .WithName("GetAiProviderConfig")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        // Platform-only write — AI provider config is cross-tenant global state.
        group.MapPut("/ai/config", async Task<IResult> (
            HttpContext http,
            IEntitlementResolver resolver,
            UpdateAiProviderConfigRequest request,
            UpdateProviderConfigHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(http.User, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var result = await handler.HandleAsync(
                new UpdateProviderConfigCommand(
                    actorUserId,
                    EndpointActorContext.GetActorRole(http.User),
                    request.DefaultProvider,
                    request.FallbackEnabled,
                    request.IsAiProcessingDisabled,
                    request.MaxRetries,
                    request.CircuitBreakerThreshold,
                    request.CircuitBreakerResetSeconds,
                    request.VoiceConfidenceThreshold,
                    request.ReceiptConfidenceThreshold,
                    request.VoiceProvider,
                    request.ReceiptProvider,
                    request.PattiProvider),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("UpdateAiProviderConfig")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        group.MapGet("/ai/dashboard", async Task<IResult> (
            HttpContext http,
            IEntitlementResolver resolver,
            GetAiDashboardHandler handler,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var result = await handler.HandleAsync(new GetAiDashboardQuery(), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetAiDashboard")
        .RequireRateLimiting("ai")
        .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleCreateReceiptSessionAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        CreateDocumentSessionHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "multipart/form-data is required." });
        }

        var form = await request.ReadFormAsync(ct);
        if (!TryParseGuid(form["farmId"], out var farmId))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "farmId is required." });
        }

        var image = form.Files["image"] ?? form.Files.FirstOrDefault();
        if (image is null || image.Length == 0)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "image is required." });
        }

        if (!TryValidateImageFile(image, out var imageValidationError))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = imageValidationError });
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(form["idempotencyKey"])
            ? Guid.NewGuid().ToString("N")
            : form["idempotencyKey"].ToString().Trim();

        await using var stream = image.OpenReadStream();
        var result = await handler.HandleAsync(
            new CreateDocumentSessionCommand(
                userId,
                farmId,
                DocumentType.Receipt,
                stream,
                image.ContentType ?? MediaTypeNames.Image.Jpeg,
                null,
                idempotencyKey),
            ct);

        if (!result.IsSuccess)
        {
            return string.Equals(result.Error.Code, ShramSafalErrors.AiParsingFailed.Code, StringComparison.Ordinal)
                ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable)
                : ToErrorResult(result.Error);
        }

        var session = result.Value;
        if (session is null)
        {
            return UnexpectedNullResult("CreateReceiptSession");
        }

        return Results.Ok(new
        {
            success = true,
            sessionId = session.SessionId,
            status = session.Status,
            draft = new
            {
                normalizedJson = session.NormalizedJson,
                overallConfidence = session.OverallConfidence,
                jobId = session.JobId,
                providerUsed = session.ProviderUsed,
                fallbackUsed = session.FallbackUsed,
                warnings = session.Warnings
            }
        });
    }

    private static async Task<IResult> HandleCreatePattiSessionAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        CreateDocumentSessionHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "multipart/form-data is required." });
        }

        var form = await request.ReadFormAsync(ct);
        if (!TryParseGuid(form["farmId"], out var farmId))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "farmId is required." });
        }

        var cropName = form["cropName"].ToString();
        if (string.IsNullOrWhiteSpace(cropName))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "cropName is required." });
        }

        var image = form.Files["image"] ?? form.Files.FirstOrDefault();
        if (image is null || image.Length == 0)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "image is required." });
        }

        if (!TryValidateImageFile(image, out var imageValidationError))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = imageValidationError });
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(form["idempotencyKey"])
            ? Guid.NewGuid().ToString("N")
            : form["idempotencyKey"].ToString().Trim();

        await using var stream = image.OpenReadStream();
        var result = await handler.HandleAsync(
            new CreateDocumentSessionCommand(
                userId,
                farmId,
                DocumentType.Patti,
                stream,
                image.ContentType ?? MediaTypeNames.Image.Jpeg,
                cropName,
                idempotencyKey),
            ct);

        if (!result.IsSuccess)
        {
            return string.Equals(result.Error.Code, ShramSafalErrors.AiParsingFailed.Code, StringComparison.Ordinal)
                ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable)
                : ToErrorResult(result.Error);
        }

        var session = result.Value;
        if (session is null)
        {
            return UnexpectedNullResult("CreatePattiSession");
        }

        return Results.Ok(new
        {
            success = true,
            sessionId = session.SessionId,
            status = session.Status,
            draft = new
            {
                normalizedJson = session.NormalizedJson,
                overallConfidence = session.OverallConfidence,
                jobId = session.JobId,
                providerUsed = session.ProviderUsed,
                fallbackUsed = session.FallbackUsed,
                warnings = session.Warnings
            }
        });
    }

    private static async Task<IResult> HandleVoiceParseAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal user,
        ParseVoiceInputHandler handler,
        IAiJobRepository aiJobRepository,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        var parsedRequest = await ParseVoiceRequestAsync(httpRequest, ct);
        if (!parsedRequest.IsSuccess)
        {
            return Results.BadRequest(new
            {
                error = parsedRequest.Error.Code,
                message = parsedRequest.Error.Description
            });
        }

        var parsed = parsedRequest.Value;
        if (parsed is null)
        {
            return UnexpectedNullResult("ParseVoiceRequest");
        }

        var effectiveIdempotencyKey = string.IsNullOrWhiteSpace(parsed.IdempotencyKey)
            ? BuildDeterministicFallbackIdempotencyKey(userId, parsed)
            : parsed.IdempotencyKey;

        var command = new ParseVoiceInputCommand(
            userId,
            parsed.FarmId,
            parsed.PlotId,
            parsed.CropCycleId,
            parsed.TextTranscript,
            parsed.AudioBase64,
            parsed.AudioMimeType,
            effectiveIdempotencyKey,
            parsed.ContextJson,
            parsed.InputSpeechDurationMs,
            parsed.InputRawDurationMs,
            parsed.SegmentMetadataJson,
            parsed.RequestPayloadHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        var parseResult = result.Value;
        if (parseResult is null)
        {
            return UnexpectedNullResult("ParseVoiceInput");
        }

        var job = await aiJobRepository.GetByIdempotencyKeyAsync(effectiveIdempotencyKey, ct);
        return Results.Ok(new
        {
            success = true,
            parsedLog = parseResult.ParsedLog,
            confidence = parseResult.Confidence,
            fieldConfidences = parseResult.FieldConfidences,
            suggestedAction = parseResult.SuggestedAction,
            modelUsed = parseResult.ModelUsed,
            latencyMs = parseResult.LatencyMs,
            validationOutcome = parseResult.ValidationOutcome,
            jobId = job?.Id
        });
    }

    private static async Task<IResult> HandleReceiptExtractAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        ExtractReceiptHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "multipart/form-data is required." });
        }

        var form = await request.ReadFormAsync(ct);
        if (!TryParseGuid(form["farmId"], out var farmId))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "farmId is required." });
        }

        var image = form.Files["image"] ?? form.Files.FirstOrDefault();
        if (image is null || image.Length == 0)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "image is required." });
        }

        if (!TryValidateImageFile(image, out var imageValidationError))
        {
            return Results.BadRequest(new
            {
                error = "ShramSafal.InvalidCommand",
                message = imageValidationError
            });
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(form["idempotencyKey"])
            ? Guid.NewGuid().ToString("N")
            : form["idempotencyKey"].ToString().Trim();

        await using var stream = image.OpenReadStream();
        var result = await handler.HandleAsync(
            new ExtractReceiptCommand(
                userId,
                farmId,
                stream,
                image.ContentType ?? MediaTypeNames.Image.Jpeg,
                idempotencyKey),
            ct);

        if (!result.IsSuccess)
        {
            return string.Equals(result.Error.Code, ShramSafalErrors.AiParsingFailed.Code, StringComparison.Ordinal)
                ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable)
                : ToErrorResult(result.Error);
        }

        var extraction = result.Value;
        if (extraction is null)
        {
            return UnexpectedNullResult("ExtractReceipt");
        }

        return Results.Ok(new
        {
            success = true,
            normalizedJson = extraction.NormalizedJson,
            overallConfidence = extraction.OverallConfidence,
            jobId = extraction.JobId,
            providerUsed = extraction.ProviderUsed,
            fallbackUsed = extraction.FallbackUsed,
            warnings = extraction.Warnings
        });
    }

    private static async Task<IResult> HandlePattiExtractAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        ExtractPattiImageHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (!request.HasFormContentType)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "multipart/form-data is required." });
        }

        var form = await request.ReadFormAsync(ct);
        if (!TryParseGuid(form["farmId"], out var farmId))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "farmId is required." });
        }

        var cropName = form["cropName"].ToString();
        if (string.IsNullOrWhiteSpace(cropName))
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "cropName is required." });
        }

        var image = form.Files["image"] ?? form.Files.FirstOrDefault();
        if (image is null || image.Length == 0)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "image is required." });
        }

        if (!TryValidateImageFile(image, out var imageValidationError))
        {
            return Results.BadRequest(new
            {
                error = "ShramSafal.InvalidCommand",
                message = imageValidationError
            });
        }

        var idempotencyKey = string.IsNullOrWhiteSpace(form["idempotencyKey"])
            ? Guid.NewGuid().ToString("N")
            : form["idempotencyKey"].ToString().Trim();

        await using var stream = image.OpenReadStream();
        var result = await handler.HandleAsync(
            new ExtractPattiImageCommand(
                userId,
                farmId,
                cropName,
                stream,
                image.ContentType ?? MediaTypeNames.Image.Jpeg,
                idempotencyKey),
            ct);

        if (!result.IsSuccess)
        {
            return string.Equals(result.Error.Code, ShramSafalErrors.AiParsingFailed.Code, StringComparison.Ordinal)
                ? Results.StatusCode(StatusCodes.Status503ServiceUnavailable)
                : ToErrorResult(result.Error);
        }

        var extraction = result.Value;
        if (extraction is null)
        {
            return UnexpectedNullResult("ExtractPatti");
        }

        return Results.Ok(new
        {
            success = true,
            normalizedJson = extraction.NormalizedJson,
            overallConfidence = extraction.OverallConfidence,
            jobId = extraction.JobId,
            providerUsed = extraction.ProviderUsed,
            fallbackUsed = extraction.FallbackUsed,
            warnings = extraction.Warnings
        });
    }

    private static async Task<Result<ParseVoiceHttpRequest>> ParseVoiceRequestAsync(HttpRequest request, CancellationToken ct)
    {
        if (request.HasFormContentType)
        {
            var form = await request.ReadFormAsync(ct);
            if (!TryParseGuid(form["farmId"], out var farmId))
            {
                return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", "farmId is required."));
            }

            var plotId = TryParseNullableGuid(form["plotId"]);
            var cropCycleId = TryParseNullableGuid(form["cropCycleId"]);
            int? speechDuration = int.TryParse(form["inputSpeechDurationMs"], out var parsedSpeechDuration)
                ? parsedSpeechDuration
                : null;
            int? rawDuration = int.TryParse(form["inputRawDurationMs"], out var parsedRawDuration)
                ? parsedRawDuration
                : null;
            var durationValidationError = ValidateVoiceDurations(speechDuration, rawDuration);
            if (durationValidationError is not null)
            {
                return Result.Failure<ParseVoiceHttpRequest>(durationValidationError);
            }

            var textTranscript = form["textTranscript"].ToString();
            var audioFile = form.Files["audio"] ?? form.Files["audioSegments"] ?? form.Files.FirstOrDefault();
            string? audioBase64 = null;
            string? mimeType = null;
            var segmentMetadataJson = ReadSegmentMetadata(form["segmentMetadata"], form["segmentMetadataJson"]);
            var requestPayloadHash = form["requestPayloadHash"].ToString();

            if (audioFile is not null && audioFile.Length > 0)
            {
                if (!TryValidateAudioFile(audioFile, out var audioValidationError))
                {
                    return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", audioValidationError));
                }

                await using var stream = audioFile.OpenReadStream();
                await using var memory = new MemoryStream();
                await stream.CopyToAsync(memory, ct);
                audioBase64 = Convert.ToBase64String(memory.ToArray());
                mimeType = audioFile.ContentType;
            }
            else if (string.IsNullOrWhiteSpace(textTranscript))
            {
                return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", "textTranscript or audio is required."));
            }

            var segmentMetadataValidation = ValidateSegmentMetadata(segmentMetadataJson, mimeType, speechDuration, rawDuration);
            if (segmentMetadataValidation is not null)
            {
                return Result.Failure<ParseVoiceHttpRequest>(segmentMetadataValidation);
            }

            return Result.Success(new ParseVoiceHttpRequest(
                farmId,
                plotId,
                cropCycleId,
                textTranscript,
                audioBase64,
                mimeType,
                form["idempotencyKey"].ToString(),
                form["context"].ToString(),
                speechDuration,
                rawDuration,
                segmentMetadataJson,
                requestPayloadHash));
        }

        var jsonRequest = await request.ReadFromJsonAsync<ParseVoiceInputRequest>(cancellationToken: ct);
        if (jsonRequest is null)
        {
            return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", "Invalid JSON payload."));
        }

        if (string.IsNullOrWhiteSpace(jsonRequest.TextTranscript) &&
            string.IsNullOrWhiteSpace(jsonRequest.AudioBase64))
        {
            return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", "textTranscript or audioBase64 is required."));
        }

        if (!string.IsNullOrWhiteSpace(jsonRequest.AudioBase64))
        {
            if (!IsAllowedMimeType(jsonRequest.AudioMimeType, AllowedAudioMimeTypes))
            {
                return Result.Failure<ParseVoiceHttpRequest>(
                    new Error("ShramSafal.InvalidCommand", "Unsupported audio mime type."));
            }

            if (!TryValidateBase64Payload(jsonRequest.AudioBase64, MaxAudioPayloadBytes, out var base64ValidationError))
            {
                return Result.Failure<ParseVoiceHttpRequest>(new Error("ShramSafal.InvalidCommand", base64ValidationError));
            }
        }

        var jsonDurationValidationError = ValidateVoiceDurations(
            jsonRequest.InputSpeechDurationMs,
            jsonRequest.InputRawDurationMs);
        if (jsonDurationValidationError is not null)
        {
            return Result.Failure<ParseVoiceHttpRequest>(jsonDurationValidationError);
        }

        var jsonSegmentMetadataValidation = ValidateSegmentMetadata(
            jsonRequest.SegmentMetadataJson,
            jsonRequest.AudioMimeType,
            jsonRequest.InputSpeechDurationMs,
            jsonRequest.InputRawDurationMs);
        if (jsonSegmentMetadataValidation is not null)
        {
            return Result.Failure<ParseVoiceHttpRequest>(jsonSegmentMetadataValidation);
        }

        return Result.Success(new ParseVoiceHttpRequest(
            jsonRequest.FarmId,
            jsonRequest.PlotId,
            jsonRequest.CropCycleId,
            jsonRequest.TextTranscript,
            jsonRequest.AudioBase64,
            jsonRequest.AudioMimeType,
            jsonRequest.IdempotencyKey,
            jsonRequest.ContextJson,
            jsonRequest.InputSpeechDurationMs,
            jsonRequest.InputRawDurationMs,
            jsonRequest.SegmentMetadataJson,
            jsonRequest.RequestPayloadHash));
    }

    private static bool TryParseGuid(Microsoft.Extensions.Primitives.StringValues value, out Guid guid)
    {
        var candidate = value.ToString();
        if (string.IsNullOrWhiteSpace(candidate))
        {
            guid = Guid.Empty;
            return false;
        }

        return Guid.TryParse(candidate, out guid);
    }

    private static Guid? TryParseNullableGuid(Microsoft.Extensions.Primitives.StringValues value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        if (!Guid.TryParse(value.ToString(), out var parsed))
        {
            return null;
        }

        return parsed;
    }

    private static string? ReadSegmentMetadata(
        Microsoft.Extensions.Primitives.StringValues segmentMetadata,
        Microsoft.Extensions.Primitives.StringValues segmentMetadataJson)
    {
        if (!string.IsNullOrWhiteSpace(segmentMetadata))
        {
            return segmentMetadata.ToString().Trim();
        }

        if (!string.IsNullOrWhiteSpace(segmentMetadataJson))
        {
            return segmentMetadataJson.ToString().Trim();
        }

        return null;
    }

    private static Error? ValidateVoiceDurations(int? speechDurationMs, int? rawDurationMs)
    {
        if (speechDurationMs is < 0 || rawDurationMs is < 0)
        {
            return new Error("ShramSafal.InvalidCommand", "Duration values cannot be negative.");
        }

        if (speechDurationMs > MaxVoiceSessionDurationMs || rawDurationMs > MaxVoiceSessionDurationMs)
        {
            return new Error(
                "ShramSafal.InvalidCommand",
                $"Voice duration exceeds allowed ceiling of {MaxVoiceSessionDurationMs}ms.");
        }

        if (speechDurationMs.HasValue && rawDurationMs.HasValue && rawDurationMs.Value < speechDurationMs.Value)
        {
            return new Error("ShramSafal.InvalidCommand", "inputRawDurationMs must be >= inputSpeechDurationMs.");
        }

        return null;
    }

    private static Error? ValidateSegmentMetadata(
        string? segmentMetadataJson,
        string? audioMimeType,
        int? requestSpeechDurationMs,
        int? requestRawDurationMs)
    {
        if (string.IsNullOrWhiteSpace(segmentMetadataJson))
        {
            return null;
        }

        if (segmentMetadataJson.Length > MaxSegmentMetadataLength)
        {
            return new Error(InvalidSegmentMetadataCode, "segmentMetadata payload is too large.");
        }

        try
        {
            using var document = JsonDocument.Parse(segmentMetadataJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new Error(InvalidSegmentMetadataCode, "segmentMetadata must be a JSON object.");
            }

            var totalSegments = TryReadPositiveInt(root, "totalSegments");
            if (totalSegments is <= 0 or > MaxVoiceSegmentsPerSession)
            {
                return new Error(
                    InvalidSegmentMetadataCode,
                    $"totalSegments must be between 1 and {MaxVoiceSegmentsPerSession}.");
            }

            var totalSpeechDurationMs = TryReadNonNegativeInt(root, "totalSpeechDurationMs");
            var totalRawDurationMs = TryReadNonNegativeInt(root, "totalRawDurationMs");
            if (totalSpeechDurationMs is > MaxVoiceSessionDurationMs ||
                totalRawDurationMs is > MaxVoiceSessionDurationMs)
            {
                return new Error(
                    InvalidSegmentMetadataCode,
                    $"segmentMetadata durations must be <= {MaxVoiceSessionDurationMs}ms.");
            }

            if (totalSpeechDurationMs.HasValue &&
                totalRawDurationMs.HasValue &&
                totalRawDurationMs.Value < totalSpeechDurationMs.Value)
            {
                return new Error(
                    InvalidSegmentMetadataCode,
                    "segmentMetadata totalRawDurationMs must be >= totalSpeechDurationMs.");
            }

            if (requestSpeechDurationMs.HasValue &&
                totalSpeechDurationMs.HasValue &&
                requestSpeechDurationMs.Value != totalSpeechDurationMs.Value)
            {
                return new Error(
                    InvalidSegmentMetadataCode,
                    "segmentMetadata totalSpeechDurationMs must match inputSpeechDurationMs.");
            }

            if (requestRawDurationMs.HasValue &&
                totalRawDurationMs.HasValue &&
                requestRawDurationMs.Value != totalRawDurationMs.Value)
            {
                return new Error(
                    InvalidSegmentMetadataCode,
                    "segmentMetadata totalRawDurationMs must match inputRawDurationMs.");
            }

            if (root.TryGetProperty("segments", out var segmentsElement))
            {
                if (segmentsElement.ValueKind != JsonValueKind.Array)
                {
                    return new Error(InvalidSegmentMetadataCode, "segmentMetadata.segments must be an array.");
                }

                var segmentCount = segmentsElement.GetArrayLength();
                if (segmentCount > MaxVoiceSegmentsPerSession)
                {
                    return new Error(
                        InvalidSegmentMetadataCode,
                        $"segmentMetadata.segments exceeds {MaxVoiceSegmentsPerSession} entries.");
                }

                if (segmentCount > 0 && segmentCount != totalSegments)
                {
                    return new Error(
                        InvalidSegmentMetadataCode,
                        "segmentMetadata.segments length must match totalSegments.");
                }

                var normalizedAudioMime = NormalizeMimeType(audioMimeType);
                foreach (var segment in segmentsElement.EnumerateArray())
                {
                    if (segment.ValueKind != JsonValueKind.Object)
                    {
                        return new Error(InvalidSegmentMetadataCode, "Each segment entry must be an object.");
                    }

                    var segmentDurationMs = TryReadNonNegativeInt(segment, "durationMs");
                    var segmentRawDurationMs = TryReadNonNegativeInt(segment, "rawDurationMs");
                    if (segmentDurationMs is > MaxVoiceSegmentDurationMs ||
                        segmentRawDurationMs is > MaxVoiceSegmentDurationMs)
                    {
                        return new Error(
                            InvalidSegmentMetadataCode,
                            $"Segment duration must be <= {MaxVoiceSegmentDurationMs}ms.");
                    }

                    if (segmentDurationMs.HasValue &&
                        segmentRawDurationMs.HasValue &&
                        segmentRawDurationMs.Value < segmentDurationMs.Value)
                    {
                        return new Error(
                            InvalidSegmentMetadataCode,
                            "segment rawDurationMs must be >= durationMs.");
                    }

                    if (segment.TryGetProperty("mimeType", out var mimeNode) &&
                        mimeNode.ValueKind == JsonValueKind.String &&
                        !string.IsNullOrWhiteSpace(normalizedAudioMime))
                    {
                        var segmentMime = NormalizeMimeType(mimeNode.GetString());
                        if (!string.IsNullOrWhiteSpace(segmentMime) &&
                            !string.Equals(segmentMime, normalizedAudioMime, StringComparison.OrdinalIgnoreCase))
                        {
                            return new Error(
                                InvalidSegmentMetadataCode,
                                "segmentMetadata mimeType does not match request audio mime type.");
                        }
                    }
                }
            }

            return null;
        }
        catch (JsonException)
        {
            return new Error(InvalidSegmentMetadataCode, "segmentMetadata is not valid JSON.");
        }
    }

    private static int? TryReadNonNegativeInt(JsonElement source, string propertyName)
    {
        if (!source.TryGetProperty(propertyName, out var valueNode))
        {
            return null;
        }

        int? parsed = valueNode.ValueKind switch
        {
            JsonValueKind.Number when valueNode.TryGetInt32(out var numeric) => numeric,
            JsonValueKind.String when int.TryParse(valueNode.GetString(), out var stringValue) => stringValue,
            _ => null
        };

        if (parsed is null or < 0)
        {
            return null;
        }

        return parsed.Value;
    }

    private static int? TryReadPositiveInt(JsonElement source, string propertyName)
    {
        var value = TryReadNonNegativeInt(source, propertyName);
        return value is > 0 ? value : null;
    }

    private static string? NormalizeMimeType(string? mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return null;
        }

        var normalized = mimeType.Trim().ToLowerInvariant();
        var separator = normalized.IndexOf(';');
        if (separator > 0)
        {
            normalized = normalized[..separator];
        }

        return normalized;
    }

    private static string BuildDeterministicFallbackIdempotencyKey(Guid userId, ParseVoiceHttpRequest request)
    {
        if (!string.IsNullOrWhiteSpace(request.RequestPayloadHash))
        {
            var normalizedHash = request.RequestPayloadHash.Trim().ToLowerInvariant();
            if (normalizedHash.Length == 64)
            {
                return normalizedHash;
            }
        }

        var seed = string.Join("|",
            userId,
            request.FarmId,
            request.PlotId,
            request.CropCycleId,
            request.TextTranscript?.Trim(),
            request.AudioBase64?.Trim(),
            request.AudioMimeType?.Trim(),
            request.InputSpeechDurationMs,
            request.InputRawDurationMs,
            request.SegmentMetadataJson?.Trim());

        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(seed));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static bool TryValidateAudioFile(IFormFile file, out string error)
    {
        if (!IsAllowedMimeType(file.ContentType, AllowedAudioMimeTypes))
        {
            error = "Unsupported audio mime type.";
            return false;
        }

        if (file.Length <= 0)
        {
            error = "Audio file is empty.";
            return false;
        }

        if (file.Length > MaxAudioPayloadBytes)
        {
            error = $"Audio payload too large. Max {MaxAudioPayloadBytes / (1024 * 1024)} MB.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    private static bool TryValidateImageFile(IFormFile file, out string error)
    {
        if (!IsAllowedMimeType(file.ContentType, AllowedImageMimeTypes))
        {
            error = "Unsupported image mime type.";
            return false;
        }

        if (file.Length <= 0)
        {
            error = "Image file is empty.";
            return false;
        }

        if (file.Length > MaxImagePayloadBytes)
        {
            error = $"Image payload too large. Max {MaxImagePayloadBytes / (1024 * 1024)} MB.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    private static bool TryValidateBase64Payload(string base64Payload, int maxBytes, out string error)
    {
        var normalized = base64Payload.Trim();
        var commaIndex = normalized.IndexOf(',');
        if (commaIndex >= 0 && commaIndex < normalized.Length - 1)
        {
            normalized = normalized[(commaIndex + 1)..];
        }

        if (string.IsNullOrWhiteSpace(normalized))
        {
            error = "audioBase64 is empty.";
            return false;
        }

        var maxBase64Length = ((maxBytes + 2) / 3) * 4;
        if (normalized.Length > maxBase64Length + 8)
        {
            error = $"Audio payload too large. Max {maxBytes / (1024 * 1024)} MB.";
            return false;
        }

        try
        {
            var bytes = Convert.FromBase64String(normalized);
            if (bytes.Length > maxBytes)
            {
                error = $"Audio payload too large. Max {maxBytes / (1024 * 1024)} MB.";
                return false;
            }
        }
        catch (FormatException)
        {
            error = "audioBase64 is not valid base64.";
            return false;
        }

        error = string.Empty;
        return true;
    }

    private static bool IsAllowedMimeType(string? mimeType, IReadOnlySet<string> allowedMimeTypes)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return false;
        }

        // Strip codec parameters (e.g. "audio/webm;codecs=opus" → "audio/webm")
        // before checking against the allowlist, because browsers report full MIME
        // types with codec suffixes that we don't need to enumerate explicitly.
        var normalized = NormalizeMimeType(mimeType);
        return normalized is not null && allowedMimeTypes.Contains(normalized);
    }


    private static object ToConfigResponse(AiProviderConfig config)
    {
        return new
        {
            config.Id,
            defaultProvider = config.DefaultProvider.ToString(),
            config.FallbackEnabled,
            config.IsAiProcessingDisabled,
            config.MaxRetries,
            config.CircuitBreakerThreshold,
            config.CircuitBreakerResetSeconds,
            config.VoiceConfidenceThreshold,
            config.ReceiptConfidenceThreshold,
            voiceProvider = config.VoiceProvider?.ToString(),
            receiptProvider = config.ReceiptProvider?.ToString(),
            pattiProvider = config.PattiProvider?.ToString(),
            config.ModifiedAtUtc,
            config.ModifiedByUserId
        };
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static IResult UnexpectedNullResult(string operation)
    {
        return Results.StatusCode(StatusCodes.Status500InternalServerError);
    }
}

public sealed record ParseVoiceInputRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string? TextTranscript,
    string? AudioBase64,
    string? AudioMimeType,
    string? IdempotencyKey,
    string? ContextJson,
    int? InputSpeechDurationMs,
    int? InputRawDurationMs,
    string? SegmentMetadataJson,
    string? RequestPayloadHash);

public sealed record UpdateAiProviderConfigRequest(
    AiProviderType? DefaultProvider,
    bool? FallbackEnabled,
    bool? IsAiProcessingDisabled,
    int? MaxRetries,
    int? CircuitBreakerThreshold,
    int? CircuitBreakerResetSeconds,
    decimal? VoiceConfidenceThreshold,
    decimal? ReceiptConfidenceThreshold,
    AiProviderType? VoiceProvider,
    AiProviderType? ReceiptProvider,
    AiProviderType? PattiProvider);

internal sealed record ParseVoiceHttpRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string? TextTranscript,
    string? AudioBase64,
    string? AudioMimeType,
    string? IdempotencyKey,
    string? ContextJson,
    int? InputSpeechDurationMs,
    int? InputRawDurationMs,
    string? SegmentMetadataJson,
    string? RequestPayloadHash);
