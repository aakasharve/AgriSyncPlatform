using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Api.Endpoints;

public static class ScheduleTemplateEndpoints
{
    public static RouteGroupBuilder MapScheduleTemplateEndpoints(this RouteGroupBuilder group)
    {
        // spec: plr-d10 lane SCH-OWN (Task 4; founder D-74, D-82 = 3) - "start blank": make the farm's OWN schedule, empty, for a crop the farm grows.
        // The farm decides who may (its owner, or an Active seat holding "पीक वेळापत्रकाचे नमुने" there) and whose it is, so its scope is opened
        // FIRST; the handler asks the gate before anything about the farm is read. The actor is the authenticated person.
        group.MapPost("/schedule-templates", async (
            CreateOwnScheduleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CreateOwnScheduleHandler handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (request.FarmId is not { } farmId || farmId == Guid.Empty)
            {
                return Results.Forbid();
            }

            var farmScope = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!farmScope.IsSuccess)
            {
                return Results.Forbid();
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var command = new CreateOwnScheduleCommand(
                ScheduleTemplateId: request.ScheduleTemplateId ?? Guid.NewGuid(),
                FarmId: farmId,
                CropKey: request.CropKey ?? string.Empty,
                Name: request.Name ?? string.Empty,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: ResolveClientAppVersion(httpContext),
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                Variety: request.Variety,
                SoilType: request.SoilType,
                Region: request.Region,
                Climate: request.Climate);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.ScheduleTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CreateOwnSchedule");

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
                FarmId: farmId,
                IntoFarmOwn: request.IntoFarmOwn == true);

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
                FarmId: farmId,
                Stages: request.Stages?.Select(s => new EditScheduleStageInput(s.Name ?? string.Empty, s.StartDay, s.EndDay)).ToList(),
                Activities: request.Activities?.Select(a => new EditScheduleActivityInput(
                    a.Name ?? string.Empty, a.Part ?? string.Empty, a.OperationKey, a.StartDay, a.EndDay, a.FrequencyMode ?? string.Empty, a.IntervalDays)).ToList(),
                Variety: request.Variety,
                SoilType: request.SoilType,
                Region: request.Region,
                Climate: request.Climate);

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
        // spec: plr-d10 lane SCH-OWN (D10) - PROPOSED words; the phone (part b) shows them.
        [ShramSafal.Domain.Common.ShramSafalErrors.ScheduleIdTaken.Code] = "हे शेड्यूल आधीच बनवलेलं आहे.",
        [ShramSafal.Domain.Common.ShramSafalErrors.ScheduleCropNotOnFarm.Code] = "या शेतात हे पीक नाही.",
        [ShramSafal.Domain.Common.ShramSafalErrors.OwnScheduleEmpty.Code] = "आधी कामं जोडा",
        // fix round 1 (M002) - PROPOSED: the work's key does not fit (the phone sends the key; the words say it is not right).
        ["ShramSafal.ScheduleImportOperationKey"] = "कामाची ओळख बरोबर नाही.",
        // spec: plr-d10 lane SCH-OWN-c (D-137, Q10 = 1) - PROPOSED: a made-for tag that is not one of its list's choices (part b adds the code to RejectionPolicy as permanent).
        ["ShramSafal.ScheduleMadeFor"] = "ही निवड यादीत नाही.",
    };

    private static IResult ToErrorResult(AgriSync.BuildingBlocks.Results.Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(AgriSync.BuildingBlocks.Results.Error error)
    {
        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
            return Results.NotFound(new { error = error.Code, message = error.Description });

        // lane L8b-1 fix round 1 (review M1) — a second copy of the same schedule: 409 with its words, never a 500.
        if (error.Code.EndsWith("Conflict", StringComparison.Ordinal))
            return Results.Conflict(new { error = error.Code, message = error.Description, messageMr = MarathiWords.GetValueOrDefault(error.Code) });

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
            return Results.Forbid();

        // spec: plr-d10 lane SCH-OWN - a refusal this door words itself carries its Marathi twin; every other 400 keeps its old shape.
        if (MarathiWords.TryGetValue(error.Code, out var marathi))
            return Results.BadRequest(new { error = error.Code, message = error.Description, messageMr = marathi });

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
    string? ClientCommandId,
    // spec: plr-d10 lane SCH-OWN - true: copy a CHECKED schedule INTO the farm's own schedule (?farmId= required, scope Team). Absent = false (P11).
    bool? IntoFarmOwn = null);

public sealed record EditScheduleTemplateRequest(
    Guid NewId,
    string? NewName,
    string? NewStage,
    string? ClientCommandId,
    // spec: plr-d10 lane SCH-OWN (D7) - the next version written whole. Both absent = the old rename (P11).
    IReadOnlyList<EditScheduleStageRequest>? Stages = null,
    IReadOnlyList<EditScheduleActivityRequest>? Activities = null,
    // spec: plr-d10 lane SCH-OWN-c (D-137, Q10 = 1) - the made-for tags of the whole version, as sent (list codes; absent = none). Only with Stages.
    string? Variety = null,
    string? SoilType = null,
    string? Region = null,
    string? Climate = null);

// spec: plr-d10 lane SCH-OWN - the shapes of Stages / Activities are the sync contract's own (schedule.edit): part is irrigation | nutrition | spray | work;
// frequencyMode one_time | every_n_days | per_week.
public sealed record EditScheduleStageRequest(string? Name, int StartDay, int EndDay);

public sealed record EditScheduleActivityRequest(
    string? Name,
    string? Part,
    string? OperationKey,
    int StartDay,
    int EndDay,
    string? FrequencyMode,
    int IntervalDays);

// spec: plr-d10 lane SCH-OWN (Task 4) - POST /shramsafal/schedule-templates: his own schedule, made empty, on the farm named (whose OWNER it then is:
// SCH-OWN-c). The four made-for tags (SCH-OWN-c, Q10 = 1) are optional list codes; absent = none (P11: a 1.0.17 phone never calls this door).
public sealed record CreateOwnScheduleRequest(
    Guid? ScheduleTemplateId,
    Guid? FarmId,
    string? CropKey,
    string? Name,
    string? ClientCommandId,
    string? Variety = null,
    string? SoilType = null,
    string? Region = null,
    string? Climate = null);

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
