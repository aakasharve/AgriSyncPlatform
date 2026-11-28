using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Claims;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.Services;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — <c>POST /shramsafal/ai/live-words</c>:
/// the words shown on the recording screen WHILE he speaks. The phone cuts what he has said into phrases at his pauses and sends
/// each one as it ends (one complete 16 kHz mono 16-bit WAV of at most 12 s, see <see cref="LiveWordsAudio"/>); this route answers
/// the words Sarvam's speech-to-text heard in that phrase, as plain JSON <c>{ "text": "…", "seq": n }</c>.
///
/// <para><b>Display only (P9: never block).</b> The answer is not saved, not parsed, not added to any ledger; the saved transcript
/// and parse are still the batch path's own result when he stops. Every refusal here (off, busy, not entitled, bad audio) is
/// harmless to the recording: the phone shows no words for that phrase and goes on.</para>
///
/// <para><b>Why it is not the old <c>transcribe-stream</c> route.</b> That route takes the WHOLE clip after stop, decodes it with
/// ffmpeg, writes <c>ssf.transcript_history</c> and acts out a "live" reveal word by word. This one takes a phrase in the one format
/// the recorder writes (no ffmpeg), writes nothing, and sits on its OWN rate-limit policy (<see cref="RateLimitPolicy"/>) so a
/// preview can never use up the <c>"ai"</c> budget the real parse needs.</para>
///
/// <para><b>Gate.</b> The same trial / plan check as <c>/ai/voice-parse</c> (<see cref="IAiStreamEntitlementCheck"/>), asked once a
/// minute per person and farm (a phrase every few seconds must not open a database transaction each time). The route is on the
/// <c>TenantTransactionMiddleware</c> skip-list like <c>transcribe-stream</c>: it reads no farm table of its own.</para>
/// </summary>
public static class AiLiveWordsEndpoints
{
    /// <summary>The route's own rate-limit policy (per signed-in person; see <c>RateLimitingConfig</c>).</summary>
    public const string RateLimitPolicy = "ai-live";

    /// <summary>The entitlement answer is reused this long (a trial that ends mid-recording ends the previews a minute later; the save is gated elsewhere).</summary>
    private static readonly TimeSpan AccessCacheFor = TimeSpan.FromSeconds(60);

    private const int AccessCacheMax = 2000;
    private const int MultipartSlackBytes = 16 * 1024;

    private static readonly ConcurrentDictionary<(Guid User, Guid Farm), DateTime> AllowedUntil = new();

    private static readonly Regex LanguageTag = new("^[a-z]{2,3}-[A-Z]{2}$", RegexOptions.CultureInvariant | RegexOptions.Compiled);

    public static RouteGroupBuilder MapAiLiveWordsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/ai/live-words", HandleAsync)
            .WithName("LiveWords")
            .RequireRateLimiting(RateLimitPolicy)
            .RequireAuthorization()
            .DisableAntiforgery();

        return group;
    }

    private static async Task HandleAsync(
        HttpRequest request,
        ClaimsPrincipal user,
        ILiveWordsTranscriber transcriber,
        ILoggerFactory loggerFactory,
        HttpContext httpContext,
        CancellationToken ct)
    {
        var logger = loggerFactory.CreateLogger("AiLiveWords");
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            httpContext.Response.StatusCode = StatusCodes.Status401Unauthorized;
            return;
        }

        if (!transcriber.Enabled)
        {
            await RefuseAsync(httpContext, StatusCodes.Status503ServiceUnavailable, "ShramSafal.LiveWordsOff", "Live words are switched off.", ct);
            return;
        }

        if (!request.HasFormContentType || request.ContentLength is null or > LiveWordsAudio.MaxBytes + MultipartSlackBytes)
        {
            await RefuseAsync(httpContext, StatusCodes.Status400BadRequest, "ShramSafal.InvalidCommand", "A small multipart/form-data upload is required.", ct);
            return;
        }

        var form = await request.ReadFormAsync(ct);

        if (!Guid.TryParse(form["farm_id"].ToString(), out var farmId) || farmId == Guid.Empty)
        {
            await RefuseAsync(httpContext, StatusCodes.Status400BadRequest, "ShramSafal.InvalidCommand", "farm_id is required.", ct);
            return;
        }

        if (!AccessStillKnown(userId, farmId))
        {
            var refusal = await httpContext.RequestServices.GetRequiredService<IAiStreamEntitlementCheck>().CheckAsync(farmId, userId, ct);
            if (refusal is not null)
            {
                var status = refusal.Kind switch
                {
                    AgriSync.BuildingBlocks.Results.ErrorKind.Validation => StatusCodes.Status400BadRequest,
                    AgriSync.BuildingBlocks.Results.ErrorKind.NotFound => StatusCodes.Status404NotFound,
                    _ => StatusCodes.Status403Forbidden,
                };
                await RefuseAsync(httpContext, status, refusal.Code, refusal.Description, ct);
                return;
            }

            RememberAccess(userId, farmId);
        }

        var file = form.Files["audio"] ?? form.Files.FirstOrDefault();
        if (file is null || file.Length == 0 || file.Length > LiveWordsAudio.MaxBytes)
        {
            await RefuseAsync(httpContext, StatusCodes.Status400BadRequest, "ShramSafal.InvalidCommand", "audio is required (one phrase, at most 12 seconds).", ct);
            return;
        }

        byte[] wav;
        await using (var upload = file.OpenReadStream())
        {
            wav = new byte[(int)file.Length];
            await upload.ReadExactlyAsync(wav, ct);
        }

        if (LiveWordsAudio.Refusal(wav) is { } why)
        {
            await RefuseAsync(httpContext, StatusCodes.Status400BadRequest, "ShramSafal.InvalidCommand", why, ct);
            return;
        }

        var language = form["language_hint"].ToString().Trim();
        var seq = int.TryParse(form["seq"].ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var n) ? n : 0;

        var result = await transcriber.TranscribeAsync(wav, LanguageTag.IsMatch(language) ? language : null, ct);
        httpContext.Response.Headers["Server-Timing"] = $"stt;dur={result.ElapsedMs}";
        switch (result.Outcome)
        {
            case LiveWordsOutcome.Words:
            case LiveWordsOutcome.Quiet:
                await httpContext.Response.WriteAsJsonAsync(new { text = result.Text, seq }, ct);
                return;
            case LiveWordsOutcome.Busy:
                httpContext.Response.Headers["Retry-After"] = "3";
                await RefuseAsync(httpContext, StatusCodes.Status429TooManyRequests, "ShramSafal.LiveWordsBusy", "Live words are busy; the next phrase will be tried.", ct);
                return;
            default:
                logger.LogInformation("[live-words] unavailable for seq {Seq}", seq);
                await RefuseAsync(httpContext, StatusCodes.Status503ServiceUnavailable, "ShramSafal.LiveWordsUnavailable", "Live words are not available right now.", ct);
                return;
        }
    }

    private static bool AccessStillKnown(Guid userId, Guid farmId) =>
        AllowedUntil.TryGetValue((userId, farmId), out var until) && until > DateTime.UtcNow;

    private static void RememberAccess(Guid userId, Guid farmId)
    {
        if (AllowedUntil.Count >= AccessCacheMax)
        {
            var now = DateTime.UtcNow;
            foreach (var stale in AllowedUntil.Where(e => e.Value <= now).Select(e => e.Key).ToList())
            {
                AllowedUntil.TryRemove(stale, out _);
            }

            if (AllowedUntil.Count >= AccessCacheMax)
            {
                AllowedUntil.Clear();
            }
        }

        AllowedUntil[(userId, farmId)] = DateTime.UtcNow + AccessCacheFor;
    }

    private static Task RefuseAsync(HttpContext httpContext, int status, string code, string message, CancellationToken ct)
    {
        httpContext.Response.StatusCode = status;
        return httpContext.Response.WriteAsJsonAsync(new { error = code, message }, ct);
    }
}
