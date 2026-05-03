using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Application.UseCases.Work.CancelJobCard;
using ShramSafal.Application.UseCases.Work.CompleteJobCard;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;
using ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Work;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// CEI Phase 4 §4.8 — HTTP surface for the Work Trust Ledger.
/// </summary>
public static class JobCardEndpoints
{
    public static RouteGroupBuilder MapJobCardEndpoints(this RouteGroupBuilder group)
    {
        // POST /job-cards → 201 Created
        // T-IGH-03-PIPELINE-ROLLOUT (CreateJobCard): resolves the
        // pipeline-wrapped IHandler so the canonical
        // InvalidCommand → Forbidden → JobCardRoleNotAllowed ordering
        // runs before the body's domain construction.
        group.MapPost("/job-cards", async (
            CreateJobCardRequest request,
            ClaimsPrincipal user,
            IHandler<CreateJobCardCommand, CreateJobCardResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new CreateJobCardCommand(
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                PlannedDate: request.PlannedDate,
                LineItems: request.LineItems,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/job-cards/{result.Value!.JobCardId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CreateJobCard");

        // POST /job-cards/{id}/assign → 200
        // T-IGH-03-PIPELINE-ROLLOUT (AssignJobCard): resolves the
        // pipeline-wrapped IHandler so the canonical
        // InvalidCommand → JobCardNotFound → Forbidden →
        // JobCardRoleNotAllowed ordering runs before the body's
        // worker-membership + state-machine checks.
        group.MapPost("/job-cards/{id:guid}/assign", async (
            Guid id,
            AssignJobCardRequest request,
            ClaimsPrincipal user,
            IHandler<AssignJobCardCommand, AssignJobCardResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new AssignJobCardCommand(
                JobCardId: id,
                WorkerUserId: new UserId(request.WorkerUserId),
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AssignJobCard");

        // POST /job-cards/{id}/start → 200
        group.MapPost("/job-cards/{id:guid}/start", async (
            Guid id,
            StartJobCardRequest request,
            ClaimsPrincipal user,
            StartJobCardHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new StartJobCardCommand(
                JobCardId: id,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("StartJobCard");

        // POST /job-cards/{id}/complete → 200
        // T-IGH-03-PIPELINE-ROLLOUT (CompleteJobCard): resolves the
        // pipeline-wrapped IHandler so the canonical
        // InvalidCommand → JobCardNotFound → Forbidden ordering runs
        // before the body's substantive checks.
        group.MapPost("/job-cards/{id:guid}/complete", async (
            Guid id,
            CompleteJobCardRequest request,
            ClaimsPrincipal user,
            IHandler<CompleteJobCardCommand, CompleteJobCardResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new CompleteJobCardCommand(
                JobCardId: id,
                DailyLogId: request.DailyLogId,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CompleteJobCard");

        // POST /job-cards/{id}/verify-for-payout → 200
        group.MapPost("/job-cards/{id:guid}/verify-for-payout", async (
            Guid id,
            VerifyJobCardForPayoutRequest request,
            ClaimsPrincipal user,
            VerifyJobCardForPayoutHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new VerifyJobCardForPayoutCommand(
                JobCardId: id,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("VerifyJobCardForPayout");

        // POST /job-cards/{id}/settle → 200
        // T-IGH-03-PIPELINE-ROLLOUT (SettleJobCardPayout): resolves the
        // pipeline-wrapped IHandler so the canonical
        // InvalidCommand → JobCardNotFound → Forbidden →
        // JobCardRoleNotAllowed ordering runs before the body's
        // status-machine check.
        group.MapPost("/job-cards/{id:guid}/settle", async (
            Guid id,
            SettleJobCardPayoutRequest request,
            ClaimsPrincipal user,
            IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new SettleJobCardPayoutCommand(
                JobCardId: id,
                ActualPayoutAmount: request.ActualPayoutAmount,
                ActualPayoutCurrencyCode: request.ActualPayoutCurrencyCode,
                SettlementNote: request.SettlementNote,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SettleJobCardPayout");

        // POST /job-cards/{id}/cancel → 200
        // T-IGH-03-PIPELINE-ROLLOUT (CancelJobCard): resolves the
        // pipeline-wrapped IHandler so the canonical
        // InvalidCommand → JobCardNotFound → Forbidden ordering runs
        // before the body's role-tier + state-machine checks.
        group.MapPost("/job-cards/{id:guid}/cancel", async (
            Guid id,
            CancelJobCardRequest request,
            ClaimsPrincipal user,
            IHandler<CancelJobCardCommand, CancelJobCardResult> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var command = new CancelJobCardCommand(
                JobCardId: id,
                Reason: request.Reason ?? string.Empty,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CancelJobCard");

        // GET /farms/{farmId}/job-cards?status=... → 200
        group.MapGet("/farms/{farmId:guid}/job-cards", async (
            Guid farmId,
            string? status,
            ClaimsPrincipal user,
            GetJobCardsForFarmHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            JobCardStatus? statusFilter = null;
            if (!string.IsNullOrWhiteSpace(status) &&
                Enum.TryParse<JobCardStatus>(status, ignoreCase: true, out var parsed))
            {
                statusFilter = parsed;
            }

            var query = new GetJobCardsForFarmQuery(
                FarmId: new FarmId(farmId),
                CallerUserId: new UserId(actorUserId),
                StatusFilter: statusFilter);

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetJobCardsForFarm");

        // GET /workers/{userId}/job-cards → 200
        group.MapGet("/workers/{userId:guid}/job-cards", async (
            Guid userId,
            ClaimsPrincipal user,
            GetJobCardsForWorkerHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var query = new GetJobCardsForWorkerQuery(
                WorkerUserId: new UserId(userId),
                CallerUserId: new UserId(actorUserId));

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetJobCardsForWorker");

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

// ─── Request DTOs ─────────────────────────────────────────────────────────────

public sealed record CreateJobCardRequest(
    Guid FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    DateOnly PlannedDate,
    IReadOnlyList<JobCardLineItemDto> LineItems,
    string? ClientCommandId);

public sealed record AssignJobCardRequest(Guid WorkerUserId, string? ClientCommandId);

public sealed record StartJobCardRequest(string? ClientCommandId);

public sealed record CompleteJobCardRequest(Guid DailyLogId, string? ClientCommandId);

public sealed record VerifyJobCardForPayoutRequest(string? ClientCommandId);

public sealed record SettleJobCardPayoutRequest(
    decimal ActualPayoutAmount,
    string ActualPayoutCurrencyCode,
    string? SettlementNote,
    string? ClientCommandId);

public sealed record CancelJobCardRequest(string? Reason, string? ClientCommandId);
