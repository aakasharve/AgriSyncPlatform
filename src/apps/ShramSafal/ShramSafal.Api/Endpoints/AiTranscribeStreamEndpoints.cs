using System.Net.Mime;
using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.AI;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.3 — SSE endpoint that
/// streams partial + final transcripts as Sarvam Saaras V3 produces them.
/// Sits next to <see cref="AiStreamingEndpoints"/> (parse-voice-stream
/// from VOICE_LATENCY_PIPELINE_V2 §7 Task 3.4) so the cohort can pivot
/// from "audio → JSON in one call" to "audio → transcript → JSON" by
/// flipping which endpoint the client calls.
///
/// <para>
/// Flow:
/// <list type="number">
/// <item>Read multipart audio + language_hint + mode from the request.</item>
/// <item>Pipe bytes through <see cref="IAudioTranscoder.ToPcm16kMonoAsync"/>
///       (Task 2.3a) to decode browser/mobile audio → mono PCM 16 kHz.</item>
/// <item>Pipe PCM into <see cref="ITranscriberProvider.TranscribeStreamAsync"/>;
///       forward each yielded chunk as <c>transcript_partial</c> SSE.</item>
/// <item>Emit one <c>transcript_final</c> event with the assembled full
///       transcript once the stream completes.</item>
/// <item>On any exception, emit <c>error</c> and close the stream.</item>
/// </list>
/// </para>
///
/// <para>
/// Auth + tenancy. <c>[RequireAuthorization]</c> + the <c>ai</c>
/// rate-limiter policy. The userId resolved from the JWT is used only for
/// entitlement checks. This route is farm-AGNOSTIC: it reads ONLY the
/// global <c>AiProviderConfig</c> and never touches a farm-scoped table,
/// so it carries no tenant claim. spec:
/// voice-stream-tenant-and-lenient-metadata-2026-06-10 added
/// <c>/shramsafal/ai/transcribe-stream</c> to the
/// <c>TenantTransactionMiddleware</c> skip-list, which admin-elevates the
/// request so the provider-config read does not fail-closed in
/// <c>TenantConnectionInterceptor</c> with "no tenant claim set". (The
/// prior claim here that the middleware "binds the set_config call
/// upstream" was FALSE for this route — no farm GUC is ever set.)
/// </para>
/// </summary>
public static class AiTranscribeStreamEndpoints
{
    private const int MaxAudioPayloadBytes = 12 * 1024 * 1024; // 12 MB — mirrors AiEndpoints' allowance.

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

    private static readonly JsonSerializerOptions SseSerializerOptions = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static RouteGroupBuilder MapAiTranscribeStreamEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/ai/transcribe-stream", HandleTranscribeStreamAsync)
            .WithName("TranscribeStream")
            .RequireRateLimiting("ai")
            .RequireAuthorization()
            .DisableAntiforgery();

        return group;
    }

    private static async Task HandleTranscribeStreamAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        IAudioTranscoder audioTranscoder,
        IEnumerable<ITranscriberProvider> transcribers,
        IAiJobRepository aiJobRepository,
        ILoggerFactory loggerFactory,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("AiTranscribeStream");
        if (!EndpointActorContext.TryGetUserId(user, out _))
        {
            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (!request.HasFormContentType)
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new { error = "ShramSafal.InvalidCommand", message = "multipart/form-data is required." },
                ct);
            return;
        }

        var form = await request.ReadFormAsync(ct);
        var audioFile = form.Files["audio"] ?? form.Files.FirstOrDefault();
        if (audioFile is null || audioFile.Length == 0)
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new { error = "ShramSafal.InvalidCommand", message = "audio is required." },
                ct);
            return;
        }

        if (!IsAllowedMimeType(audioFile.ContentType))
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new { error = "ShramSafal.InvalidCommand", message = "Unsupported audio mime type." },
                ct);
            return;
        }

        if (audioFile.Length > MaxAudioPayloadBytes)
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = $"Audio payload too large. Max {MaxAudioPayloadBytes / (1024 * 1024)} MB."
                },
                ct);
            return;
        }

        var languageHint = string.IsNullOrWhiteSpace(form["language_hint"])
            ? "mr-IN"
            : form["language_hint"].ToString().Trim();
        var mode = string.IsNullOrWhiteSpace(form["mode"])
            ? "codemix"
            : form["mode"].ToString().Trim();

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — accept
        // `recorded_at` for contract uniformity across the 3 voice
        // endpoints. transcribe-stream emits only a transcript today
        // (no structurer call → no {{captured_at}} substitution), so
        // we do not yet thread this into a downstream call. We DO
        // validate the field so a misformed value fails fast at 400
        // rather than silently shipping wrong data once a future client
        // pipes the transcript into parse-voice-stream with a separate
        // capturedAt.
        var recordedAtRaw = form["recorded_at"].ToString();
        if (!TryValidateRecordedAtUtc(recordedAtRaw, out _))
        {
            httpContext.Response.StatusCode = StatusCodes.Status400BadRequest;
            await httpContext.Response.WriteAsJsonAsync(
                new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "recorded_at must be a valid ISO-8601 UTC timestamp."
                },
                ct);
            return;
        }

        // Resolve the active transcriber from the live AiProviderConfig.
        // ParseProviderTypeOrDefault mirrors the orchestrator's helper; if
        // the configured provider type is not registered (e.g. Sarvam
        // adapter not wired), we 503 because the legacy single-call path
        // does NOT run through this endpoint — the client should fall
        // back to /ai/voice-parse instead.
        var config = await aiJobRepository.GetProviderConfigAsync(ct);
        var transcriberType = ParseProviderTypeOrDefault(config.TranscriberProvider, AiProviderType.Sarvam);
        var transcriberMap = transcribers
            .GroupBy(x => x.ProviderType)
            .ToDictionary(g => g.Key, g => g.First());

        if (!transcriberMap.TryGetValue(transcriberType, out var transcriber))
        {
            // voice-live-captions-2026-06-11: the configured TranscriberProvider
            // (default "Gemini", which drives the BATCH multimodal parse via
            // ParseVoiceTwoStageAsync's delegate-to-multimodal branch) has no
            // streaming-STT adapter. THIS endpoint is the live-caption streaming
            // flow, implemented only by Sarvam (SarvamStreamingSttClient). Fall
            // back to any registered ITranscriberProvider (Sarvam) rather than
            // 503 — decoupled from the global config so the proven batch parse
            // path is left entirely on the multimodal route.
            transcriber = transcriberMap.Values.FirstOrDefault();
            if (transcriber is null)
            {
                httpContext.Response.StatusCode = StatusCodes.Status503ServiceUnavailable;
                await httpContext.Response.WriteAsJsonAsync(
                    new
                    {
                        error = "ShramSafal.AiTranscribeUnavailable",
                        message = "No transcriber provider registered."
                    },
                    ct);
                return;
            }
        }

        // SSE headers. Must be set BEFORE any body write; the proxy hints
        // (X-Accel-Buffering=no) match the parse-voice-stream sibling so
        // nginx/ALB don't buffer our flushes.
        httpContext.Response.Headers["Content-Type"] = "text/event-stream";
        httpContext.Response.Headers["Cache-Control"] = "no-cache";
        httpContext.Response.Headers["X-Accel-Buffering"] = "no";

        // Stage 1 — decode browser audio into PCM via the audio transcoder
        // port. We buffer the PCM bytes into memory once because the
        // ITranscriberProvider.TranscribeStreamAsync contract takes a
        // Stream (not an IAsyncEnumerable). Buffering is bounded by the
        // 12 MB audio limit above; even at the worst case (2 min raw)
        // PCM at 16 kHz mono is ~3.8 MB.
        byte[] pcmBytes;
        try
        {
            await using var pcmBuffer = new MemoryStream();
            await using var sourceStream = audioFile.OpenReadStream();
            await foreach (var chunk in audioTranscoder
                .ToPcm16kMonoAsync(sourceStream, audioFile.ContentType ?? MediaTypeNames.Application.Octet, 16000, ct)
                .ConfigureAwait(false))
            {
                await pcmBuffer.WriteAsync(chunk, ct);
            }
            pcmBytes = pcmBuffer.ToArray();
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Client disconnect mid-transcode is normal — silently end.
            return;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[transcribe-stream] AudioTranscodeFailed (inMime={Mime})", audioFile.ContentType);
            await WriteEventAsync(httpContext, "error", new
            {
                code = "AudioTranscodeFailed",
                message = ex.Message,
            }, ct);
            return;
        }

        logger.LogInformation(
            "[transcribe-stream] transcoded {Bytes} PCM bytes (inMime={Mime}, transcriber={Provider})",
            pcmBytes.Length, audioFile.ContentType, transcriber.ProviderType);

        if (pcmBytes.Length == 0)
        {
            logger.LogWarning("[transcribe-stream] EmptyAudio — transcode produced 0 PCM bytes (inMime={Mime})", audioFile.ContentType);
            await WriteEventAsync(httpContext, "error", new
            {
                code = "EmptyAudio",
                message = "Audio decoded to zero PCM bytes.",
            }, ct);
            return;
        }

        // Stage 2 — feed PCM into the Sarvam streaming transcriber and
        // forward each partial transcript chunk as an SSE event.
        var assembled = new StringBuilder();
        var partialCount = 0;
        try
        {
            await using var pcmStream = new MemoryStream(pcmBytes, writable: false);
            // Mirror Sarvam's expected MIME for raw PCM bytes (see
            // SarvamStreamingSttClient.TryResolveAudioFormat — "audio/pcm"
            // is one of the accepted forms; the WAV codepath would require
            // a header that we are NOT prepending here).
            await foreach (var chunk in transcriber
                .TranscribeStreamAsync(pcmStream, "audio/pcm", languageHint, mode, ct)
                .ConfigureAwait(false))
            {
                if (string.IsNullOrEmpty(chunk))
                {
                    continue;
                }

                partialCount++;
                assembled.Append(chunk);
                await WriteEventAsync(httpContext, "transcript_partial", new { text = chunk }, ct);
            }
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            // Client disconnect → end without emitting an error event.
            return;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "[transcribe-stream] TranscribeStreamFailed (provider={Provider}, partialsSoFar={Partials})", transcriber.ProviderType, partialCount);
            await WriteEventAsync(httpContext, "error", new
            {
                code = "TranscribeStreamFailed",
                message = ex.Message,
            }, ct);
            return;
        }

        logger.LogInformation("[transcribe-stream] complete: {Partials} partials, transcriptLen={Len}", partialCount, assembled.Length);
        await WriteEventAsync(httpContext, "transcript_final", new { text = assembled.ToString() }, ct);
    }

    private static async Task WriteEventAsync(
        HttpContext httpContext,
        string eventName,
        object payload,
        CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(payload, SseSerializerOptions);
        // SSE wire format: `event: <name>\ndata: <json>\n\n` — two
        // newlines terminate the event. The parse-voice-stream sibling
        // emits only `data: ...\n\n`; here we emit named events so the
        // browser's EventSource.addEventListener(name, ...) hook fires
        // for partial vs final without parsing the data payload's
        // discriminator.
        await httpContext.Response.WriteAsync($"event: {eventName}\ndata: {json}\n\n", ct);
        await httpContext.Response.Body.FlushAsync(ct);
    }

    private static AiProviderType ParseProviderTypeOrDefault(string? raw, AiProviderType fallback)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return fallback;
        }

        return Enum.TryParse<AiProviderType>(raw.Trim(), ignoreCase: true, out var parsed)
            ? parsed
            : fallback;
    }

    // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 founder fix — strict parse
    // of multipart `recorded_at`. Empty/missing → ok (null), parseable
    // ISO-8601 → ok (UTC instant), otherwise reject so the bug surfaces
    // at the boundary. AssumeUniversal handles RFC-3339 with Z; offset
    // forms are normalized to UTC. Local-kind strings without offset
    // are rejected per the same contract used by AiEndpoints.cs.
    private static bool TryValidateRecordedAtUtc(string? raw, out DateTime? value)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            value = null;
            return true;
        }

        var trimmed = raw.Trim();
        if (!DateTimeOffset.TryParse(
            trimmed,
            System.Globalization.CultureInfo.InvariantCulture,
            System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
            out var parsed))
        {
            value = null;
            return false;
        }

        value = parsed.UtcDateTime;
        return true;
    }

    private static bool IsAllowedMimeType(string? mimeType)
    {
        if (string.IsNullOrWhiteSpace(mimeType))
        {
            return false;
        }

        var normalized = mimeType.Trim().ToLowerInvariant();
        var separator = normalized.IndexOf(';');
        if (separator > 0)
        {
            normalized = normalized[..separator];
        }

        return AllowedAudioMimeTypes.Contains(normalized);
    }
}
