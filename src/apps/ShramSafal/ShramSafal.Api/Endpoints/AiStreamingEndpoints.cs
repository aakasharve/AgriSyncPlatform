using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Api.Endpoints;

// Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.5) — SSE endpoint that streams
// ParseStreamEvent values as Gemini emits partial JSON. Lives next to
// MapAiEndpoints so it inherits the same /shramsafal/ai/* prefix and the same
// rate-limit + auth posture as the production parse-voice route.
//
// Flag-gating happens client-side (DEFAULT_VOICE_CONFIG.useStreamingParse) so
// the endpoint is always reachable; if the client's flag is off it simply
// keeps calling /ai/voice-parse instead.
public static class AiStreamingEndpoints
{
    private static readonly JsonSerializerOptions SseSerializerOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    private static readonly VoiceParseContext EmptyContext = new(
        AvailableCrops: new List<CropInfo>(),
        Profile: new FarmerProfileInfo(
            Motors: new List<MotorInfo>(),
            WaterResources: new List<WaterResourceInfo>(),
            Machineries: new List<MachineryInfo>(),
            LedgerDefaults: null),
        FarmContext: null,
        FocusCategory: null,
        VocabDb: null);

    public static RouteGroupBuilder MapAiStreamingEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/ai/parse-voice-stream", HandleParseVoiceStreamAsync)
            .WithName("ParseVoiceStream")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        return group;
    }

    private static async Task HandleParseVoiceStreamAsync(
        ParseVoiceStreamRequest? request,
        ClaimsPrincipal user,
        IAiOrchestrator orchestrator,
        HttpContext httpContext,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (request is null || string.IsNullOrWhiteSpace(request.Transcript))
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new { error = "ShramSafal.InvalidCommand", message = "transcript is required." },
                ct);
            return;
        }

        // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 — establish
        // the tenant scope BEFORE the orchestrator runs. ParseVoiceStreamAsync's
        // first DB touch is AiJobRepository.GetProviderConfigAsync, which goes
        // through TenantConnectionInterceptor; with no tenant claim it
        // fail-closes ("no tenant claim set and not in admin scope") → 500. This
        // route is NOT on the middleware skip-list (it may persist farm-scoped
        // rows once the streaming-confirm pipeline lands), so we set the claim
        // here, mirroring the batch /ai/voice-parse contract.
        //
        //   • farmId present → EstablishForCallerAsync validates membership
        //     (the 403 isolation gate) and sets the single-farm GUCs so any
        //     farm-scoped read/write under this request is isolated.
        //   • farmId absent (legacy client not yet sending it) → the stream
        //     only reads the platform-global AiProviderConfig, so admin-elevate
        //     to clear the interceptor's fail-closed guard. No farm GUC is set;
        //     no farm-scoped data is reachable, so isolation is preserved.
        //
        // This MUST run inside the per-request transaction that
        // TenantTransactionMiddleware opened (the GUCs are tx-local); the SSE
        // body is written inside that same tx and commits on completion.
        //
        // The tenancy services are resolved optionally: in production both are
        // always DI-registered (AddShramSafalInfrastructure), so the real path
        // runs. A bare in-memory harness that wires neither (no tenancy stack,
        // no relational DbContext, stubbed orchestrator) simply skips scoping —
        // there is no interceptor to fail-closed and no farm data to isolate.
        var tenantContext = httpContext.RequestServices.GetService<TenantContext>();
        if (request.FarmId is { } farmId && farmId != Guid.Empty)
        {
            var tenantScope = httpContext.RequestServices.GetService<ICallerFarmTenantScope>();
            if (tenantScope is not null)
            {
                var scopeResult = await tenantScope.EstablishForCallerAsync(farmId, userId, ct);
                if (!scopeResult.IsSuccess)
                {
                    httpContext.Response.StatusCode = MapErrorStatusCode(scopeResult.Error);
                    await httpContext.Response.WriteAsJsonAsync(
                        new { error = scopeResult.Error.Code, message = scopeResult.Error.Description },
                        ct);
                    return;
                }
            }
        }
        else if (tenantContext is not null && !tenantContext.IsAdminCrossTenant)
        {
            // Global-config-only path: elevate so the provider-config read does
            // not fail-closed. ElevateToAdminCrossTenant is a no-op-safe entry
            // when no single-tenant claim was set in this scope.
            tenantContext.ElevateToAdminCrossTenant();
        }

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — thread
        // the client-supplied recordedAt onto the VoiceParseContext so
        // the streaming structurer's {{captured_at}} placeholder
        // resolves against the real recording moment (matches the
        // non-streaming /ai/voice-parse contract). Missing → null →
        // prompt substitutes "unknown".
        var ctxBase = request.Context ?? EmptyContext;
        var ctx = ctxBase with { CapturedAtUtc = NormalizeToUtc(request.RecordedAt) };

        httpContext.Response.Headers["Content-Type"] = "text/event-stream";
        httpContext.Response.Headers["Cache-Control"] = "no-cache";
        // Disable proxy buffering (nginx, CDN); SSE relies on prompt flush.
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";

        await foreach (var evt in orchestrator.ParseVoiceStreamAsync(
            request.Transcript, ctx, request.ScenarioId, ct))
        {
            var json = JsonSerializer.Serialize(evt, SseSerializerOptions);
            await httpContext.Response.WriteAsync($"data: {json}\n\n", ct);
            await httpContext.Response.Body.FlushAsync(ct);
        }
    }

    // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 — map a
    // tenant-scope Result.Failure to the matching HTTP status BEFORE the SSE
    // body starts (a forged/foreign farmId → 403; empty ids → 400). Mirrors
    // the ErrorKind→status mapping AiEndpoints.ToErrorResult uses.
    private static int MapErrorStatusCode(Error error) => error.Kind switch
    {
        ErrorKind.Validation => StatusCodes.Status400BadRequest,
        ErrorKind.NotFound => StatusCodes.Status404NotFound,
        ErrorKind.Conflict => StatusCodes.Status409Conflict,
        ErrorKind.Forbidden => StatusCodes.Status403Forbidden,
        ErrorKind.Unauthenticated => StatusCodes.Status401Unauthorized,
        _ => StatusCodes.Status500InternalServerError,
    };

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — coerce a
    // bound DateTime? into UTC. System.Text.Json may produce
    // Unspecified/Local depending on the wire format; the structurer
    // prompt's ToString("o") would then emit the wrong offset. Mirrors
    // the same helper in AiEndpoints.cs for the multipart path.
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
}

public sealed record ParseVoiceStreamRequest(
    string Transcript,
    VoiceParseContext? Context,
    string? ScenarioId,
    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — Option B
    // capturedAt = recordedAt. ISO-8601 UTC when present; null when the
    // client omits it (legacy/orphan). Threaded into
    // VoiceParseContext.CapturedAtUtc so the structurer prompt's
    // {{captured_at}} placeholder reflects when the farmer recorded
    // rather than the server's request-receipt time.
    DateTime? RecordedAt = null,
    // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 — the
    // caller's farm. OPTIONAL-tolerant: present → the handler establishes
    // the membership-validated single-farm tenant scope (matches the batch
    // /ai/voice-parse contract) so any farm-scoped read/write is isolated and
    // a forged farmId is rejected with 403; absent (legacy client not yet
    // sending it) → the handler admin-elevates for the global-config-only
    // read. Once the streaming client is updated to send farmId this becomes
    // the authorization gate for the streaming path too.
    Guid? FarmId = null);
