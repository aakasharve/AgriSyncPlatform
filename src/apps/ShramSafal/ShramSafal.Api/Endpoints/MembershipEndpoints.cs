using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Memberships.ClaimJoin;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;
using ShramSafal.Application.UseCases.Memberships.GetMyFarms;
using ShramSafal.Application.UseCases.Memberships.JoinByCode;
using ShramSafal.Application.UseCases.Memberships.IssueFarmInvite;
using ShramSafal.Application.UseCases.Memberships.RotateFarmInvite;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;

namespace ShramSafal.Api.Endpoints;

public static class MembershipEndpoints
{
    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — the rate-limit policy on
    /// <c>POST /shramsafal/join/by-code</c>. ONE name shared by this route and the Bootstrapper's
    /// registration (<c>RateLimitingConfig</c>), so a rename on either side is a compile error,
    /// not a production 500. Pinned by <c>JoinByCodeRealPostgresTests</c>.
    /// </summary>
    public const string JoinRateLimitPolicy = "join";

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
        group.MapPost("/farms/{farmId:guid}/invite-qr", async Task<IResult> (
            Guid farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<IssueFarmInviteCommand, IssueFarmInviteResult> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            // Establish the membership-validated farm scope BEFORE the pipeline
            // runs. The owner check (EnsureIsOwner) issues its first DbCommand
            // before it publishes any tenant claim, so without this the
            // TenantConnectionInterceptor fail-closes ("no tenant claim set and
            // not in admin scope") and the owner got 500. A non-member is refused
            // here (403); a non-owner member still reaches EnsureIsOwner and is
            // refused there. Same fix as labour-permissions; mirrors LabourEndpoints.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for
            // the FarmInvitation audit row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var result = await handler.HandleAsync(
                new IssueFarmInviteCommand(
                    new FarmId(farmId),
                    new UserId(userId),
                    ClientAppVersion: clientAppVersion,
                    AuditDeviceId: auditDeviceId,
                    AuditIpHash: auditIpHash),
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
        group.MapPost("/farms/{farmId:guid}/invite-qr/rotate", async Task<IResult> (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<RotateFarmInviteCommand, RotateFarmInviteResult> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            // Same as issue above: scope first, then the owner-only pipeline.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
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
        //
        // T-IGH-03-PIPELINE-ROLLOUT (ClaimJoin): this endpoint resolves
        // the PIPELINE-WRAPPED handler (IHandler<ClaimJoinCommand,
        // ClaimJoinResult>). Caller-shape validation (CallerUserId
        // empty / phone-not-verified / missing token+code) runs as a
        // pipeline behavior before the handler body. The error body
        // shape ({error, message}) and join.* code → status mapping
        // below are preserved verbatim because the frontend's
        // JoinFarmLandingPage branches on err.error.
        group.MapPost("/join/claim", async (
            ClaimJoinRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<ClaimJoinCommand, ClaimJoinResult> handler,
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

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for
            // the FarmMembership audit row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new ClaimJoinCommand(
                Token: request?.Token ?? string.Empty,
                FarmCode: request?.FarmCode ?? string.Empty,
                CallerUserId: new UserId(userId),
                PhoneVerified: phoneVerified,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

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
                // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — ADDITIVE: the seat's real
                // status ("Active" for a fresh claim and for a typed-code request this QR just
                // answered; an existing paused seat answers "Suspended"). Older apps ignore it.
                status = result.Value.Status.ToString(),
            });
        })
        .WithName("ClaimJoin");

        // spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — a signed-in person TYPES a farm's code
        // to ask to join it. The contract (fixed; the phone follows it exactly):
        //   200 {farmId, farmName, status}  status = "PendingApproval" for a new request, or the
        //                                   REAL status of a live seat the caller already holds
        //   404 {"error":"join.code_unknown"}  the one answer for ANY blank/malformed/wrong/
        //                                   unknown code; carries no farm name, no message text
        //   429                             "join" rate limit (Program.cs)
        // plus the two identity refusals /join/claim already has (401; 403 phone not verified).
        // There is no role in the body and none is read: the owner chooses it when approving.
        // Not farm-keyed in the path, so ICallerFarmTenantScope does not apply — the farm is
        // found under RLS by the code alone (IJoinCodeTenantScope, inside the handler).
        group.MapPost("/join/by-code", async (
            JoinByCodeRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<JoinByCodeCommand, JoinByCodeResult> handler,
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

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var result = await handler.HandleAsync(
                new JoinByCodeCommand(
                    FarmCode: request?.FarmCode ?? string.Empty,
                    CallerUserId: new UserId(userId),
                    PhoneVerified: phoneVerified,
                    ClientAppVersion: clientAppVersion,
                    AuditDeviceId: auditDeviceId,
                    AuditIpHash: auditIpHash),
                ct);

            if (result.IsFailure)
            {
                return result.Error.Code switch
                {
                    "join.code_unknown" => Results.Json(new { error = result.Error.Code }, statusCode: 404),
                    "join.unauthenticated" => Results.Unauthorized(),
                    "join.phone_not_verified" => Results.Json(
                        new { error = result.Error.Code, message = result.Error.Description }, statusCode: 403),
                    "join.concurrent_claim_unresolved" => Results.Json(
                        new { error = result.Error.Code, message = result.Error.Description }, statusCode: 409),
                    _ => Results.Json(
                        new { error = result.Error.Code, message = result.Error.Description }, statusCode: 400),
                };
            }

            return Results.Ok(new
            {
                farmId = (Guid)result.Value!.FarmId,
                farmName = result.Value.FarmName,
                status = result.Value.Status.ToString(),
            });
        })
        .RequireRateLimiting(JoinRateLimitPolicy)
        .WithName("JoinFarmByCode");

        // Self-exit from a farm. Honours invariant I3 (last PrimaryOwner cannot leave).
        group.MapPost("/farms/{farmId:guid}/memberships/self-exit", async (
            Guid farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            ExitMembershipHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance for
            // the FarmMembership audit row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var result = await handler.HandleAsync(
                new FarmId(farmId),
                new UserId(userId),
                ct,
                clientAppVersion: clientAppVersion,
                auditDeviceId: auditDeviceId,
                auditIpHash: auditIpHash);
            if (result.IsFailure)
            {
                var statusCode = result.Error.Code switch
                {
                    "exit.no_membership" => 404,
                    "exit.last_primary_owner" => 409,
                    // The handler could not establish this request's farm scope,
                    // so the exit could not be written. It must NOT read as a
                    // success — the whole point of the 2026-08-13 fix is that a
                    // request which cannot change the row does not answer 200
                    // and does not leave a MemberExited line behind it.
                    "exit.forbidden" => 403,
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

        // ── LABOUR_PHASE2 Phase 5 (founder decision O-4) — labour-capability
        // access management. Two routes, one resource:
        //
        //   GET /shramsafal/farms/{farmId}/labour-permissions
        //   PUT /shramsafal/farms/{farmId}/labour-permissions/{userId}
        //
        // OWNER-ONLY, enforced by the pipeline's SetLabourPermissionAuthorizer /
        // GetLabourPermissionsAuthorizer (EnsureIsOwner) and re-checked inside
        // each handler. That authorizer is ALSO what publishes the tenant claim
        // these routes are scoped by — see its remarks before removing it.
        //
        // Deliberately NOT added to TenantTransactionMiddleware.SkipPathPrefixes.
        // The skip list holds routes that legitimately span several farms
        // (/shramsafal/farms/mine, /sync/push); these are single-farm and MUST
        // run inside the ambient per-request transaction so the interceptor's
        // SET LOCAL agrisync.farm_id reaches ssf.farm_memberships' tenant policy.
        //
        // PUT, not POST, and it carries the DESIRED STATE rather than a "toggle"
        // verb: a farmer on a rural connection re-sending the same request must
        // land on the same state. That is what makes it idempotent without an
        // Idempotency-Key (ADR 0004 exists for requests that are NOT).
        group.MapGet("/farms/{farmId:guid}/labour-permissions", async Task<IResult> (
            Guid farmId,
            ClaimsPrincipal user,
            IHandler<GetLabourPermissionsQuery, IReadOnlyList<LabourPermissionDto>> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            // Establish the membership-validated farm scope BEFORE the pipeline
            // runs. The pipeline's owner check (EnsureIsOwner) issues its first
            // DbCommand before it publishes any tenant claim, so without this the
            // TenantConnectionInterceptor fail-closes ("no tenant claim set and
            // not in admin scope") and EVERY caller — owner included — got 500.
            // A non-member is refused here (403); a non-owner member still reaches
            // EnsureIsOwner and is refused there. Mirrors LabourEndpoints.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var result = await handler.HandleAsync(
                new GetLabourPermissionsQuery(new FarmId(farmId), new UserId(userId)), ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmLabourPermissions");

        group.MapPut("/farms/{farmId:guid}/labour-permissions/{targetUserId:guid}", async Task<IResult> (
            Guid farmId,
            Guid targetUserId,
            SetLabourPermissionRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<SetLabourPermissionCommand, LabourPermissionDto> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            // Same as the GET above: scope first, then the owner-only pipeline.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, userId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            // The acting owner comes from the validated JWT subject, never from
            // the body or the path — a caller must not be able to name who they
            // are acting as.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var result = await handler.HandleAsync(
                new SetLabourPermissionCommand(
                    new FarmId(farmId),
                    new UserId(targetUserId),
                    request?.CanManageLabourRecords ?? false,
                    new UserId(userId),
                    clientAppVersion,
                    auditDeviceId,
                    auditIpHash,
                    request?.LabourGrantExpiresAtUtc),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetFarmLabourPermission");

        // Minimal "my farms" list so the frontend can resolve the real farmId.
        //
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — `?includePending=true` (sent by this
        // release's phone on every call) also lists the caller's seats that are not Active, each
        // with its status. Without it: Active seats only, the list an older installed app
        // understands (GetMyFarmsCommand.IncludePending).
        group.MapGet("/farms/mine", async (
            bool? includePending,
            ClaimsPrincipal user,
            GetMyFarmsHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new GetMyFarmsCommand(new UserId(userId), IncludePending: includePending == true), ct);
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

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column.
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
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

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — body of <c>POST /shramsafal/join/by-code</c>.
/// The code only; deliberately no role (the joiner never chooses one).
/// </summary>
public sealed record JoinByCodeRequest(string? FarmCode);

/// <summary>
/// LABOUR_PHASE2 Phase 5 — body of
/// <c>PUT /shramsafal/farms/{farmId}/labour-permissions/{targetUserId}</c>.
///
/// <para>The DESIRED STATE, not a toggle: the caller says what it wants to be
/// true, so a retry on a bad connection converges instead of oscillating. An
/// absent/`null` body is read as <c>false</c> (revoke) — the fail-closed
/// direction, since the alternative would let a malformed request hand out a
/// capability.</para>
///
/// <para><c>LabourGrantExpiresAtUtc</c> (R1 Task 2.2, D5): the UTC instant the
/// responsibility ends; absent/<c>null</c> = कायम, no end date. Ignored
/// (cleared) on a revoke, refused when already past.</para>
/// </summary>
public sealed record SetLabourPermissionRequest(
    bool CanManageLabourRecords,
    DateTime? LabourGrantExpiresAtUtc = null);
