using System.Net.Mime;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.AI.CoVeReverify;
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
using ShramSafal.Infrastructure.Integrations.Gemini;

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

        // DATA_PRINCIPLE_SPINE sub-phase 05.1.2 — server-side Chain-of-Verification
        // re-query. Replaces the deleted browser-direct path in CoVeWrapper.ts.
        // Authentication is required (mirror of /ai/voice-parse); the handler
        // runs the same PaidFeature.AiParse entitlement gate before calling
        // Gemini, so worker accounts with no AI entitlement see Forbidden.
        group.MapPost("/ai/cove-reverify", HandleCoVeReverifyAsync)
            .WithName("CoVeReverify")
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
            IOptions<GeminiOptions> geminiOptions,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var config = await repository.GetProviderConfigAsync(ct);
            return Results.Ok(ToConfigResponse(config, geminiOptions.Value));
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

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row. UpdateProviderConfig is an
            // admin operation but still runs inside an HTTP request, so we
            // use the normal HttpContext.AuditClaims() path (not the
            // WorkerClaims() sentinel reserved for background services).
            var (auditDeviceId, auditIpHash) = http.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(http);

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
                    request.PattiProvider,
                    ClientAppVersion: clientAppVersion,
                    AuditDeviceId: auditDeviceId,
                    AuditIpHash: auditIpHash),
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
        ICallerFarmTenantScope scope,
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

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope before the handler writes ssf.ai_jobs.
        var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
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
        ICallerFarmTenantScope scope,
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

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope before the handler writes ssf.ai_jobs.
        var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
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

    // DATA_PRINCIPLE_SPINE sub-phase 05.1.2 — CoVe endpoint dispatcher.
    // Mirrors the X-App-Version header capture + httpContext.AuditClaims()
    // forensic-provenance pattern used by /ai/config (UpdateProviderConfig)
    // so the AuditEvent row carries device id + IP hash + app version
    // without the handler reaching into HttpContext itself.
    private static async Task<IResult> HandleCoVeReverifyAsync(
        HttpContext httpContext,
        CoVeReverifyRequest request,
        CoVeReverifyHandler handler,
        ICallerFarmTenantScope scope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (request is null)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "CoVe request body is required."
            });
        }

        if (request.FarmId == Guid.Empty)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "farmId is required."
            });
        }

        if (string.IsNullOrWhiteSpace(request.Transcript))
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.MissingVoiceTranscript.Code,
                message = "transcript is required."
            });
        }

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope before the handler writes ssf.ai_jobs.
        var scopeResult = await scope.EstablishForCallerAsync(request.FarmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
        }

        // Parsed JSON arrives as a JsonElement so the client can send the
        // structured parse without re-serializing to a string. We hand the
        // handler the raw JSON text — the handler is the one that decides
        // how to compact and feed it to the model.
        string parsedJson;
        if (request.Parsed.ValueKind == JsonValueKind.Undefined ||
            request.Parsed.ValueKind == JsonValueKind.Null)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "parsed object is required."
            });
        }

        parsedJson = request.Parsed.GetRawText();

        var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
        var clientAppVersion = ResolveClientAppVersion(httpContext);

        var command = new CoVeReverifyCommand(
            UserId: userId,
            FarmId: request.FarmId,
            Transcript: request.Transcript,
            ParsedJson: parsedJson,
            SourceAiJobId: request.SourceAiJobId,
            ClientAppVersion: clientAppVersion,
            ActorRole: EndpointActorContext.GetActorRole(httpContext.User),
            AuditDeviceId: auditDeviceId,
            AuditIpHash: auditIpHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        var payload = result.Value!;
        return Results.Ok(new
        {
            verificationScore = payload.VerificationScore,
            lowConfidence = payload.LowConfidence,
            demotionReason = payload.DemotionReason,
        });
    }

    private static async Task<IResult> HandleVoiceParseAsync(
        HttpRequest httpRequest,
        ClaimsPrincipal user,
        ParseVoiceInputHandler handler,
        IAiJobRepository aiJobRepository,
        ICallerFarmTenantScope scope,
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

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — establish the
        // membership-validated single-farm tenant scope BEFORE the handler runs
        // so the farm-scoped reads AND the ssf.ai_jobs WITH-CHECK write pass
        // under prod FORCE-RLS. A forged farmId the caller is not a member of
        // returns Forbidden here (mapped to 403 by ToErrorResult) with no farm
        // GUC ever set. This is the sole authorization gate for voice.
        var scopeResult = await scope.EstablishForCallerAsync(parsed.FarmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
        }

        var effectiveIdempotencyKey = string.IsNullOrWhiteSpace(parsed.IdempotencyKey)
            ? BuildDeterministicFallbackIdempotencyKey(userId, parsed)
            : parsed.IdempotencyKey;

        // DATA_PRINCIPLE_SPINE sub-phase 01.4 — capture the client app version
        // from the X-App-Version header (fallback "unknown") and thread it
        // into the voice parse command so the AiJob's Provenance carries the
        // real client version that emitted this parse. Sub-phase 01.5 will
        // surface jobId + prompt metadata on the response so the frontend can
        // pass them back at Confirm-time; here we only capture the input side.
        var headerAppVersion = httpRequest.Headers["X-App-Version"].FirstOrDefault();
        var clientAppVersion = string.IsNullOrWhiteSpace(headerAppVersion)
            ? "unknown"
            : headerAppVersion!.Trim();

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
            parsed.RequestPayloadHash,
            clientAppVersion,
            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix
            // (capturedAt = recordedAt, Option B). The form/json field
            // `recorded_at` / `recordedAt` is parsed in
            // ParseVoiceRequestAsync; missing → null; unparseable already
            // 400-rejected upstream. From here the value flows into
            // AiOrchestrator.ParseVoiceTwoStageAsync(capturedAtUtc:) and
            // ultimately the structurer prompt's {{captured_at}} token.
            RecordedAtUtc: parsed.RecordedAtUtc);

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
        // jobId (legacy) and sourceAiJobId (spine) both emitted from the same
        // AiJob.Id. Phase 01.5 forward-declares sourceAiJobId for downstream
        // spine consumers (CreateDailyLog at user-Confirm); jobId stays for
        // existing API consumers.
        return Results.Ok(new
        {
            success = true,
            parsedLog = parseResult.ParsedLog,
            confidence = parseResult.Confidence,
            fieldConfidences = parseResult.FieldConfidences,
            suggestedAction = parseResult.SuggestedAction,
            modelUsed = parseResult.ModelUsed,
            promptVersion = parseResult.PromptVersion,
            providerUsed = parseResult.ProviderUsed,
            fallbackUsed = parseResult.FallbackUsed,
            latencyMs = parseResult.LatencyMs,
            validationOutcome = parseResult.ValidationOutcome,
            jobId = job?.Id,

            // === DATA_PRINCIPLE_SPINE sub-phase 01.5 additions ===
            sourceAiJobId = job?.Id,                              // alias of jobId for spine consumers
            promptContentHash = parseResult.PromptContentHash,    // 64-char SHA-256 from 01.2
            appVersion = clientAppVersion,                        // from X-App-Version header (captured above)
            rawInputRef = job?.RawInputRef                        // null in Phase 01; Phase 02 populates
        });
    }

    private static async Task<IResult> HandleReceiptExtractAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        ExtractReceiptHandler handler,
        ICallerFarmTenantScope scope,
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

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope before the handler writes ssf.ai_jobs.
        var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
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
        ICallerFarmTenantScope scope,
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

        // spec: voice-tenant-claim-caller-farm-2026-06-08 — membership-validated
        // single-farm tenant scope before the handler writes ssf.ai_jobs.
        var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
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
                return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", "farmId is required."));
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
                    return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", audioValidationError));
                }

                await using var stream = audioFile.OpenReadStream();
                await using var memory = new MemoryStream();
                await stream.CopyToAsync(memory, ct);
                audioBase64 = Convert.ToBase64String(memory.ToArray());
                mimeType = audioFile.ContentType;
            }
            else if (string.IsNullOrWhiteSpace(textTranscript))
            {
                return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", "textTranscript or audio is required."));
            }

            var segmentMetadataValidation = ValidateSegmentMetadata(segmentMetadataJson, mimeType, speechDuration, rawDuration);
            if (segmentMetadataValidation is not null)
            {
                return Result.Failure<ParseVoiceHttpRequest>(segmentMetadataValidation);
            }

            // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix —
            // multipart form field `recorded_at`. Empty/missing → null
            // (legacy client backward compat); present but unparseable →
            // 400 so the bug surfaces early instead of silently producing
            // a wrong "काल" resolution.
            var recordedAtRaw = form["recorded_at"].ToString();
            var recordedAtParse = TryParseRecordedAtUtc(recordedAtRaw);
            if (!recordedAtParse.IsSuccess)
            {
                return Result.Failure<ParseVoiceHttpRequest>(recordedAtParse.Error);
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
                requestPayloadHash,
                RecordedAtUtc: recordedAtParse.Value));
        }

        var jsonRequest = await request.ReadFromJsonAsync<ParseVoiceInputRequest>(cancellationToken: ct);
        if (jsonRequest is null)
        {
            return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", "Invalid JSON payload."));
        }

        if (string.IsNullOrWhiteSpace(jsonRequest.TextTranscript) &&
            string.IsNullOrWhiteSpace(jsonRequest.AudioBase64))
        {
            return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", "textTranscript or audioBase64 is required."));
        }

        if (!string.IsNullOrWhiteSpace(jsonRequest.AudioBase64))
        {
            if (!IsAllowedMimeType(jsonRequest.AudioMimeType, AllowedAudioMimeTypes))
            {
                return Result.Failure<ParseVoiceHttpRequest>(
                    Error.Validation("ShramSafal.InvalidCommand", "Unsupported audio mime type."));
            }

            if (!TryValidateBase64Payload(jsonRequest.AudioBase64, MaxAudioPayloadBytes, out var base64ValidationError))
            {
                return Result.Failure<ParseVoiceHttpRequest>(Error.Validation("ShramSafal.InvalidCommand", base64ValidationError));
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

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — JSON
        // callers may send recordedAt; System.Text.Json bound it to
        // DateTime?. We only need to normalize it to UTC for the prompt
        // substitution. Unlike multipart strings, this branch cannot
        // hit the unparseable case (model-bound DateTime? rejects bad
        // input at deserialization with a 400 from the framework).
        var jsonRecordedAtUtc = NormalizeToUtc(jsonRequest.RecordedAt);

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
            jsonRequest.RequestPayloadHash,
            RecordedAtUtc: jsonRecordedAtUtc));
    }

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — parse the
    // multipart `recorded_at` string into DateTime? (UTC) with a strict
    // contract:
    //   • null / empty / whitespace → success(null) — legacy backward compat
    //   • parseable ISO-8601 → success(UTC DateTime)
    //   • anything else → failure (caller returns 400)
    //
    // We accept ISO-8601 with offset (e.g. "2026-05-22T18:34:51.123Z" or
    // "2026-05-22T23:34:51+05:00") and normalize to UTC. Local-kind
    // values (no offset) are rejected because the server cannot infer
    // the farmer's timezone safely — the contract requires UTC.
    private static Result<DateTime?> TryParseRecordedAtUtc(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return Result.Success<DateTime?>(null);
        }

        var trimmed = raw.Trim();
        if (!DateTimeOffset.TryParse(
            trimmed,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out var parsed))
        {
            return Result.Failure<DateTime?>(Error.Validation(
                "ShramSafal.InvalidCommand",
                "recorded_at must be a valid ISO-8601 UTC timestamp."));
        }

        return Result.Success<DateTime?>(parsed.UtcDateTime);
    }

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — System.Text.Json
    // can land a DateTime in Unspecified/Local kind depending on the
    // payload. The orchestrator's structurer prompt substitutes
    // `.ToString("o")`, so passing a Local-kind value through would
    // serialize the wrong offset into {{captured_at}}. Coerce to UTC.
    private static DateTime? NormalizeToUtc(DateTime? value)
    {
        if (!value.HasValue)
        {
            return null;
        }

        return value.Value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.Value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value.Value, DateTimeKind.Utc),
        };
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
            return Error.Validation("ShramSafal.InvalidCommand", "Duration values cannot be negative.");
        }

        if (speechDurationMs > MaxVoiceSessionDurationMs || rawDurationMs > MaxVoiceSessionDurationMs)
        {
            return Error.Validation(
                "ShramSafal.InvalidCommand",
                $"Voice duration exceeds allowed ceiling of {MaxVoiceSessionDurationMs}ms.");
        }

        if (speechDurationMs.HasValue && rawDurationMs.HasValue && rawDurationMs.Value < speechDurationMs.Value)
        {
            return Error.Validation("ShramSafal.InvalidCommand", "inputRawDurationMs must be >= inputSpeechDurationMs.");
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
            return Error.Validation(InvalidSegmentMetadataCode, "segmentMetadata payload is too large.");
        }

        try
        {
            using var document = JsonDocument.Parse(segmentMetadataJson);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Error.Validation(InvalidSegmentMetadataCode, "segmentMetadata must be a JSON object.");
            }

            var totalSegments = TryReadPositiveInt(root, "totalSegments");
            if (totalSegments is <= 0 or > MaxVoiceSegmentsPerSession)
            {
                return Error.Validation(
                    InvalidSegmentMetadataCode,
                    $"totalSegments must be between 1 and {MaxVoiceSegmentsPerSession}.");
            }

            var totalSpeechDurationMs = TryReadNonNegativeInt(root, "totalSpeechDurationMs");
            var totalRawDurationMs = TryReadNonNegativeInt(root, "totalRawDurationMs");
            if (totalSpeechDurationMs is > MaxVoiceSessionDurationMs ||
                totalRawDurationMs is > MaxVoiceSessionDurationMs)
            {
                return Error.Validation(
                    InvalidSegmentMetadataCode,
                    $"segmentMetadata durations must be <= {MaxVoiceSessionDurationMs}ms.");
            }

            if (totalSpeechDurationMs.HasValue &&
                totalRawDurationMs.HasValue &&
                totalRawDurationMs.Value < totalSpeechDurationMs.Value)
            {
                return Error.Validation(
                    InvalidSegmentMetadataCode,
                    "segmentMetadata totalRawDurationMs must be >= totalSpeechDurationMs.");
            }

            // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 — the
            // duration totals are ADVISORY observability fields, not
            // authorization- or correctness-relevant. A real browser/mobile
            // recording derives the form `inputSpeechDurationMs` and the
            // segmentMetadata totals from two SLIGHTLY different sources (the
            // recorder's reported duration vs a decode/round of the compressed
            // Opus blob), so they can drift by a few ms and previously
            // 400-rejected genuine user audio on a reconciliation technicality.
            // We no longer reject on exact-match drift here; the internal
            // sanity checks above (non-negative, <= ceiling, raw >= speech)
            // remain fatal so genuinely-malformed metadata is still caught.
            // Reproduced on prod 2026-06-10 (form=500 vs metadata=512 → 400
            // "totalSpeechDurationMs must match inputSpeechDurationMs").

            if (root.TryGetProperty("segments", out var segmentsElement))
            {
                if (segmentsElement.ValueKind != JsonValueKind.Array)
                {
                    return Error.Validation(InvalidSegmentMetadataCode, "segmentMetadata.segments must be an array.");
                }

                var segmentCount = segmentsElement.GetArrayLength();
                if (segmentCount > MaxVoiceSegmentsPerSession)
                {
                    return Error.Validation(
                        InvalidSegmentMetadataCode,
                        $"segmentMetadata.segments exceeds {MaxVoiceSegmentsPerSession} entries.");
                }

                // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 —
                // reconciliation-only check relaxed (advisory, see duration
                // note above). The hard segment-count ceiling above stays
                // fatal; an exact segments-array length vs totalSegments
                // mismatch no longer rejects real user audio.

                // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 —
                // the per-segment mimeType vs request-audio mimeType check was
                // removed (advisory only): browsers report the merged upload as
                // e.g. "audio/webm;codecs=opus" while a segment may record the
                // pre-merge container, and the codec-param normalize does not
                // always converge — it rejected real recordings on a MIME-label
                // technicality. Structural + ceiling checks below stay fatal.
                foreach (var segment in segmentsElement.EnumerateArray())
                {
                    if (segment.ValueKind != JsonValueKind.Object)
                    {
                        return Error.Validation(InvalidSegmentMetadataCode, "Each segment entry must be an object.");
                    }

                    var segmentDurationMs = TryReadNonNegativeInt(segment, "durationMs");
                    var segmentRawDurationMs = TryReadNonNegativeInt(segment, "rawDurationMs");
                    if (segmentDurationMs is > MaxVoiceSegmentDurationMs ||
                        segmentRawDurationMs is > MaxVoiceSegmentDurationMs)
                    {
                        return Error.Validation(
                            InvalidSegmentMetadataCode,
                            $"Segment duration must be <= {MaxVoiceSegmentDurationMs}ms.");
                    }

                    if (segmentDurationMs.HasValue &&
                        segmentRawDurationMs.HasValue &&
                        segmentRawDurationMs.Value < segmentDurationMs.Value)
                    {
                        return Error.Validation(
                            InvalidSegmentMetadataCode,
                            "segment rawDurationMs must be >= durationMs.");
                    }
                }
            }

            return null;
        }
        catch (JsonException)
        {
            return Error.Validation(InvalidSegmentMetadataCode, "segmentMetadata is not valid JSON.");
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


    private static object ToConfigResponse(AiProviderConfig config, GeminiOptions? geminiOptions = null)
    {
        var structurerModelId = geminiOptions?.StructurerModelId;
        var ocrModelId = geminiOptions?.OcrModelId;
        var voiceFallbackModelId = geminiOptions?.VoiceFallbackModelId;

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
            resolvedVoiceProvider = config.GetProviderForOperation(AiOperationType.VoiceToStructuredLog).ToString(),
            resolvedReceiptProvider = config.GetProviderForOperation(AiOperationType.ReceiptToExpenseItems).ToString(),
            resolvedPattiProvider = config.GetProviderForOperation(AiOperationType.PattiImageToSaleData).ToString(),
            geminiModelId = string.IsNullOrWhiteSpace(structurerModelId) ? GeminiOptions.DefaultStructurerModelId : structurerModelId.Trim(),
            geminiStructurerModelId = string.IsNullOrWhiteSpace(structurerModelId) ? GeminiOptions.DefaultStructurerModelId : structurerModelId.Trim(),
            geminiOcrModelId = string.IsNullOrWhiteSpace(ocrModelId) ? GeminiOptions.DefaultOcrModelId : ocrModelId.Trim(),
            geminiVoiceFallbackModelId = string.IsNullOrWhiteSpace(voiceFallbackModelId) ? GeminiOptions.DefaultVoiceFallbackModelId : voiceFallbackModelId.Trim(),
            config.ModifiedAtUtc,
            config.ModifiedByUserId
        };
    }

    /// <summary>
    /// Sub-plan 03 bridge: route status code through <c>ErrorKind</c>
    /// rather than pattern-matching on <c>Error.Code</c> string suffixes.
    /// Body shape (<c>{error, message}</c>) is preserved verbatim because
    /// the AI tests + the mobile-web SDK depend on it; switching to
    /// RFC 7807 is a follow-up contract change.
    /// </summary>
    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            // Forbidden/Unauthenticated keep the {error, message} body
            // so farmer-facing UI can render the right Marathi message
            // off `error.Code`. Plain Results.Forbid() / Results.Unauthorized()
            // would return empty bodies, which existing clients (incl.
            // T-IGH-03 entitlement-denied tests) rely on.
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Validation => Results.BadRequest(body),
            // Pre-Sub-plan-03 fallback (preserves test contract):
            // Internal-classified errors and any unmapped kind keep
            // the historical 400 + {error, message} shape.
            _ => Results.BadRequest(body),
        };
    }

    private static IResult UnexpectedNullResult(string operation)
    {
        return Results.StatusCode(StatusCodes.Status500InternalServerError);
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring
    // the sub-phase 01.4 fallback used by the voice-parse endpoint above.
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
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
    string? RequestPayloadHash,
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — JSON callers
    // (parseVoice / parseTextLog) post `recordedAt` so the 2-stage
    // structurer can resolve "काल"/"आज" against the true capture instant
    // rather than the request-receipt timestamp. ISO-8601 UTC.
    DateTime? RecordedAt = null);

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

// spec: data-principle-spine-2026-05-05/05.1
//
// Wire shape for POST /shramsafal/ai/cove-reverify. `Parsed` is a JsonElement
// rather than a string so the client can post the structured parse directly
// from `agriSyncClient.coveReverify({transcript, parsed})` without round-
// tripping through JSON.stringify on the wire; the server keeps the raw text
// via GetRawText() and forwards it to the handler verbatim.
public sealed record CoVeReverifyRequest(
    Guid FarmId,
    string Transcript,
    JsonElement Parsed,
    Guid? SourceAiJobId);

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
    string? RequestPayloadHash,
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — parsed from
    // multipart form field `recorded_at` OR JSON property `recordedAt`.
    // ISO-8601 UTC; null when the client did not send the field
    // (legacy/orphan clips). Backward-compatible default avoids breaking
    // pre-fix clients.
    DateTime? RecordedAtUtc = null);
