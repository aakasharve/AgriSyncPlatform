using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Tests.CreateTestProtocol;
using ShramSafal.Application.UseCases.Tests.GetMissingTestsForFarm;
using ShramSafal.Application.UseCases.Tests.GetTestQueueForCycle;
using ShramSafal.Application.UseCases.Tests.RecordTestCollected;
using ShramSafal.Application.UseCases.Tests.RecordTestResult;
using ShramSafal.Application.UseCases.Tests.ScheduleTestDueDates;
using ShramSafal.Application.UseCases.Tests.WaiveTestInstance;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 2 §4.5 — HTTP surface for the test stack: protocols, instances,
/// recommendations, and the per-farm missing-test board.
/// </summary>
public static class TestEndpoints
{
    public static RouteGroupBuilder MapTestEndpoints(this RouteGroupBuilder group)
    {
        // ----------------------------------------------------------------- Protocols
        group.MapPost("/test-protocols", async (
            CreateTestProtocolRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CreateTestProtocolHandler handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — authority comes from a FARM SEAT, never the
            // account's global role. A protocol is not on a farm, so the caller names the farm whose
            // seat authorises him (?farmId=…, lab records there); its scope is set for that read.
            if (farmId is { } namedFarm)
            {
                var protocolScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!protocolScope.IsSuccess)
                {
                    return ToErrorResult(protocolScope.Error);
                }
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CreateTestProtocolCommand(
                Name: request.Name,
                CropType: request.CropType,
                Kind: request.Kind,
                Periodicity: request.Periodicity,
                EveryNDays: request.EveryNDays,
                StageNames: request.StageNames ?? Array.Empty<string>(),
                ParameterCodes: request.ParameterCodes ?? Array.Empty<string>(),
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/shramsafal/test-protocols/{result.Value}", new { protocolId = result.Value })
                : ToErrorResult(result.Error);
        })
        .WithName("CreateTestProtocol");

        // -------------------------------------------------------- Instances: schedule
        group.MapPost("/test-instances/schedule-from-plan", async (
            ScheduleTestInstancesRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            ScheduleTestDueDatesHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            AgriSync.BuildingBlocks.Abstractions.IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots schedules tests on his plots only (asked
            // under his own user scope; the handler answers a count, so the refusal is made here, visibly: 403).
            // fix pass 2 (N2) — first the check plan generation makes before it schedules the same due dates (a member of
            // the farm), then the season: it must be this plot's season on this farm, and on a plot of his.
            var outsidePlots = await userScope.RunForCallerAsync(
                actorUserId,
                async token =>
                {
                    if (!await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, token))
                    {
                        return ShramSafal.Domain.Common.ShramSafalErrors.Forbidden;
                    }

                    if (await repository.GetCropCycleByIdAsync(request.CropCycleId, token) is not { } season
                        || (Guid)season.FarmId != request.FarmId
                        || season.PlotId != request.PlotId)
                    {
                        return ShramSafal.Domain.Common.ShramSafalErrors.InvalidCommand;
                    }

                    return await ShramSafal.Application.Services.PlotScopeGate.RefuseAsync(
                            repository, request.FarmId, request.PlotId, actorUserId, clock.UtcNow, token)
                        ?? await ShramSafal.Application.Services.PlotScopeGate.RefuseCycleAsync(
                            repository, request.FarmId, request.CropCycleId, actorUserId, clock.UtcNow, token);
                },
                ct);
            if (outsidePlots is { } refused)
            {
                return ToErrorResult(refused);
            }

            var stages = (request.Stages ?? Array.Empty<ScheduleTestStageRequest>())
                .Select(s => new CropCycleStageInfo(s.StageName, s.StartDate, s.EndDate))
                .ToList();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new ScheduleTestDueDatesCommand(
                CropCycleId: request.CropCycleId,
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropType: request.CropType,
                Stages: stages,
                ActorUserId: new UserId(actorUserId),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var scheduled = await handler.HandleAsync(command, ct);
            return Results.Ok(new { scheduledCount = scheduled });
        })
        .WithName("ScheduleTestInstancesFromPlan");

        // --------------------------------------------------------- Instances: collect
        group.MapPost("/test-instances/{id:guid}/collect", async (
            Guid id,
            HttpContext httpContext,
            ClaimsPrincipal user,
            RecordTestCollectedHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new RecordTestCollectedCommand(
                TestInstanceId: id,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("RecordTestCollected");

        // ---------------------------------------------------------- Instances: report
        group.MapPost("/test-instances/{id:guid}/report", async (
            Guid id,
            RecordTestResultRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            RecordTestResultHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var results = (request.Results ?? Array.Empty<RecordTestResultEntryRequest>())
                .Select(r => TestResult.Create(
                    r.ParameterCode,
                    r.ParameterValue,
                    r.Unit,
                    r.ReferenceRangeLow,
                    r.ReferenceRangeHigh))
                .ToList();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new RecordTestResultCommand(
                TestInstanceId: id,
                Results: results,
                AttachmentIds: request.AttachmentIds ?? Array.Empty<Guid>(),
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Ok(new
                {
                    testInstanceId = result.Value.TestInstanceId,
                    status = result.Value.Status,
                    recommendations = result.Value.Recommendations
                })
                : ToErrorResult(result.Error);
        })
        .WithName("RecordTestResult");

        // ----------------------------------------------------------- Instances: waive
        group.MapPost("/test-instances/{id:guid}/waive", async (
            Guid id,
            WaiveTestInstanceRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<WaiveTestInstanceCommand> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new WaiveTestInstanceCommand(
                TestInstanceId: id,
                Reason: request.Reason ?? string.Empty,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("WaiveTestInstance");

        // ---------------------------------------------------------- Instances: queries
        // lane MU-3 fix 1 (review item 12) — a test read follows the farm's read scope, both ways: the caller must
        // read the cycle's (or the instance's) farm with the lab-records rule (FarmReadScope.SeeTests: every seat but a
        // कामगार, who needs the LabRecords authority), and only rows ON that farm come back (E4). The farm is found
        // under the caller's own user scope (a row of a farm he is not on is not found), then the farm scope is
        // opened as every working farm route does.
        group.MapGet("/test-instances", async (
            Guid? cropCycleId,
            ClaimsPrincipal user,
            GetTestQueueForCycleHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            AgriSync.BuildingBlocks.Abstractions.IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (cropCycleId is null || cropCycleId == Guid.Empty)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "cropCycleId query parameter is required."
                });
            }

            var cyclePlace = await userScope.RunForCallerAsync(
                callerUserId,
                async token => (await repository.GetCropCycleByIdAsync(cropCycleId.Value, token)) is { } cycle
                    ? ((Guid)cycle.FarmId, cycle.PlotId)
                    : ((Guid, Guid)?)null,
                ct);
            var cycleFarmId = cyclePlace?.Item1;
            // lane MU-4 (§11.6) — and the season's plot must be one he covers.
            if (await TestsReadableAsync(cycleFarmId, callerUserId, repository, farmScope, clock, ct, cyclePlace?.Item2) is { } refused)
            {
                return refused;
            }

            var instances = await handler.HandleAsync(
                new GetTestQueueForCycleQuery(cropCycleId.Value, IncludeReported: true),
                ct);
            return Results.Ok(instances.Where(i => i.FarmId == cycleFarmId).ToList());
        })
        .WithName("ListTestInstancesForCycle");

        group.MapGet("/test-instances/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            [FromServices] ShramSafal.Application.Ports.ITestInstanceRepository instanceRepository,
            [FromServices] ShramSafal.Application.Ports.ITestProtocolRepository protocolRepository,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            AgriSync.BuildingBlocks.Abstractions.IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            var instancePlace = await userScope.RunForCallerAsync(
                callerUserId,
                async token => (await instanceRepository.GetByIdAsync(id, token)) is { } found
                    ? ((Guid)found.FarmId, found.PlotId)
                    : ((Guid, Guid)?)null,
                ct);
            var instanceFarmId = instancePlace?.Item1;
            if (instanceFarmId is null)
            {
                return Results.NotFound(new
                {
                    error = "ShramSafal.TestInstanceNotFound",
                    message = "Test instance was not found."
                });
            }

            // lane MU-4 (§11.6) — and the test's plot must be one he covers.
            if (await TestsReadableAsync(instanceFarmId, callerUserId, repository, farmScope, clock, ct, instancePlace?.Item2) is { } refused)
            {
                return refused;
            }

            var instance = await instanceRepository.GetByIdAsync(id, ct);
            if (instance is null || (Guid)instance.FarmId != instanceFarmId)
            {
                return Results.NotFound(new
                {
                    error = "ShramSafal.TestInstanceNotFound",
                    message = "Test instance was not found."
                });
            }

            var protocol = await protocolRepository.GetByIdAsync(instance.TestProtocolId, ct);
            return Results.Ok(
                ShramSafal.Application.Contracts.Dtos.TestInstanceDto.FromDomain(instance, protocol?.Name));
        })
        .WithName("GetTestInstanceById");

        // ------------------------------------------------------------- Missing tests
        group.MapGet("/farms/{farmId:guid}/missing-tests", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetMissingTestsForFarmHandler handler,
            IShramSafalRepository repository,
            ICallerFarmTenantScope farmScope,
            AgriSync.BuildingBlocks.Abstractions.IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d10 lane MU-4 (§11.6) — the farm's read scope first (the lab-records rule every test read follows),
            // then only the tests of the plots he covers.
            if (await TestsReadableAsync(farmId, callerUserId, repository, farmScope, clock, ct) is { } refused)
            {
                return refused;
            }

            var scope = await ShramSafal.Application.Services.FarmReadGate.ScopeAsync(repository, farmId, callerUserId, clock.UtcNow, ct);
            var missing = await handler.HandleAsync(
                new GetMissingTestsForFarmQuery(new FarmId(farmId)),
                ct);
            return Results.Ok(missing.Where(m => scope!.CoversPlot(m.PlotId)).ToList());
        })
        .WithName("GetMissingTestsForFarm");

        return group;
    }

    /// <summary>
    /// lane MU-3 fix 1 — null when the caller reads lab records on <paramref name="farmId"/> (the farm scope is
    /// then open for the reads that follow); otherwise the refusal to return.
    /// </summary>
    private static async Task<IResult?> TestsReadableAsync(
        Guid? farmId,
        Guid callerUserId,
        IShramSafalRepository repository,
        ICallerFarmTenantScope farmScope,
        AgriSync.BuildingBlocks.Abstractions.IClock clock,
        CancellationToken ct,
        Guid? plotId = null)
    {
        if (farmId is not { } farm)
        {
            return ToErrorResult(ShramSafal.Domain.Common.ShramSafalErrors.Forbidden);
        }

        var established = await farmScope.EstablishForCallerAsync(farm, callerUserId, ct);
        if (!established.IsSuccess)
        {
            return ToErrorResult(established.Error);
        }

        var scope = await ShramSafal.Application.Services.FarmReadGate.ScopeAsync(repository, farm, callerUserId, clock.UtcNow, ct);
        return scope?.SeeTests == true && (plotId is not { } plot || scope.CoversPlot(plot))
            ? null
            : ToErrorResult(ShramSafal.Domain.Common.ShramSafalErrors.Forbidden);
    }

    private static IResult ToErrorResult(Error error)
    {
        // lane MU-4 fix pass 2 (N4) — the plot rule's refusal carries its code and words.
        if (PlotRefusalResult.For(error) is { } plotRefusal)
        {
            return plotRefusal;
        }

        if (error.Code.EndsWith("RoleNotAllowed", StringComparison.Ordinal) ||
            error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column.
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

// ------------------------------------------------------------------- request DTOs

public sealed record CreateTestProtocolRequest(
    string Name,
    string CropType,
    TestProtocolKind Kind,
    TestProtocolPeriodicity Periodicity,
    int? EveryNDays,
    IReadOnlyList<string>? StageNames,
    IReadOnlyList<string>? ParameterCodes);

public sealed record ScheduleTestInstancesRequest(
    Guid CropCycleId,
    Guid FarmId,
    Guid PlotId,
    string CropType,
    IReadOnlyList<ScheduleTestStageRequest>? Stages);

public sealed record ScheduleTestStageRequest(
    string StageName,
    DateOnly StartDate,
    DateOnly EndDate);

public sealed record RecordTestResultRequest(
    IReadOnlyList<RecordTestResultEntryRequest>? Results,
    IReadOnlyList<Guid>? AttachmentIds,
    string? ClientCommandId);

public sealed record RecordTestResultEntryRequest(
    string ParameterCode,
    string ParameterValue,
    string Unit,
    decimal? ReferenceRangeLow,
    decimal? ReferenceRangeHigh);

public sealed record WaiveTestInstanceRequest(string? Reason);
