using System.Security.Claims;
using System.Text;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Creators;
using ShramSafal.Domain.Creators;

namespace ShramSafal.Api.CreatorDoor;

// spec: plr-d10-schedule-approved-spec-2026-11-23 ("Making a schedule": creators invite only at schedule.shramsafal.in, own session, no self-approval, no automatic PDF
// reading in v1); build plan slice 15 (the creator door), server half.

/// <summary>
/// The creator door, <c>/creator/*</c>: the only routes a creator's token opens. They hold a creator's own profile, drafts, files, sent rounds with their return reasons,
/// and the totals of his own approved schedules. There is no route here to a farm, the sync, the AI, the admin, publishing, another creator's work, or approving anything.
/// Every route answers 404 while <c>CreatorDoor:Enabled</c> is not true.
///
/// <para><b>Sign-in</b> (<c>/creator/auth/*</c>, anonymous at the bearer level, and only for a request whose <c>Origin</c> is one of the creator door's own): a one-time
/// code to an invited phone; the refresh credential travels ONLY in the door's own HttpOnly cookie (<see cref="CreatorDoorCookie"/>) and is bound to the per-browser device
/// id in <see cref="CreatorDoorComposition.DeviceHeader"/>. There is no native-client path at this door: no header makes any route put the credential in a body.</para>
/// </summary>
public static class CreatorDoorEndpoints
{
    /// <summary>One file of at most ten megabytes, and the form around it.</summary>
    private const long MaxFormBytes = CreatorFile.MaxBytes + (1024 * 1024);

    private const string RateLimitPolicy = "auth";

    public static IEndpointRouteBuilder MapCreatorDoor(this IEndpointRouteBuilder endpoints)
    {
        var door = endpoints.MapGroup(CreatorDoorComposition.PathPrefix)
            .WithTags("CreatorDoor")
            .RequireAuthorization(CreatorDoorComposition.AuthPolicy)
            .AddEndpointFilter(SwitchedOnOnly);

        MapSignIn(door.MapGroup("/auth"));
        MapProfile(door);
        MapWork(door);
        MapFiles(door);
        return endpoints;
    }

    /// <summary>The switch, again, at the routes themselves (the host's gate answers first; this holds in a host wired without it).</summary>
    internal static async ValueTask<object?> SwitchedOnOnly(EndpointFilterInvocationContext context, EndpointFilterDelegate next) =>
        context.HttpContext.RequestServices.GetRequiredService<CreatorDoorOptions>().Enabled ? await next(context) : Results.NotFound();

    // ── sign-in ──────────────────────────────────────────────────────────────────────────────────────────────────────────

    private static void MapSignIn(RouteGroupBuilder auth)
    {
        auth.MapPost("/start", async (CreatorStartRequest? request, HttpContext http, CreatorSignInService signIn, CreatorDoorOptions options, CancellationToken ct) =>
        {
            if (!CreatorDoorComposition.IsFromCreatorOrigin(http, options))
            {
                return OriginRefused();
            }

            var result = await signIn.StartAsync(request?.Phone, ct);
            return result.IsSuccess
                // The same words for every well-formed number: invited or not, sent or not.
                ? Results.Ok(new { message = "If this number is invited, a code has been sent to it by SMS." })
                : ToResult(result.Error);
        })
        .WithName("CreatorSignInStart")
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicy);

        auth.MapPost("/verify", async (
            CreatorVerifyRequest? request, HttpContext http, CreatorSignInService signIn, CreatorDoorOptions options, IHostEnvironment env, CancellationToken ct) =>
        {
            if (!CreatorDoorComposition.IsFromCreatorOrigin(http, options))
            {
                return OriginRefused();
            }

            var result = await signIn.VerifyAsync(request?.Phone, request?.Code, DeviceIdOf(http), ct);
            return result.IsSuccess ? SignedIn(http, env, result.Value) : ToResult(result.Error);
        })
        .WithName("CreatorSignInVerify")
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicy);

        auth.MapPost("/refresh", async (HttpContext http, CreatorSignInService signIn, CreatorDoorOptions options, IHostEnvironment env, CancellationToken ct) =>
        {
            if (!CreatorDoorComposition.IsFromCreatorOrigin(http, options))
            {
                return OriginRefused();
            }

            // The credential is read from the door's own cookie and from nowhere else: a body or a header can never present it.
            var result = await signIn.RefreshAsync(http.Request.Cookies[CreatorDoorCookie.Name], DeviceIdOf(http), ct);
            if (!result.IsSuccess)
            {
                http.Response.Cookies.Delete(CreatorDoorCookie.Name, CreatorDoorCookie.BuildForDelete(env));
                return ToResult(result.Error);
            }

            return SignedIn(http, env, result.Value);
        })
        .WithName("CreatorSignInRefresh")
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicy);

        auth.MapPost("/logout", async (HttpContext http, CreatorSignInService signIn, CreatorDoorOptions options, IHostEnvironment env, CancellationToken ct) =>
        {
            if (!CreatorDoorComposition.IsFromCreatorOrigin(http, options))
            {
                return OriginRefused();
            }

            await signIn.LogoutAsync(http.Request.Cookies[CreatorDoorCookie.Name], ct);
            http.Response.Cookies.Delete(CreatorDoorCookie.Name, CreatorDoorCookie.BuildForDelete(env));
            return Results.Ok(new { message = "Signed out." });
        })
        .WithName("CreatorSignOut")
        .AllowAnonymous()
        .RequireRateLimiting(RateLimitPolicy);
    }

    /// <summary>The answer to a sign-in or a refresh: the access token in the body, the refresh credential in the cookie ONLY.</summary>
    private static IResult SignedIn(HttpContext http, IHostEnvironment env, CreatorSessionGrant grant)
    {
        http.Response.Cookies.Append(CreatorDoorCookie.Name, grant.RefreshToken, CreatorDoorCookie.Build(env, grant.RefreshExpiresAtUtc));
        http.Response.Headers.CacheControl = "no-store";
        return Results.Ok(new CreatorSignedInBody(grant.CreatorId, grant.AccessToken, grant.ExpiresAtUtc));
    }

    // ── profile ──────────────────────────────────────────────────────────────────────────────────────────────────────────

    private static void MapProfile(RouteGroupBuilder door)
    {
        door.MapGet("/profile", (HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => Results.Ok(await work.ProfileAsync(profile, ct))))
            .WithName("CreatorGetProfile");

        door.MapPut("/profile", (CreatorRenameRequest? request, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => ToResult(await work.RenameAsync(profile, request?.DisplayName, ct))))
            .WithName("CreatorRenameProfile");

        door.MapPost("/profile/terms", (CreatorTermsRequest? request, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => ToResult(await work.AcceptTermsAsync(profile, request?.Version, ct))))
            .WithName("CreatorAcceptTerms");

        door.MapPost("/profile/erasure", (HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => Results.Accepted(value: await work.RequestErasureAsync(profile, ct))))
            .WithName("CreatorRequestErasure");
    }

    // ── own work ─────────────────────────────────────────────────────────────────────────────────────────────────────────

    private static void MapWork(RouteGroupBuilder door)
    {
        door.MapGet("/submissions", (HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (_, ct) => Results.Ok(await work.ListAsync(ct))))
            .WithName("CreatorListSubmissions");

        door.MapPost("/submissions", (HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) =>
            {
                var result = await work.CreateDraftAsync(profile.Id, await ReadBodyAsync(http, ct), ct);
                return result.IsSuccess ? Results.Created($"{CreatorDoorComposition.PathPrefix}/submissions/{result.Value.Id}", result.Value) : ToResult(result.Error);
            }))
            .WithMetadata(new RequestSizeLimitAttribute(CreatorSubmission.MaxBodyBytes * 2))
            .WithName("CreatorCreateDraft");

        door.MapGet("/submissions/{id:guid}", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (_, ct) => ToResult(await work.GetAsync(id, ct))))
            .WithName("CreatorGetSubmission");

        door.MapPut("/submissions/{id:guid}", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => ToResult(await work.ReplaceDraftAsync(profile.Id, id, await ReadBodyAsync(http, ct), ct))))
            .WithMetadata(new RequestSizeLimitAttribute(CreatorSubmission.MaxBodyBytes * 2))
            .WithName("CreatorReplaceDraft");

        door.MapDelete("/submissions/{id:guid}", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (_, ct) =>
            {
                var result = await work.DeleteDraftAsync(id, ct);
                return result.IsSuccess ? Results.NoContent() : ToResult(result.Error);
            }))
            .WithName("CreatorDeleteDraft");

        door.MapPost("/submissions/{id:guid}/submit", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => ToResult(await work.SubmitAsync(profile.Id, id, ct))))
            .WithName("CreatorSubmit");

        door.MapGet("/submissions/{id:guid}/totals", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (profile, ct) => ToResult(await work.TotalsAsync(profile.Id, id, ct))))
            .WithName("CreatorGetTotals");
    }

    // ── own files ────────────────────────────────────────────────────────────────────────────────────────────────────────

    private static void MapFiles(RouteGroupBuilder door)
    {
        door.MapPost("/submissions/{id:guid}/files", (Guid id, HttpRequest request, HttpContext http, CreatorFileService files) =>
            AsCreatorAsync(http, async (profile, ct) =>
            {
                if (!request.HasFormContentType)
                {
                    return ToResult(Error.Validation("Creator.FileMissing", "Send the file as a form with one part named file. Nothing was saved."));
                }

                var form = await request.ReadFormAsync(ct);
                var part = form.Files.GetFile("file");
                if (part is null)
                {
                    return ToResult(Error.Validation("Creator.FileMissing", "Send the file as a form with one part named file. Nothing was saved."));
                }

                // Never read more than a file may hold, plus one byte to tell it was too big.
                await using var stream = part.OpenReadStream();
                var buffer = new byte[Math.Min(part.Length, CreatorFile.MaxBytes + 1L)];
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

                var result = await files.UploadAsync(profile.Id, id, buffer[..read], part.FileName, ct);
                return result.IsSuccess ? Results.Created($"{CreatorDoorComposition.PathPrefix}/files/{result.Value.Id}", result.Value) : ToResult(result.Error);
            }))
            .DisableAntiforgery()
            .WithMetadata(new RequestFormLimitsAttribute { MultipartBodyLengthLimit = MaxFormBytes })
            .WithMetadata(new RequestSizeLimitAttribute(MaxFormBytes))
            .WithName("CreatorUploadFile");

        door.MapGet("/submissions/{id:guid}/files", (Guid id, HttpContext http, CreatorWorkService work) =>
            AsCreatorAsync(http, async (_, ct) =>
            {
                var detail = await work.GetAsync(id, ct);
                return detail.IsSuccess ? Results.Ok(detail.Value.Files) : ToResult(detail.Error);
            }))
            .WithName("CreatorListFiles");

        door.MapGet("/files/{fileId:guid}", (Guid fileId, HttpContext http, CreatorFileService files) =>
            AsCreatorAsync(http, async (_, ct) => FileResult(http, await files.OpenAsync(fileId, ct))))
            .WithName("CreatorGetFile");

        door.MapDelete("/files/{fileId:guid}", (Guid fileId, HttpContext http, CreatorFileService files) =>
            AsCreatorAsync(http, async (_, ct) =>
            {
                var result = await files.DeleteAsync(fileId, ct);
                return result.IsSuccess ? Results.NoContent() : ToResult(result.Error);
            }))
            .WithName("CreatorDeleteFile");
    }

    // ── shared ───────────────────────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Runs <paramref name="work"/> as the signed-in creator: his scope is opened for the database (his rows only), and his profile is read first, so a creator whom staff
    /// revoked, or who was erased, is refused on his very next request whatever his token still says.
    /// </summary>
    private static async Task<IResult> AsCreatorAsync(HttpContext http, Func<CreatorProfile, CancellationToken, Task<IResult>> work)
    {
        var subject = http.User.FindFirstValue("sub") ?? http.User.FindFirstValue(ClaimTypes.NameIdentifier);
        if (!Guid.TryParse(subject, out var creatorId) || creatorId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        var scope = http.RequestServices.GetRequiredService<ICreatorDoorScope>();
        var service = http.RequestServices.GetRequiredService<CreatorWorkService>();
        return await scope.RunAsCreatorAsync(creatorId, async ct =>
        {
            var profile = await service.ActiveProfileAsync(creatorId, ct);
            return profile is null ? Results.Unauthorized() : await work(profile, ct);
        }, http.RequestAborted);
    }

    private static string? DeviceIdOf(HttpContext http) => http.Request.Headers[CreatorDoorComposition.DeviceHeader].FirstOrDefault();

    /// <summary>The draft body as text, read up to its limit and one byte more (so "too big" is told from "exactly at the limit").</summary>
    private static async Task<string> ReadBodyAsync(HttpContext http, CancellationToken ct)
    {
        using var reader = new StreamReader(http.Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, bufferSize: 8192, leaveOpen: true);
        var buffer = new char[CreatorSubmission.MaxBodyBytes + 1];
        var read = 0;
        while (read < buffer.Length)
        {
            var n = await reader.ReadAsync(buffer.AsMemory(read), ct);
            if (n == 0)
            {
                break;
            }

            read += n;
        }

        return new string(buffer, 0, read);
    }

    internal static IResult FileResult(HttpContext http, Result<CreatorFileContent> opened)
    {
        if (!opened.IsSuccess)
        {
            return ToResult(opened.Error);
        }

        var file = opened.Value;
        // Shown as a download, never rendered in the page that asked: a PDF or picture from outside is not run in a ShramSafal origin.
        http.Response.Headers.CacheControl = "private, no-store";
        http.Response.Headers.XContentTypeOptions = "nosniff";
        http.Response.Headers.ContentSecurityPolicy = "default-src 'none'; sandbox";
        return Results.Stream(file.Content, file.MimeType, fileDownloadName: file.FileName);
    }

    private static IResult OriginRefused() => Results.Json(
        new { error = "Creator.OriginRefused", message = "This request did not come from the creator door." }, statusCode: StatusCodes.Status403Forbidden);

    internal static IResult ToResult<T>(Result<T> result) => result.IsSuccess ? Results.Ok(result.Value) : ToResult(result.Error);

    internal static IResult ToResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
            ErrorKind.Conflict => Results.Conflict(body),
            _ when error.Code == "Creator.FileBlocked" => Results.UnprocessableEntity(body),
            _ => Results.BadRequest(body),
        };
    }
}

public sealed record CreatorStartRequest(string? Phone);

public sealed record CreatorVerifyRequest(string? Phone, string? Code);

public sealed record CreatorRenameRequest(string? DisplayName);

public sealed record CreatorTermsRequest(string? Version);

/// <summary>The whole body of a sign-in or refresh answer. It has no field for the refresh credential, by construction.</summary>
public sealed record CreatorSignedInBody(Guid CreatorId, string AccessToken, DateTime ExpiresAtUtc);

/// <summary>
/// ShramSafal staff at the creator door, under <c>/shramsafal/creator-door/*</c> (the staff's own routes, the staff's own token): who is invited, and the check of what
/// creators send. Each is gated in the application by the schedule-review seat; each runs under the caller's OWN user scope (no farm). 404 while the door is off.
/// </summary>
public static class CreatorDoorStaffEndpoints
{
    public static RouteGroupBuilder MapCreatorDoorStaffEndpoints(this RouteGroupBuilder shramsafal)
    {
        var group = shramsafal.MapGroup("/creator-door").AddEndpointFilter(CreatorDoorEndpoints.SwitchedOnOnly);

        group.MapPost("/creators", (InviteCreatorRequest? request, HttpContext http, ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) =>
            {
                var result = await review.InviteAsync(staff, request?.Phone, request?.DisplayName, AuditOf(http), token);
                return result.IsSuccess ? Results.Created($"/shramsafal/creator-door/creators/{result.Value.Id}", result.Value) : CreatorDoorEndpoints.ToResult(result.Error);
            }))
            .WithName("InviteCreator");

        group.MapGet("/creators", (ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.ListCreatorsAsync(staff, token))))
            .WithName("ListCreators");

        group.MapPost("/creators/{creatorId:guid}/revoke", (Guid creatorId, HttpContext http, ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.RevokeAsync(staff, creatorId, AuditOf(http), token))))
            .WithName("RevokeCreator");

        group.MapGet("/submissions", (ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.ListSubmissionsAsync(staff, token))))
            .WithName("ListCreatorSubmissions");

        group.MapGet("/submissions/{id:guid}", (Guid id, ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.ViewAsync(staff, id, token))))
            .WithName("GetCreatorSubmissionCheckView");

        group.MapPost("/submissions/{id:guid}/return", (Guid id, ReturnCreatorSubmissionRequest? request, HttpContext http, ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.ReturnAsync(staff, id, request?.Reasons, AuditOf(http), token))))
            .WithName("ReturnCreatorSubmission");

        // The checker is the AUTHENTICATED caller; the body names only the ticks, the hash they were made on and the name farmers read.
        group.MapPost("/submissions/{id:guid}/approve", (Guid id, ApproveCreatorSubmissionRequest? request, HttpContext http, ClaimsPrincipal user, CreatorReviewService review, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) => CreatorDoorEndpoints.ToResult(await review.ApproveAsync(
                staff, id, request?.CheckedTaskKeys, request?.CheckedChallengeKeys, request?.ContentHash, request?.CheckerDisplayName, AuditOf(http), token))))
            .WithName("ApproveCreatorSubmission");

        group.MapGet("/files/{fileId:guid}", (Guid fileId, HttpContext http, ClaimsPrincipal user, CreatorReviewService review, CreatorFileService files, ICallerUserTenantScope scope, CancellationToken ct) =>
            AsStaffAsync(user, scope, ct, async (staff, token) =>
                await review.MayReadAsync(staff, token)
                    ? CreatorDoorEndpoints.FileResult(http, await files.OpenAsync(fileId, token))
                    : Results.Forbid()))
            .WithName("GetCreatorSubmissionFile");

        return shramsafal;
    }

    private static async Task<IResult> AsStaffAsync(ClaimsPrincipal user, ICallerUserTenantScope scope, CancellationToken ct, Func<Guid, CancellationToken, Task<IResult>> work)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var staffUserId) || staffUserId == Guid.Empty)
        {
            return Results.Unauthorized();
        }

        return await scope.RunForCallerAsync(staffUserId, token => work(staffUserId, token), ct);
    }

    private static CreatorStaffAudit AuditOf(HttpContext http)
    {
        var (deviceId, ipHash) = http.AuditClaims();
        var version = http.Request.Headers["X-App-Version"].FirstOrDefault();
        return new CreatorStaffAudit(string.IsNullOrWhiteSpace(version) ? "unknown" : version.Trim(), deviceId, ipHash);
    }
}

public sealed record InviteCreatorRequest(string? Phone, string? DisplayName);

public sealed record ReturnCreatorSubmissionRequest(string? Reasons);

public sealed record ApproveCreatorSubmissionRequest(
    IReadOnlyList<string>? CheckedTaskKeys, IReadOnlyList<string>? CheckedChallengeKeys, string? ContentHash, string? CheckerDisplayName);
