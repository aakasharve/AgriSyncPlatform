using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Api.Endpoints;

public static class AuditEndpoints
{
    public static RouteGroupBuilder MapAuditEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/audit", async (
            string? entityType,
            Guid? entityId,
            Guid? farmId,
            DateOnly? fromDate,
            DateOnly? toDate,
            int? limit,
            int? offset,
            HttpContext http,
            IShramSafalRepository repository,
            IEntitlementResolver entitlementResolver,
            IClock clock,
            ICallerFarmTenantScope tenantScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(http.User, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!string.IsNullOrWhiteSpace(entityType) && entityId.HasValue)
            {
                // spec: plr-d10 lane PRV — a caller who names the farm gets its scope opened first (the farm stream's
                // own gate, MU-3 fix 1 F94), so a farm-linked trail can be read — and refused for a record kept from
                // him. Without a farm the branch behaves exactly as before.
                if (farmId.HasValue
                    && !(await tenantScope.EstablishForCallerAsync(farmId.Value, actorUserId, ct)).IsSuccess)
                {
                    return Results.Forbid();
                }

                return await GetEntityStreamAsync(
                    entityType, entityId.Value, actorUserId, http, repository, entitlementResolver, ct, clock);
            }

            if (!farmId.HasValue)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Provide either (entityType + entityId) or farmId."
                });
            }

            // lane MU-3 fix 1 (F94) — the caller's farm scope first (the route answered 500 without it).
            if (!(await tenantScope.EstablishForCallerAsync(farmId.Value, actorUserId, ct)).IsSuccess)
            {
                return Results.Forbid();
            }

            var isFarmMember = await repository.IsUserMemberOfFarmAsync(farmId.Value, actorUserId, ct);
            if (!isFarmMember || !await MayReadFarmAuditAsync(repository, farmId.Value, actorUserId, clock.UtcNow, ct))
            {
                return Results.Forbid();
            }

            var from = fromDate ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
            var to = toDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
            if (from > to)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "fromDate cannot be greater than toDate."
                });
            }

            var pageSize = limit ?? 200;
            var pageOffset = offset ?? 0;

            var farmEvents = await repository.GetAuditEventsForFarmAsync(
                farmId.Value,
                from,
                to,
                pageSize,
                pageOffset,
                ct);

            // spec: plr-d10 lane PRV (founder D-26) — no row about, or naming, a record kept from him; and (fix pass 1, L3) the
            // audience changes themselves — from / to and the people before and after — are the record holder's alone.
            var visibility = await RecordVisibility.ForFarmAsync(repository, farmId.Value, actorUserId, clock.UtcNow, ct);
            var holder = await IsRecordHolderAsync(repository, farmId.Value, actorUserId, clock.UtcNow, ct);
            var result = farmEvents
                .Where(e => !NamesHidden(visibility, e))
                .Where(e => holder || !IsAudienceChange(e))
                .Select(ToDto)
                .ToList();

            return Results.Ok(result);
        })
        .WithName("GetAuditEvents");

        return group;
    }

    /// <summary>
    /// The <c>entityType + entityId</c> branch of <c>GET /shramsafal/audit</c>,
    /// lifted out of the route lambda so §P0.2's proof can execute the SAME code
    /// the route executes, against a real Postgres, as <c>agrisync_app</c>. A
    /// test that re-implements the rule proves only that the test agrees with
    /// itself.
    /// </summary>
    public static async Task<IResult> GetEntityStreamAsync(
        string entityType,
        Guid entityId,
        Guid actorUserId,
        HttpContext http,
        IShramSafalRepository repository,
        IEntitlementResolver entitlementResolver,
        CancellationToken ct,
        IClock? clock = null)
    {
        var events = await repository.GetAuditEventsForEntityAsync(entityId, entityType, ct);
        var now = clock?.UtcNow ?? DateTime.UtcNow;

        // spec: plr-d10 lane PRV (founder D-26) — the trail of a record kept from him is refused whole, and no row of
        // another entity's trail that names such a record reaches him.
        var trailFarms = events.Select(x => x.FarmId).Where(x => x.HasValue).Select(x => x!.Value).Distinct().ToList();
        if (trailFarms.Count > 0)
        {
            var visibility = await RecordVisibility.ForFarmsAsync(repository, trailFarms, actorUserId, now, ct);
            if ((entityType == ShramSafal.Domain.RecordPrivacy.RecordKinds.DailyLog && !visibility.MaySeeLog(entityId))
                || (entityType == ShramSafal.Domain.RecordPrivacy.RecordKinds.CostEntry && !visibility.MaySeeCost(entityId)))
            {
                return Results.Forbid();
            }

            events = events.Where(e => !NamesHidden(visibility, e)).ToList();
        }

        // Fix pass 1 (L3) — an audience change's own row (from / to, the people before and after) goes to the record
        // holder of its farm alone; any other reader of the trail never sees who was chosen.
        var holderFarms = new HashSet<Guid>();
        foreach (var changeFarm in events.Where(IsAudienceChange).Select(e => e.FarmId).OfType<Guid>().Distinct())
        {
            if (await IsRecordHolderAsync(repository, changeFarm, actorUserId, now, ct))
            {
                holderFarms.Add(changeFarm);
            }
        }

        events = events.Where(e => !IsAudienceChange(e) || (e.FarmId is { } f && holderFarms.Contains(f))).ToList();

        // Entity stream may include farm-linked events; enforce visibility by farm membership.
        foreach (var relatedFarmId in events
                     .Select(x => x.FarmId)
                     .Where(x => x.HasValue)
                     .Select(x => x!.Value)
                     .Distinct())
        {
            var isMember = await repository.IsUserMemberOfFarmAsync(relatedFarmId, actorUserId, ct);
            if (!isMember || !await MayReadFarmAuditAsync(repository, relatedFarmId, actorUserId, now, ct))
            {
                return Results.Forbid();
            }
        }

        // §P0.2 — the NULL-farm branch. The membership loop above skips every row
        // whose farm_id IS NULL, and those are precisely the cross-farm ones:
        // retained-voice-clip retention (S3 object keys for other farmers' raw
        // recordings), PII-review decisions and their unbounded staff note, admin
        // elevation reasons, DEK handles, erasure/export subjects' GUIDs. Before
        // this filter any authenticated caller who could guess an
        // entityType+entityId got them verbatim, payload included.
        //
        // The rule: your own actor rows, or a platform admin. There is no
        // platform-admin claim and one must not be invented — the scope resolves
        // through IEntitlementResolver, exactly as every other admin surface does
        // (AdminAuthGateTests G2). TryResolveSilently is the right helper because
        // /audit is open to any authenticated user and merely serves MORE to an
        // admin; a non-admin must get a filtered 200, never a 401/403 about admin
        // membership they never asked for.
        var scope = await AdminScopeHelper.TryResolveSilentlyAsync(http, entitlementResolver, ct);
        if (!IsPlatformAuditReader(scope))
        {
            events = events
                .Where(x => x.FarmId.HasValue || (Guid)x.ActorUserId == actorUserId)
                .ToList();
        }

        return Results.Ok(events.Select(ToDto).ToList());
    }

    /// <summary>
    /// §P0.2 — the only thing that unlocks another actor's NULL-farm audit rows.
    /// Platform+Owner (<see cref="AdminScope.IsPlatformAdmin"/>) AND read on
    /// <see cref="ModuleKey.AuditLedger"/>, so revoking the module row in
    /// <see cref="EntitlementMatrix"/> is sufficient to close the surface without
    /// touching this file. A null scope (the ordinary farmer) is never a reader.
    /// </summary>
    /// <summary>
    /// lane MU-3 (founder D-22 / D-26) — a farm's audit trail carries every record's payload: amounts,
    /// wages and everyone's work. It goes only to a seat that reads the farm's records AND sees its money
    /// and wages (the primary account holder always). Public so the REST-door proof runs this rule.
    /// </summary>
    public static async Task<bool> MayReadFarmAuditAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct)
    {
        var scope = await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct);
        return scope is { OwnRecordsOnly: false, SeeMoney: true, SeeWages: true };
    }

    /// <summary>lane PRV fix pass 1 (L3) — a row recording an audience change (set_record_audience).</summary>
    private static bool IsAudienceChange(Domain.Audit.AuditEvent auditEvent) =>
        auditEvent.Action == ShramSafal.Application.UseCases.RecordPrivacy.SetRecordAudience.SetRecordAudienceHandler.ChangedAction;

    /// <summary>lane PRV fix pass 1 (L2/L3) — the farm's record holder (its registrant).</summary>
    private static async Task<bool> IsRecordHolderAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct) =>
        (await FarmReadGate.ScopeAsync(repository, farmId, userId, atUtc, ct))?.IsRecordHolder == true;

    /// <summary>lane PRV — is this row about, or does its payload name, a record kept from the reader?</summary>
    private static bool NamesHidden(RecordVisibility visibility, Domain.Audit.AuditEvent auditEvent) =>
        visibility.HiddenLogIds.Contains(auditEvent.EntityId)
        || visibility.HiddenCostIds.Contains(auditEvent.EntityId)
        || visibility.MentionsHidden(auditEvent.Payload);

    private static bool IsPlatformAuditReader(AdminScope? scope) =>
        scope is { IsPlatformAdmin: true } && scope.CanRead(ModuleKey.AuditLedger);

    private static AuditEventDto ToDto(Domain.Audit.AuditEvent auditEvent) =>
        new(
            auditEvent.Id,
            auditEvent.FarmId,
            auditEvent.EntityType,
            auditEvent.EntityId,
            auditEvent.Action,
            auditEvent.ActorUserId,
            auditEvent.ActorRole,
            auditEvent.Payload,
            auditEvent.OccurredAtUtc,
            auditEvent.ClientCommandId);
}
