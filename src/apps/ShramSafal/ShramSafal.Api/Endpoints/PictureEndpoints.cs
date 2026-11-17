using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using Microsoft.Net.Http.Headers;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Pictures;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-ID-S (founder D-146). The picture of who made a schedule.
///
/// <list type="bullet">
/// <item><c>PUT /shramsafal/pictures/person</c> - his own picture. <c>PUT .../pictures/schedule/{rootId}</c> - one own schedule's picture
/// ({rootId} may be any version of the chain: the server uses its root). <c>PUT .../pictures/institution/{rootId}</c> - the logo of an
/// outside schedule (ShramSafal staff only). The body is the image file itself (raw bytes; the type comes from the first bytes, never from the
/// header or a name). 200 with the picture row; the file is never echoed.</item>
/// <item>The matching <c>DELETE</c>s answer 204 whether or not a picture was there.</item>
/// <item><c>GET /shramsafal/pictures/{id}</c> - the file, streamed by the server, <c>ETag</c> = the file's SHA-256, <c>Cache-Control: private</c>.
/// A picture the caller may not see answers 404 like one that does not exist.</item>
/// </list>
/// A picture belongs to a person or a schedule, never to a farm, so each route runs under the caller's OWN user scope
/// (<see cref="ICallerUserTenantScope"/>), established before the first read: the table accepts a write only from its setter's scope.
/// </summary>
public static class PictureEndpoints
{
    public static RouteGroupBuilder MapPictureEndpoints(this RouteGroupBuilder group)
    {
        group.MapPut("/pictures/person", (
            HttpContext httpContext, ClaimsPrincipal user, SetPictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            SetAsync(PictureKind.Person, null, httpContext, user, handler, userScope, ct))
            .WithName("SetPersonPicture");

        group.MapPut("/pictures/schedule/{rootId:guid}", (
            Guid rootId, HttpContext httpContext, ClaimsPrincipal user, SetPictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            SetAsync(PictureKind.Schedule, rootId, httpContext, user, handler, userScope, ct))
            .WithName("SetSchedulePicture");

        group.MapPut("/pictures/institution/{rootId:guid}", (
            Guid rootId, HttpContext httpContext, ClaimsPrincipal user, SetPictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            SetAsync(PictureKind.Institution, rootId, httpContext, user, handler, userScope, ct))
            .WithName("SetInstitutionPicture");

        group.MapDelete("/pictures/person", (
            HttpContext httpContext, ClaimsPrincipal user, RemovePictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            RemoveAsync(PictureKind.Person, null, httpContext, user, handler, userScope, ct))
            .WithName("RemovePersonPicture");

        group.MapDelete("/pictures/schedule/{rootId:guid}", (
            Guid rootId, HttpContext httpContext, ClaimsPrincipal user, RemovePictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            RemoveAsync(PictureKind.Schedule, rootId, httpContext, user, handler, userScope, ct))
            .WithName("RemoveSchedulePicture");

        group.MapDelete("/pictures/institution/{rootId:guid}", (
            Guid rootId, HttpContext httpContext, ClaimsPrincipal user, RemovePictureHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
            RemoveAsync(PictureKind.Institution, rootId, httpContext, user, handler, userScope, ct))
            .WithName("RemoveInstitutionPicture");

        group.MapGet("/pictures/{id:guid}", async (
            Guid id, HttpContext httpContext, ClaimsPrincipal user, GetPictureFileHandler handler, ICallerUserTenantScope userScope, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(
                actorUserId, token => handler.HandleAsync(new GetPictureFileQuery(id, actorUserId), token), ct);
            if (!result.IsSuccess)
            {
                return ToErrorResult(result.Error);
            }

            var file = result.Value!;
            // Private: a person's face is never kept by a shared cache. The ETag is the file's own hash, so a browser or the phone asks
            // again only to be told 304 (Results.File answers If-None-Match itself).
            httpContext.Response.Headers[HeaderNames.CacheControl] = "private";
            return Results.File(
                file.ContentStream,
                file.ContentType,
                entityTag: new EntityTagHeaderValue("\"" + file.Sha256 + "\""));
        })
        .WithName("GetPictureFile");

        return group;
    }

    private static async Task<IResult> SetAsync(
        PictureKind kind,
        Guid? routeId,
        HttpContext httpContext,
        ClaimsPrincipal user,
        SetPictureHandler handler,
        ICallerUserTenantScope userScope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
        {
            return Results.Unauthorized();
        }

        var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
        var command = new SetPictureCommand(
            kind, routeId, httpContext.Request.Body, actorUserId, ResolveClientAppVersion(httpContext), auditDeviceId, auditIpHash);

        var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
        return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
    }

    private static async Task<IResult> RemoveAsync(
        PictureKind kind,
        Guid? routeId,
        HttpContext httpContext,
        ClaimsPrincipal user,
        RemovePictureHandler handler,
        ICallerUserTenantScope userScope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
        {
            return Results.Unauthorized();
        }

        var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
        var command = new RemovePictureCommand(kind, routeId, actorUserId, ResolveClientAppVersion(httpContext), auditDeviceId, auditIpHash);

        var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
        return result.IsSuccess ? Results.NoContent() : ToErrorResult(result.Error);
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Kind == ErrorKind.NotFound)
        {
            return Results.NotFound(new { error = error.Code, message = error.Description });
        }

        if (error.Kind == ErrorKind.Forbidden)
        {
            return Results.Forbid();
        }

        // 413 for a file over the hard cap, so the phone can tell "too big" from "wrong kind of file" without reading words.
        if (error.Code == ShramSafal.Domain.Common.ShramSafalErrors.PictureTooLarge.Code)
        {
            return Results.Json(new { error = error.Code, message = error.Description }, statusCode: StatusCodes.Status413PayloadTooLarge);
        }

        return Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}
