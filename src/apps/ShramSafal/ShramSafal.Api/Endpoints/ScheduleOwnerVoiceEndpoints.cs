using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.OwnerVoice;

namespace ShramSafal.Api.Endpoints;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")

/// <summary>
/// The schedule owner's voice, beside the schedule-template routes.
/// <list type="bullet">
/// <item><c>POST /schedule-templates/{id}/owner-messages</c> (multipart: real audio) and <c>GET</c> the same path: ShramSafal staff holding the schedule-review seat
/// (<c>IEntitlementResolver.MayCheckSchedulesAsync</c>); a farm seat of any role is refused. A schedule template belongs to no farm, so each runs under the caller's OWN user scope.</item>
/// <item><c>GET /schedule-owner-clips/{clipId}?farmId=</c>: a follower's phone fetches a clip's bytes. The farm's scope is opened for the caller (a farm he is no Active member of is refused),
/// and row security then shows the clip only when that farm follows the schedule or owns a copy from it; any other clip is answered as one that does not exist. Without a farm, the
/// sender (staff) reads his own.</item>
/// </list>
/// There is no text-to-speech path anywhere: the bytes stored are the bytes sent.
/// </summary>
public static class ScheduleOwnerVoiceEndpoints
{
    /// <summary>Up to three clips of 5 MB and the small fields.</summary>
    private const long MaxFormBytes = 17L * 1024 * 1024;

    public static RouteGroupBuilder MapScheduleOwnerVoiceEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/schedule-templates/{id:guid}/owner-messages", async (
            Guid id,
            HttpRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            SendOwnerMessageHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!request.HasFormContentType)
            {
                return Results.BadRequest(new { error = "ShramSafal.OwnScheduleInvalid", message = "OwnerClipNotAudio: Send the message as a form with its audio file. Nothing was saved." });
            }

            var form = await request.ReadFormAsync(ct);
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();

            async Task<OwnerClipUpload?> FileAsync(string name)
            {
                var file = form.Files.GetFile(name);
                if (file is null)
                {
                    return null;
                }

                // Never read more than a clip may hold, plus one byte to tell it was too big.
                await using var stream = file.OpenReadStream();
                var buffer = new byte[Math.Min(file.Length, ShramSafal.Domain.Planning.ScheduleOwnerClip.MaxBytes + 1L)];
                var read = 0;
                while (read < buffer.Length)
                {
                    var n = await stream.ReadAsync(buffer.AsMemory(read), ct);
                    if (n == 0)
                    {
                        break;
                    }

                    read += n;
                }

                return new OwnerClipUpload(buffer[..read], file.FileName, file.ContentType);
            }

            var followUp = await FileAsync("followUp");
            var command = new SendOwnerMessageCommand(
                CallerUserId: actorUserId,
                ScheduleVersionId: id,
                Kind: form["kind"].ToString(),
                TaskKey: form["taskKey"].ToString(),
                NewVersionId: Guid.TryParse(form["newVersionId"].ToString(), out var newVersion) ? newVersion : null,
                AnswerFirst: NullIfEmpty(form["answerFirst"].ToString()),
                AnswerSecond: NullIfEmpty(form["answerSecond"].ToString()),
                Clip: await FileAsync("audio"),
                // One follow-up file serves both answers; two files serve each.
                FollowUpFirst: await FileAsync("followUpFirst") ?? followUp,
                FollowUpSecond: await FileAsync("followUpSecond") ?? followUp,
                ClientAppVersion: ResolveClientAppVersion(httpContext),
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{id}/owner-messages", result.Value)
                : ToErrorResult(result.Error);
        })
        .DisableAntiforgery()
        .WithMetadata(new RequestFormLimitsAttribute { MultipartBodyLengthLimit = MaxFormBytes })
        .WithName("SendScheduleOwnerMessage");

        group.MapGet("/schedule-templates/{id:guid}/owner-messages", async (
            Guid id,
            ClaimsPrincipal user,
            ListOwnerMessagesHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(actorUserId, id, token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ListScheduleOwnerMessages");

        group.MapGet("/schedule-owner-clips/{clipId:guid}", async (
            Guid clipId,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            GetOwnerClipHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (farmId is { } namedFarm && namedFarm != Guid.Empty)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            var result = farmId is { } && farmId != Guid.Empty
                ? await handler.HandleAsync(clipId, ct)
                : await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(clipId, token), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            var file = result.Value;
            httpContext.Response.Headers.CacheControl = "private, max-age=86400";
            httpContext.Response.Headers["X-Clip-Duration-Ms"] = file.DurationMs.ToString(System.Globalization.CultureInfo.InvariantCulture);
            return Results.Stream(file.Content, file.MimeType, enableRangeProcessing: true, entityTag: new Microsoft.Net.Http.Headers.EntityTagHeaderValue($"\"{file.ContentHash}\""));
        })
        .WithName("GetScheduleOwnerClip");

        return group;
    }

    private static string? NullIfEmpty(string value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static IResult ToErrorResult(AgriSync.BuildingBlocks.Results.Error error)
    {
        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
        {
            return Results.NotFound(new { error = error.Code, message = error.Description });
        }

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}
