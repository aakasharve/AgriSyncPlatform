using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.WorkerIdentity;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID (founder D-54 FINAL). The narrow worker-identity routes:
/// the ONLY way the ShramSafal-wide person tables are reached. Every route names the caller's farm and opens its scope
/// first (<see cref="RouteFarmScope"/>, the F99 pattern): a farm he is not an active member of is refused with no farm
/// setting ever made, and only then does the use case run its own labour rule and open the identity door.
/// <list type="bullet">
/// <item><c>/farms/{farmId}/labour/identity/…</c> — scan-resolve, the phone check, link (start + confirm), the farm's PIN.</item>
/// <item><c>/farms/{farmId}/labour/field-operators/{id}/…</c> — one of THIS farm's workers: his phone and PIN, the code and
/// its check, the number move, the card reissue, unlink, merge and its undo, erasure and its cancel.</item>
/// </list>
/// None of these is skip-listed in <c>TenantTransactionMiddleware</c>: they need its per-request transaction.
/// </summary>
public static class WorkerIdentityEndpoints
{
    public static RouteGroupBuilder MapWorkerIdentityEndpoints(this RouteGroupBuilder group)
    {
        const string Identity = "/farms/{farmId:guid}/labour/identity";
        const string Worker = "/farms/{farmId:guid}/labour/field-operators/{id:guid}";

        group.MapPost($"{Identity}/resolve", (Guid farmId, CodeRequest body, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.ResolveAsync(farmId, caller, body.Code, ct)))
            .WithName("ResolveWorkerCard").RequireAuthorization();

        group.MapPost($"{Identity}/phone-check", (Guid farmId, PhoneRequest body, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.CheckPhoneAsync(farmId, caller, body.Phone, ct)))
            .WithName("CheckWorkerPhone").RequireAuthorization();

        group.MapPost($"{Identity}/link/start", (Guid farmId, LinkStartRequest body, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.StartLinkAsync(farmId, caller, body.CardCode, body.Phone, ct)))
            .WithName("StartWorkerLink").RequireAuthorization();

        group.MapPost($"{Identity}/link", async Task<IResult> (Guid farmId, LinkRequest body, ClaimsPrincipal user,
            ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var caller))
            {
                return Results.Unauthorized();
            }

            if (await RouteFarmScope.OpenAsync(scope, farmId, caller, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var linked = await service.LinkAsync(
                farmId, caller, body.CardCode, body.Ticket, body.Code, body.FieldOperatorId, body.Id, body.DisplayName, ct);
            if (!linked.IsSuccess)
            {
                return ToErrorResult(linked.Error);
            }

            var (view, created) = linked.Value;
            return created
                ? Results.Created($"/shramsafal/farms/{farmId}/labour/field-operators/{view.FieldOperatorId}", view)
                : Results.Ok(view);
        })
        .WithName("LinkWorkerIdentity").RequireAuthorization();

        group.MapGet($"{Identity}/farm-pin", (Guid farmId, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.FarmPinAsync(farmId, caller, ct)))
            .WithName("GetFarmPinCode").RequireAuthorization();

        group.MapPut($"{Worker}/identity", (Guid farmId, Guid id, ContactRequest body, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller =>
                service.RecordContactAsync(farmId, caller, id, body.Phone, body.PhoneWhose, body.HomePin, ct)))
            .WithName("RecordWorkerContact").RequireAuthorization();

        group.MapPost($"{Worker}/phone/send-code", (Guid farmId, Guid id, SendCodeRequest body, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller =>
                service.SendRecordCodeAsync(farmId, caller, id, body.Purpose, body.Phone, ct)))
            .WithName("SendWorkerPhoneCode").RequireAuthorization();

        group.MapPost($"{Worker}/phone/verify", (Guid farmId, Guid id, VerifyRequest body, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.VerifyAsync(farmId, caller, id, body.Ticket, body.Code, ct)))
            .WithName("VerifyWorkerPhone").RequireAuthorization();

        group.MapPost($"{Worker}/phone/move", (Guid farmId, Guid id, MoveRequest body, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.MoveNumberAsync(
                farmId, caller, id, body.NewPhone, body.NewWhose, body.NewTicket, body.NewCode, body.Proof, body.OldTicket,
                body.OldCode, body.CardCode, ct)))
            .WithName("MoveWorkerNumber").RequireAuthorization();

        group.MapPost($"{Worker}/card/reissue", (Guid farmId, Guid id, ReissueRequest body, ClaimsPrincipal user,
                ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller =>
                service.ReissueCardAsync(farmId, caller, id, body.Proof, body.Ticket, body.Code, ct)))
            .WithName("ReissueWorkerCard").RequireAuthorization();

        group.MapPost($"{Worker}/unlink", (Guid farmId, Guid id, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.UnlinkAsync(farmId, caller, id, ct)))
            .WithName("UnlinkWorkerIdentity").RequireAuthorization();

        group.MapPost($"{Worker}/merge", (Guid farmId, Guid id, MergeRequest body, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.MergeAsync(
                farmId, caller, id, body.SourceCardCode, body.TargetCardCode, body.Ticket, body.Code, ct)))
            .WithName("MergeWorkerIdentity").RequireAuthorization();

        group.MapPost($"{Worker}/unmerge", (Guid farmId, Guid id, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.UnmergeAsync(farmId, caller, id, ct)))
            .WithName("UnmergeWorkerIdentity").RequireAuthorization();

        group.MapPost($"{Worker}/erasure", (Guid farmId, Guid id, ClaimsPrincipal user, ICallerFarmTenantScope scope,
                WorkerIdentityService service, CancellationToken ct) =>
            RunAsync(user, scope, farmId, ct, caller => service.RequestErasureAsync(farmId, caller, id, ct)))
            .WithName("RequestWorkerErasure").RequireAuthorization();

        group.MapPost($"{Worker}/erasure/cancel", async Task<IResult> (Guid farmId, Guid id, ClaimsPrincipal user,
            ICallerFarmTenantScope scope, WorkerIdentityService service, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var caller))
            {
                return Results.Unauthorized();
            }

            if (await RouteFarmScope.OpenAsync(scope, farmId, caller, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var cancelled = await service.CancelErasureAsync(farmId, caller, id, ct);
            return cancelled.IsSuccess ? Results.Ok(new { cancelled = true }) : ToErrorResult(cancelled.Error);
        })
        .WithName("CancelWorkerErasure").RequireAuthorization();

        return group;
    }

    /// <summary>The caller, his farm's scope opened, then the use case.</summary>
    private static async Task<IResult> RunAsync<T>(
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

    /// <summary>Mirrors <c>LabourEndpoints.ToErrorResult</c>: {error, message} bodies the phone branches on.</summary>
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

/// <summary>lane WID request bodies. Every field is optional on the wire; the use case says what is missing.</summary>
public sealed record CodeRequest(string? Code);

public sealed record PhoneRequest(string? Phone);

public sealed record LinkStartRequest(string? CardCode, string? Phone);

public sealed record LinkRequest(string? CardCode, Guid? Ticket, string? Code, Guid? FieldOperatorId, Guid? Id, string? DisplayName);

public sealed record ContactRequest(string? Phone, string? PhoneWhose, string? HomePin);

public sealed record SendCodeRequest(string? Purpose, string? Phone);

public sealed record VerifyRequest(Guid Ticket, string? Code);

public sealed record MoveRequest(
    string? NewPhone, string? NewWhose, Guid NewTicket, string? NewCode, string? Proof, Guid? OldTicket, string? OldCode, string? CardCode);

public sealed record ReissueRequest(string? Proof, Guid? Ticket, string? Code);

public sealed record MergeRequest(string? SourceCardCode, string? TargetCardCode, Guid? Ticket, string? Code);
