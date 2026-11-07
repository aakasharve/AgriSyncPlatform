using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.PersonalInvitations;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6). The personal invitation's routes.
/// <list type="bullet">
/// <item><b>The owner</b> (farm-keyed; the caller's farm scope is opened first, the F99 pattern, and the service then
/// admits only the PRIMARY account holder, D-26): make, list, withdraw, and the one tap that lets a claimant in.</item>
/// <item><b>The invited person</b> (not farm-keyed; he is not a member yet): the waiting invitations that named his proven
/// number, the card for a typed code, स्वीकारा and नको. The farm is found only through the invitee doors
/// (<c>IPersonalInvitationTenantScope</c>), inside the service.</item>
/// </list>
/// The three code routes carry <see cref="InvitationCodeRateLimitPolicy"/> — per person per hour, and per-network and
/// all-callers limits besides, their own (fix round 1, L-8: not the join door's; <c>RateLimitingConfig</c>). None is skip-listed in
/// <c>TenantTransactionMiddleware</c>: they need its per-request transaction.
/// </summary>
public static class PersonalInvitationEndpoints
{
    /// <summary>
    /// The per-person limit on the invitation-code routes (find, accept, decline): 10 an hour (my call) — plenty for a
    /// typo or two, far too few to walk the eight digits. Registered by <c>RateLimitingConfig</c> under this one name.
    /// </summary>
    public const string InvitationCodeRateLimitPolicy = "invitation-code";

    public static RouteGroupBuilder MapPersonalInvitationEndpoints(this RouteGroupBuilder group)
    {
        const string Farm = "/farms/{farmId:guid}/personal-invitations";

        group.MapPost(Farm, async Task<IResult> (Guid farmId, CreatePersonalInvitationRequest? body, HttpContext http,
            ClaimsPrincipal user, ICallerFarmTenantScope scope, PersonalInvitationService service, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var caller))
            {
                return Results.Unauthorized();
            }

            if (await RouteFarmScope.OpenAsync(scope, farmId, caller, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var made = await service.CreateAsync(farmId, caller, new CreatePersonalInvitationInput(
                body?.Label, body?.Name, body?.InvitedPhone, body?.FieldOperatorId, body?.PlotScope, body?.PlotIds,
                body?.Authorities), AuditOf(http), ct);
            return made.IsSuccess
                ? Results.Created($"/shramsafal/farms/{farmId}/personal-invitations/{made.Value!.Id}", made.Value)
                : ToErrorResult(made.Error);
        })
        .WithName("CreatePersonalInvitation");

        group.MapGet(Farm, (Guid farmId, ClaimsPrincipal user, ICallerFarmTenantScope scope, PersonalInvitationService service,
                CancellationToken ct) =>
            RunForFarmAsync(user, scope, farmId, ct, caller => service.ListAsync(farmId, caller, ct)))
            .WithName("ListPersonalInvitations");

        group.MapPost($"{Farm}/{{id:guid}}/withdraw", (Guid farmId, Guid id, HttpContext http, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, PersonalInvitationService service, CancellationToken ct) =>
            RunForFarmAsync(user, scope, farmId, ct, caller => service.WithdrawAsync(farmId, caller, id, AuditOf(http), ct)))
            .WithName("WithdrawPersonalInvitation");

        group.MapPost($"{Farm}/{{id:guid}}/approve", (Guid farmId, Guid id, HttpContext http, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, PersonalInvitationService service, CancellationToken ct) =>
            RunForFarmAsync(user, scope, farmId, ct, caller => service.ApproveClaimAsync(farmId, caller, id, AuditOf(http), ct)))
            .WithName("ApprovePersonalInvitationClaim");

        group.MapGet("/invitations/mine", async Task<IResult> (ClaimsPrincipal user, PersonalInvitationService service,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var caller))
            {
                return Results.Unauthorized();
            }

            var mine = await service.MineAsync(caller, ct);
            return mine.IsSuccess ? Results.Ok(mine.Value) : ToErrorResult(mine.Error);
        })
        .WithName("ListMyInvitations");

        group.MapPost("/invitations/find", async Task<IResult> (InvitationCodeRequest? body, ClaimsPrincipal user,
            PersonalInvitationService service, CancellationToken ct) =>
        {
            if (Refuse(user, out var caller) is { } refused)
            {
                return refused;
            }

            var card = await service.FindAsync(caller, body?.Code, ct);
            return card.IsSuccess ? Results.Ok(card.Value) : ToErrorResult(card.Error);
        })
        .WithName("FindInvitationByCode")
        .RequireRateLimiting(InvitationCodeRateLimitPolicy);

        group.MapPost("/invitations/accept", async Task<IResult> (InvitationAnswerRequest? body, HttpContext http,
            ClaimsPrincipal user, PersonalInvitationService service, CancellationToken ct) =>
        {
            if (Refuse(user, out var caller) is { } refused)
            {
                return refused;
            }

            var accepted = await service.AcceptAsync(caller, body?.InvitationId, body?.Code, AuditOf(http), ct);
            return accepted.IsSuccess ? Results.Ok(accepted.Value) : ToErrorResult(accepted.Error);
        })
        .WithName("AcceptInvitation")
        .RequireRateLimiting(InvitationCodeRateLimitPolicy);

        group.MapPost("/invitations/decline", async Task<IResult> (InvitationAnswerRequest? body, HttpContext http,
            ClaimsPrincipal user, PersonalInvitationService service, CancellationToken ct) =>
        {
            if (Refuse(user, out var caller) is { } refused)
            {
                return refused;
            }

            var declined = await service.DeclineAsync(caller, body?.InvitationId, body?.Code, AuditOf(http), ct);
            return declined.IsSuccess ? Results.Ok(new { status = declined.Value }) : ToErrorResult(declined.Error);
        })
        .WithName("DeclineInvitation")
        .RequireRateLimiting(InvitationCodeRateLimitPolicy);

        return group;
    }

    /// <summary>The same two identity gates as the QR claim: signed in, and an OTP-verified phone in the token.</summary>
    private static IResult? Refuse(ClaimsPrincipal user, out Guid caller)
    {
        if (!EndpointActorContext.TryGetUserId(user, out caller))
        {
            return Results.Unauthorized();
        }

        var phoneVerified = string.Equals(user.FindFirstValue("phone_verified"), "true", StringComparison.OrdinalIgnoreCase);
        return phoneVerified
            ? null
            : Results.Json(new { error = "join.phone_not_verified", message = "Verify your phone first." }, statusCode: 403);
    }

    private static async Task<IResult> RunForFarmAsync<T>(
        ClaimsPrincipal user, ICallerFarmTenantScope scope, Guid farmId, CancellationToken ct, Func<Guid, Task<Result<T>>> run)
    {
        if (!EndpointActorContext.TryGetUserId(user, out var caller))
        {
            return Results.Unauthorized();
        }

        if (await RouteFarmScope.OpenAsync(scope, farmId, caller, ct) is { } refused)
        {
            return ToErrorResult(refused);
        }

        var result = await run(caller);
        return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
    }

    private static InvitationAuditContext AuditOf(HttpContext http)
    {
        var (deviceId, ipHash) = http.AuditClaims();
        var header = http.Request.Headers["X-App-Version"].FirstOrDefault();
        return new InvitationAuditContext(string.IsNullOrWhiteSpace(header) ? "unknown" : header.Trim(), deviceId, ipHash);
    }

    /// <summary>{error, message} bodies the phone branches on. Any unknown code is one answer naming nothing (no message).</summary>
    private static IResult ToErrorResult(Error error)
    {
        if (error == PersonalInvitationService.Unknown)
        {
            return Results.Json(new { error = error.Code }, statusCode: StatusCodes.Status404NotFound);
        }

        var body = new { error = error.Code, message = error.Description };
        if (error == PersonalInvitationService.DailyCap)
        {
            return Results.Json(body, statusCode: StatusCodes.Status429TooManyRequests);
        }

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

/// <summary>spec: plr-d10 lane MU-2 — the owner's invitation, as the invite builder sends it. Every field optional on the
/// wire; the service says what is missing or wrong.</summary>
public sealed record CreatePersonalInvitationRequest(
    string? Label,
    string? Name,
    string? InvitedPhone,
    Guid? FieldOperatorId,
    string? PlotScope,
    IReadOnlyList<Guid>? PlotIds,
    IReadOnlyList<AuthorityGrantDto>? Authorities);

/// <summary>spec: plr-d10 lane MU-2 — the code he typed or scanned.</summary>
public sealed record InvitationCodeRequest(string? Code);

/// <summary>spec: plr-d10 lane MU-2 — स्वीकारा / नको: the card listed for his number (<c>invitationId</c>) or a code.</summary>
public sealed record InvitationAnswerRequest(Guid? InvitationId, string? Code);
