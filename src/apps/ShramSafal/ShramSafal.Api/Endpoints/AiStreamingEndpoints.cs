using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using ShramSafal.Application.Contracts.Dtos;
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
        if (!EndpointActorContext.TryGetUserId(user, out _))
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

        var ctx = request.Context ?? EmptyContext;

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
}

public sealed record ParseVoiceStreamRequest(
    string Transcript,
    VoiceParseContext? Context,
    string? ScenarioId);
