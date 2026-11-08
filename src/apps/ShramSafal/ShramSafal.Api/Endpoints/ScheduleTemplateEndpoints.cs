using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Api.Endpoints;

public static class ScheduleTemplateEndpoints
{
    public static RouteGroupBuilder MapScheduleTemplateEndpoints(this RouteGroupBuilder group)
    {
        // TODO: add rate limit 30/hr/user when rate limiting middleware is configured with a dedicated "schedule-clone" policy
        group.MapPost("/schedule-templates/{id}/clone", async (
            Guid id,
            CloneScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CloneScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            var newTemplateId = request.NewId ?? Guid.NewGuid();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CloneScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: newTemplateId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewScope: request.NewScope,
                Reason: request.Reason,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CloneScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/edit", async (
            Guid id,
            EditScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            EditScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new EditScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: request.NewId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewName: request.NewName,
                NewStage: request.NewStage,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("EditScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/publish", async (
            Guid id,
            PublishScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            PublishScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new PublishScheduleTemplateCommand(
                TemplateId: id,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PublishScheduleTemplate");

        group.MapGet("/schedule-templates/{rootId}/lineage", async (
            Guid rootId,
            ClaimsPrincipal user,
            GetScheduleLineageHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — a template's lineage belongs to no farm, so it is read under the caller's own user scope (the route
            // opened none: its first read failed closed, 500 for everyone).
            var result = await userScope.RunForCallerAsync(
                actorUserId, token => handler.HandleAsync(new GetScheduleLineageQuery(rootId, actorUserId), token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetScheduleLineage");

        // ── spec: plr-d10 lane SCH-A (Task 4; founder D-74, L8-R) - ShramSafal's schedule check. A PLATFORM act: the handler
        // asks IEntitlementResolver.MayCheckSchedulesAsync (ModuleKey.ScheduleReview); a farm seat of any role is refused. A
        // schedule template belongs to no farm, so each route runs under the caller's OWN user scope (F99). ──

        group.MapPost("/schedule-templates/import", async (
            ImportScheduleTemplateRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            ImportScheduleTemplateHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var command = new ImportScheduleTemplateCommand(
                CallerUserId: actorUserId,
                Name: request.Name ?? string.Empty,
                CropKey: request.CropKey,
                OwnerType: request.OwnerType ?? string.Empty,
                SourceLabel: request.SourceLabel,
                Stages: (request.Stages ?? []).Select(s => new ImportScheduleStageInput(s.Name ?? string.Empty, s.StartDay, s.EndDay)).ToList(),
                Activities: (request.Activities ?? []).Select(a => new ImportScheduleActivityInput(
                    a.Key, a.Name ?? string.Empty, a.StartDay, a.EndDay, a.FrequencyMode ?? string.Empty, a.IntervalDays, a.AfterKey, a.Role)).ToList(),
                ClientAppVersion: ResolveClientAppVersion(httpContext),
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.TemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("ImportScheduleTemplate");

        group.MapPost("/schedule-templates/{id:guid}/check", async (
            Guid id,
            RecordScheduleCheckRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            RecordScheduleCheckHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The checker is the AUTHENTICATED caller; the body names only the decision, the ticks, the note and the name
            // farmers read. There is no body field a client could use to say who checked.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var command = new RecordScheduleCheckCommand(
                CallerUserId: actorUserId,
                TemplateId: id,
                Decision: request.Decision ?? string.Empty,
                CheckedActivityIds: request.CheckedActivityIds,
                Note: request.Note,
                CheckerDisplayName: request.CheckerDisplayName ?? string.Empty,
                ClientAppVersion: ResolveClientAppVersion(httpContext),
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("RecordScheduleCheck");

        group.MapGet("/schedule-templates/checks/waiting", async (
            ClaimsPrincipal user,
            GetSchedulesWaitingForCheckHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(actorUserId, token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetSchedulesWaitingForCheck");

        return group;
    }

    /// <summary>
    /// spec: plr-d10 lane L8b-1 fix round 1 (review M1) — the Marathi twin of a refusal this door words itself (PROPOSED;
    /// the English twin is the error's description). No phone calls these doors yet; when one does, it shows these.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string> MarathiWords = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        [ShramSafal.Domain.Common.ShramSafalErrors.ScheduleCopyExists.Code] = "ही प्रत आधीच बनवलेली आहे.",
    };

    private static IResult ToErrorResult(AgriSync.BuildingBlocks.Results.Error error)
    {
        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
            return Results.NotFound(new { error = error.Code, message = error.Description });

        // lane L8b-1 fix round 1 (review M1) — a second copy of the same schedule: 409 with its words, never a 500.
        if (error.Code.EndsWith("Conflict", StringComparison.Ordinal))
            return Results.Conflict(new { error = error.Code, message = error.Description, messageMr = MarathiWords.GetValueOrDefault(error.Code) });

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
            return Results.Forbid();

        return Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring the
    // sub-phase 01.4 fallback used by other endpoints (FinanceEndpoints etc).
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

public sealed record CloneScheduleTemplateRequest(
    Guid? NewId,
    TenantScope NewScope,
    string Reason,
    string? ClientCommandId);

public sealed record EditScheduleTemplateRequest(
    Guid NewId,
    string? NewName,
    string? NewStage,
    string? ClientCommandId);

public sealed record PublishScheduleTemplateRequest(
    string? ClientCommandId);

// spec: plr-d10 lane SCH-A (Task 4) - the platform reviewer's import. FrequencyMode is one_time | every_n_days | per_week.
public sealed record ImportScheduleStageRequest(string? Name, int StartDay, int EndDay);

public sealed record ImportScheduleActivityRequest(
    string? Key,
    string? Name,
    int StartDay,
    int EndDay,
    string? FrequencyMode,
    int? IntervalDays,
    string? AfterKey,
    string? Role);

public sealed record ImportScheduleTemplateRequest(
    string? Name,
    string? CropKey,
    string? OwnerType,
    string? SourceLabel,
    IReadOnlyList<ImportScheduleStageRequest>? Stages,
    IReadOnlyList<ImportScheduleActivityRequest>? Activities);

// spec: plr-d10 lane SCH-A (Task 4) - { decision, checkedActivityIds, note?, checkerDisplayName }. No field names the checker.
public sealed record RecordScheduleCheckRequest(
    string? Decision,
    IReadOnlyList<Guid>? CheckedActivityIds,
    string? Note,
    string? CheckerDisplayName);
