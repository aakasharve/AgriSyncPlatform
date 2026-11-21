// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// People and access: who may sign in to the control room, what each person sees, what History says, and the weekly
/// trust report. Every route is for the founder alone: the caller's scope is resolved, then it must be the Platform
/// Owner's (<c>IsPlatformAdmin</c>); anyone else, a team seat holding every tick included, is answered 403
/// <c>{ code: "control_room.founder_only" }</c> before a handler is built or the store is touched. No route here
/// sends a text message (D2): a person is only added to a list.
/// </summary>
public static class ControlRoomEndpoints
{
    private const string Root = "/admin/people";

    public static RouteGroupBuilder MapControlRoomEndpoints(this RouteGroupBuilder group)
    {
        // GET /admin/people - the founder first, then the approved people, with the ticks, the starting-role presets and
        // the account each number is bound to. No cache: it opens one audited History read.
        group.MapGet(Root, async (
            HttpContext http, IEntitlementResolver resolver, ListPeopleHandler h, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            return Results.Ok(await h.HandleAsync(ActorId(http), ct));
        })
        .WithName("GetControlRoomPeople");

        group.MapPost(Root, async (
            HttpContext http, IEntitlementResolver resolver, AddPersonHandler h, AddPersonRequest request, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            var (deviceId, ipHash) = http.AuditClaims();
            var r = await h.HandleAsync(new AddPersonCommand(
                ActorId(http), request.DisplayName, request.Phone, request.StartingRole, request.Ticks, deviceId, ipHash), ct);
            return r.IsSuccess ? Results.Created($"/shramsafal{Root}", r.Value) : ToErrorResult(r.Error);
        })
        .WithName("AddControlRoomPerson");

        group.MapPut(Root + "/{id:guid}", async (
            HttpContext http, IEntitlementResolver resolver, ChangePersonHandler h, Guid id,
            ChangePersonRequest request, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            var (deviceId, ipHash) = http.AuditClaims();
            var r = await h.HandleAsync(new ChangePersonCommand(
                ActorId(http), id, request.DisplayName, request.StartingRole, request.Ticks, deviceId, ipHash), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : ToErrorResult(r.Error);
        })
        .WithName("ChangeControlRoomPerson");

        group.MapPost(Root + "/{id:guid}/remove", async (
            HttpContext http, IEntitlementResolver resolver, RemovePersonHandler h, Guid id, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            var (deviceId, ipHash) = http.AuditClaims();
            var r = await h.HandleAsync(new RemovePersonCommand(ActorId(http), id, deviceId, ipHash), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : ToErrorResult(r.Error);
        })
        .WithName("RemoveControlRoomPerson");

        group.MapPost(Root + "/{id:guid}/keep", async (
            HttpContext http, IEntitlementResolver resolver, KeepPersonHandler h, Guid id, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            var (deviceId, ipHash) = http.AuditClaims();
            var r = await h.HandleAsync(new KeepPersonCommand(ActorId(http), id, deviceId, ipHash), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : ToErrorResult(r.Error);
        })
        .WithName("KeepControlRoomPerson");

        // GET /admin/people/history?days=7..90&action= - { lines, hitLimit, limit }. No cache: one audited read.
        // CR-3 fix wave S-N1: &fromUtc=..&toUtc=.. (an exact window, replacing days) and &countedLooksOnly=true (only the
        // phones_shown lines the trust report counts), so the report's link opens exactly what it counted.
        group.MapGet(Root + "/history", async (
            HttpContext http, IEntitlementResolver resolver, GetHistoryHandler h, int? days, string? action,
            string? fromUtc, string? toUtc, bool? countedLooksOnly, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            var r = await h.HandleAsync(new GetHistoryQuery(
                ActorId(http), days ?? GetHistoryHandler.MinDays, action, fromUtc, toUtc, countedLooksOnly ?? false), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : ToErrorResult(r.Error);
        })
        .WithName("GetControlRoomHistory");

        // GET /admin/people/trust-report - the weekly numbers; a count is a value or the reason it is not measured.
        group.MapGet(Root + "/trust-report", async (
            HttpContext http, IEntitlementResolver resolver, GetTrustReportHandler h, CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!scope.IsPlatformAdmin) return FounderOnly();

            return Results.Ok(await h.HandleAsync(ActorId(http), ct));
        })
        .WithName("GetControlRoomTrustReport");

        return group;
    }

    private static Guid ActorId(HttpContext http) =>
        EndpointActorContext.TryGetUserId(http.User, out var id) ? id : Guid.Empty;

    private static IResult FounderOnly() =>
        Results.Json(new
        {
            code = ControlRoomPeopleCodes.FounderOnly,
            message = "People and access is for the founder only."
        }, statusCode: StatusCodes.Status403Forbidden);

    // Stamped like every other mapper, so a refused call is recorded under its own code.
    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    /// <summary>A refusal is <c>{ code, message }</c> (C17), with the status its kind names.</summary>
    private static IResult MapErrorResult(Error error)
    {
        var body = new { code = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.Validation => Results.BadRequest(body),
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            _ => Results.Problem()
        };
    }
}
