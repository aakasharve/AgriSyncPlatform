using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Mvc;
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
            ClaimsPrincipal user,
            CreateTestProtocolHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CreateTestProtocolCommand(
                Name: request.Name,
                CropType: request.CropType,
                Kind: request.Kind,
                Periodicity: request.Periodicity,
                EveryNDays: request.EveryNDays,
                StageNames: request.StageNames ?? Array.Empty<string>(),
                ParameterCodes: request.ParameterCodes ?? Array.Empty<string>(),
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/shramsafal/test-protocols/{result.Value}", new { protocolId = result.Value })
                : ToErrorResult(result.Error);
        })
        .WithName("CreateTestProtocol");

        // -------------------------------------------------------- Instances: schedule
        group.MapPost("/test-instances/schedule-from-plan", async (
            ScheduleTestInstancesRequest request,
            ClaimsPrincipal user,
            ScheduleTestDueDatesHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var stages = (request.Stages ?? Array.Empty<ScheduleTestStageRequest>())
                .Select(s => new CropCycleStageInfo(s.StageName, s.StartDate, s.EndDate))
                .ToList();

            var command = new ScheduleTestDueDatesCommand(
                CropCycleId: request.CropCycleId,
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropType: request.CropType,
                Stages: stages,
                ActorUserId: new UserId(actorUserId));

            var scheduled = await handler.HandleAsync(command, ct);
            return Results.Ok(new { scheduledCount = scheduled });
        })
        .WithName("ScheduleTestInstancesFromPlan");

        // --------------------------------------------------------- Instances: collect
        group.MapPost("/test-instances/{id:guid}/collect", async (
            Guid id,
            ClaimsPrincipal user,
            RecordTestCollectedHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new RecordTestCollectedCommand(
                TestInstanceId: id,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("RecordTestCollected");

        // ---------------------------------------------------------- Instances: report
        group.MapPost("/test-instances/{id:guid}/report", async (
            Guid id,
            RecordTestResultRequest request,
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

            var command = new RecordTestResultCommand(
                TestInstanceId: id,
                Results: results,
                AttachmentIds: request.AttachmentIds ?? Array.Empty<Guid>(),
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId);

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
            ClaimsPrincipal user,
            WaiveTestInstanceHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new WaiveTestInstanceCommand(
                TestInstanceId: id,
                Reason: request.Reason ?? string.Empty,
                CallerUserId: new UserId(actorUserId),
                CallerRole: EndpointActorContext.GetActorRoleEnum(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("WaiveTestInstance");

        // ---------------------------------------------------------- Instances: queries
        group.MapGet("/test-instances", async (
            Guid? cropCycleId,
            ClaimsPrincipal user,
            GetTestQueueForCycleHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
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

            var instances = await handler.HandleAsync(
                new GetTestQueueForCycleQuery(cropCycleId.Value, IncludeReported: true),
                ct);
            return Results.Ok(instances);
        })
        .WithName("ListTestInstancesForCycle");

        group.MapGet("/test-instances/{id:guid}", async (
            Guid id,
            ClaimsPrincipal user,
            [FromServices] GetTestQueueForCycleHandler handler,
            [FromServices] ShramSafal.Application.Ports.ITestInstanceRepository instanceRepository,
            [FromServices] ShramSafal.Application.Ports.ITestProtocolRepository protocolRepository,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
            {
                return Results.Unauthorized();
            }

            var instance = await instanceRepository.GetByIdAsync(id, ct);
            if (instance is null)
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
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
            {
                return Results.Unauthorized();
            }

            var missing = await handler.HandleAsync(
                new GetMissingTestsForFarmQuery(new FarmId(farmId)),
                ct);
            return Results.Ok(missing);
        })
        .WithName("GetMissingTestsForFarm");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("RoleNotAllowed", StringComparison.Ordinal) ||
            error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
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
