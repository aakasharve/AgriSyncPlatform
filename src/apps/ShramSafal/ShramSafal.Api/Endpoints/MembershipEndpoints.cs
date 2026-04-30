using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Application.UseCases.Memberships.GetMyFarms;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;

namespace ShramSafal.Api.Endpoints;

public static class MembershipEndpoints
{
    public static RouteGroupBuilder MapMembershipEndpoints(this RouteGroupBuilder group)
    {
        // Owner-only: get/create the persistent Active invitation+QR for a farm.
        //
        // Sub-plan 03 Task 8: this endpoint resolves the PIPELINE-WRAPPED
        // handler (IHandler<IssueFarmInviteCommand, IssueFarmInviteResult>),
        // not the raw IssueFarmInviteHandler. Validation + authorization +
        // logging run as pipeline behaviors before the handler body.
        //
        // Sub-plan 03 T-IGH-03-AUTHZ-RESULT: IAuthorizationEnforcer now
        // returns Result instead of throwing UnauthorizedAccessException,
        // so the legacy `catch (UnauthorizedAccessException)` defense-in-
        // depth seam is GONE. The pipeline's authorizer routes auth
        // failures as typed Result.Failure → ToErrorResult → 403.
        group.MapPost("/farms/{farmId:guid}/invite-qr", async (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<IssueFarmInviteCommand, IssueFarmInviteResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new IssueFarmInviteCommand(new FarmId(farmId), new UserId(userId)),
                ct);

            return result.IsSuccess
                ? Results.Ok(InviteResponse.From(result.Value!))
                : ToErrorResult(result.Error);
        })
        .WithName("IssueFarmInvite");

        // Owner-only: explicit rotate. Invalidates the previously-shared QR.
        //
        // T-IGH-03-PIPELINE-ROLLOUT: this endpoint resolves the
        // PIPELINE-WRAPPED handler (IHandler<RotateFarmInviteCommand,
        // RotateFarmInviteResult>), not the raw RotateFarmInviteHandler.
        // Validation + authorization + logging run as pipeline behaviors
        // before the handler body. T-IGH-03-AUTHZ-RESULT means the
        // enforcer returns Result, so no catch (UnauthorizedAccessException)
        // seam is needed — auth failures route as typed Result.Failure
        // → ToErrorResult → 403.
        group.MapPost("/farms/{farmId:guid}/invite-qr/rotate", async (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<RotateFarmInviteCommand, RotateFarmInviteResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new RotateFarmInviteCommand(new FarmId(farmId), new UserId(userId)),
                ct);

            return result.IsSuccess
                ? Results.Ok(InviteResponse.From(result.Value!.Issued))
                : ToErrorResult(result.Error);
        })
        .WithName("RotateFarmInvite");

        // Worker-side: redeem the token and create a FarmMembership.
        group.MapPost("/join/claim", async (
            ClaimJoinRequest request,
            ClaimsPrincipal user,
            ClaimJoinHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var phoneVerified = string.Equals(
                user.FindFirstValue("phone_verified"),
                "true",
                StringComparison.OrdinalIgnoreCase);

            var command = new ClaimJoinCommand(
                Token: request?.Token ?? string.Empty,
                FarmCode: request?.FarmCode ?? string.Empty,
                CallerUserId: new UserId(userId),
                PhoneVerified: phoneVerified);

            var result = await handler.HandleAsync(command, ct);

            if (result.IsFailure)
            {
                var statusCode = result.Error.Code switch
                {
                    "join.phone_not_verified" => 403,
                    "join.token_invalid" => 404,
                    "join.farm_missing" => 404,
                    "join.farm_code_mismatch" => 409,
                    _ => 400,
                };
                return Results.Json(
                    new { error = result.Error.Code, message = result.Error.Description },
                    statusCode: statusCode);
            }

            return Results.Ok(new
            {
                membershipId = result.Value!.MembershipId,
                farmId = (Guid)result.Value.FarmId,
                farmName = result.Value.FarmName,
                role = result.Value.Role,
                wasAlreadyMember = result.Value.WasAlreadyMember,
            });
        })
        .WithName("ClaimJoin");

        // Self-exit from a farm. Honours invariant I3 (last PrimaryOwner cannot leave).
        group.MapPost("/farms/{farmId:guid}/memberships/self-exit", async (
            Guid farmId,
            ClaimsPrincipal user,
            ExitMembershipHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new FarmId(farmId), new UserId(userId), ct);
            if (result.IsFailure)
            {
                var statusCode = result.Error.Code switch
                {
                    "exit.no_membership" => 404,
                    "exit.last_primary_owner" => 409,
                    _ => 400,
                };
                return Results.Json(
                    new { error = result.Error.Code, message = result.Error.Description },
                    statusCode: statusCode);
            }

            return Results.Ok(new
            {
                membershipId = result.Value!.MembershipId,
                alreadyExited = result.Value.AlreadyExited,
            });
        })
        .WithName("ExitMembership");

        // Minimal "my farms" list so the frontend can resolve the real farmId.
        group.MapGet("/farms/mine", async (
            ClaimsPrincipal user,
            GetMyFarmsHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetMyFarmsCommand(new UserId(userId)), ct);
            return result.IsSuccess
                ? Results.Ok(result.Value!.Farms)
                : ToErrorResult(result.Error);
        })
        .WithName("GetMyFarms");

        return group;
    }

    /// <summary>
    /// Sub-plan 03 bridge: route status code through <c>ErrorKind</c>
    /// rather than pattern-matching on <c>Error.Code</c> string suffixes.
    /// Body shape (<c>{error, message}</c>) is preserved verbatim because
    /// frontend + integration tests depend on it; switching to RFC 7807
    /// would be a breaking contract change tracked in a separate
    /// pending task.
    /// </summary>
    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Forbidden => Results.Forbid(),
            ErrorKind.Unauthenticated => Results.Unauthorized(),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Validation => Results.BadRequest(body),
            // Pre-Sub-plan-03 fallback: Internal-classified errors and
            // any unmapped kind keep the historical 400 shape so that
            // existing test contracts continue to pass. Tightening to
            // 500 for true server faults is a follow-up.
            _ => Results.BadRequest(body),
        };
    }

    private sealed record InviteResponse(
        Guid InvitationId,
        Guid JoinTokenId,
        Guid FarmId,
        string FarmName,
        string FarmCode,
        string Token,
        DateTime IssuedAtUtc,
        string QrPayload)
    {
        public static InviteResponse From(IssueFarmInviteResult r)
        {
            var payload = $"https://shramsafal.app/join?t={Uri.EscapeDataString(r.Token)}" +
                $"&f={Uri.EscapeDataString(r.FarmCode)}";

            return new InviteResponse(
                InvitationId: r.InvitationId.Value,
                JoinTokenId: r.JoinTokenId.Value,
                FarmId: r.FarmId.Value,
                FarmName: r.FarmName,
                FarmCode: r.FarmCode,
                Token: r.Token,
                IssuedAtUtc: r.IssuedAtUtc,
                QrPayload: payload);
        }
    }
}

public sealed record ClaimJoinRequest(string? Token, string? FarmCode);
