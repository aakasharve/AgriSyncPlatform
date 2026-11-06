// spec: voice-diary-e2e-2026-05-17 (B.13)
//
// Wave 1.B — Voice Diary HTTP surface. Three endpoints (mounted via
// ModuleEndpoints.cs under the /shramsafal group):
//   POST /shramsafal/voice-diary/persist       — archive a sealed clip
//   GET  /shramsafal/voice-diary/by-range      — list clips in a date window
//   GET  /shramsafal/voice-diary/by-id/{clipId} — fetch one clip with bytes
//
// Endpoint shape mirrors AiEndpoints.cs (sibling pattern):
//   - RequireAuthorization on every route
//   - RequireRateLimiting("ai") to share the AI rate-limiter
//     partition (Voice Diary traffic is upstream of AI)
//   - EndpointActorContext.TryGetUserId is the canonical "extract sub
//     claim" helper used by every existing endpoint group

using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryById;
using ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;
using ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy;
using ShramSafal.Application.Privacy.Ports;

namespace ShramSafal.Api.Endpoints;

public static class VoiceDiaryEndpoints
{
    private const int MaxCipherPayloadBase64Bytes = 16 * 1024 * 1024; // 16 MB base64 ceiling

    /// <summary>The 403 code of a play request refused because the playback switch is OFF (the phone shows the founder's D-31 words).</summary>
    public const string OriginalVoiceNotKeptCode = "ShramSafal.OriginalVoiceNotKept";

    public static RouteGroupBuilder MapVoiceDiaryEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/voice-diary/persist", HandlePersistAsync)
            .WithName("PersistVoiceDiaryClip")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapGet("/voice-diary/by-range", HandleByRangeAsync)
            .WithName("GetVoiceDiaryByRange")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        group.MapGet("/voice-diary/by-id/{clipId:guid}", HandleByIdAsync)
            .WithName("GetVoiceDiaryById")
            .RequireRateLimiting("ai")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandlePersistAsync(
        ClaimsPrincipal user,
        [FromBody] PersistVoiceDiaryRequest request,
        [FromServices] PersistVoiceClipRetainedHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (request is null)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "request body required" });
        }

        if (!string.IsNullOrWhiteSpace(request.CipherBase64)
            && request.CipherBase64.Length > MaxCipherPayloadBase64Bytes)
        {
            return Results.BadRequest(new
            {
                error = "ShramSafal.InvalidCommand",
                message = $"cipher payload too large (max {MaxCipherPayloadBase64Bytes / (1024 * 1024)} MB base64)",
            });
        }

        var command = new PersistVoiceClipRetainedCommand(
            ClipId: request.ClipId,
            UserId: userId,
            RecordedAtUtc: request.RecordedAtUtc,
            CipherBase64: request.CipherBase64 ?? string.Empty,
            DekId: request.DekId ?? string.Empty,
            IvBase64: request.IvBase64 ?? string.Empty,
            AuthTagBase64: request.AuthTagBase64 ?? string.Empty,
            DurationSeconds: request.DurationSeconds,
            Language: request.Language ?? string.Empty);

        var result = await handler.HandleAsync(command, ct);
        return result.IsSuccess
            ? Results.Ok(new { clipId = result.Value!.ClipId })
            : ToErrorResult(result.Error);
    }

    private static async Task<IResult> HandleByRangeAsync(
        ClaimsPrincipal user,
        [FromQuery] DateOnly from,
        [FromQuery] DateOnly to,
        [FromServices] GetVoiceDiaryByRangeHandler handler,
        [FromServices] IShramSafalRepository repository,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        var result = await handler.HandleAsync(
            new GetVoiceDiaryByRangeQuery(userId, from, to),
            ct);

        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        // Fix round 2 (N2): the list still shows every kept recording (OFF never deletes); `playable` says whether the speaker's
        // playback switch is ON, so a phone can show the founder's "मूळ आवाज उपलब्ध नाही" instead of a play button that will be refused.
        var playable = await OriginalVoiceSwitch.IsOnForSpeakerAsync(repository, userId, ct);
        return Results.Ok(new
        {
            clips = result.Value!.Clips.Select(c => new
            {
                playable,
                clipId = c.ClipId,
                recordedAtUtc = c.RecordedAtUtc,
                durationSeconds = c.DurationSeconds,
                language = c.Language,
                s3Key = c.S3Key,
            })
        });
    }

    private static async Task<IResult> HandleByIdAsync(
        [FromRoute] Guid clipId,
        ClaimsPrincipal user,
        [FromServices] GetVoiceDiaryByIdHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var userId))
        {
            return Results.Unauthorized();
        }

        if (clipId == Guid.Empty)
        {
            return Results.BadRequest(new { error = "ShramSafal.InvalidCommand", message = "clipId required" });
        }

        // Fix round 2 (N2) - founder D-2: OFF stops replay and never deletes the clip; D-50 choice 2: the switch is "who may listen". While it
        // is OFF nobody plays a recording, the speaker included (the handler asks BEFORE the clip is read from storage). The clip stays kept;
        // turning the switch ON again makes it playable again.
        var outcome = await handler.HandleAsync(clipId, userId, ct);
        if (outcome.Outcome == VoiceDiaryByIdOutcome.SwitchOff)
        {
            return Results.Json(
                new { error = OriginalVoiceNotKeptCode, message = "Original recording unavailable." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        var clip = outcome.Clip;
        if (clip is null)
        {
            return Results.NotFound(new { error = "ShramSafal.AttachmentNotFound", message = "clip not found" });
        }

        return Results.Ok(new
        {
            clipId = clip.ClipId,
            recordedAtUtc = clip.RecordedAtUtc,
            durationSeconds = clip.DurationSeconds,
            language = clip.Language,
            dekId = clip.DekId,
            ivBase64 = clip.IvBase64,
            authTagBase64 = clip.AuthTagBase64,
            cipherBase64 = Convert.ToBase64String(clip.CipherBytes),
        });
    }

    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Validation => Results.BadRequest(body),
            _ => Results.BadRequest(body),
        };
    }
}

public sealed record PersistVoiceDiaryRequest(
    Guid ClipId,
    DateTime RecordedAtUtc,
    string? CipherBase64,
    string? DekId,
    string? IvBase64,
    string? AuthTagBase64,
    int DurationSeconds,
    string? Language);
