using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
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
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
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
        group.MapPost("/job-cards", async (
            CreateJobCardRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CreateJobCardHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the farm the card is for: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CreateJobCardCommand(
                FarmId: new FarmId(request.FarmId),
                PlotId: request.PlotId,
                CropCycleId: request.CropCycleId,
                PlannedDate: request.PlannedDate,
                LineItems: request.LineItems,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/job-cards/{result.Value!.JobCardId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CreateJobCard");

        // POST /job-cards/{id}/assign → 200
        group.MapPost("/job-cards/{id:guid}/assign", async (
            Guid id,
            AssignJobCardRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AssignJobCardHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AssignJobCardCommand(
                JobCardId: id,
                WorkerUserId: new UserId(request.WorkerUserId),
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AssignJobCard");

        // POST /job-cards/{id}/start → 200
        group.MapPost("/job-cards/{id:guid}/start", async (
            Guid id,
            StartJobCardRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            StartJobCardHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new StartJobCardCommand(
                JobCardId: id,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

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
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<CompleteJobCardCommand, CompleteJobCardResult> handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CompleteJobCardCommand(
                JobCardId: id,
                DailyLogId: request.DailyLogId,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CompleteJobCard");

        // POST /job-cards/{id}/verify-for-payout → 200
        group.MapPost("/job-cards/{id:guid}/verify-for-payout", async (
            Guid id,
            VerifyJobCardForPayoutRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            VerifyJobCardForPayoutHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new VerifyJobCardForPayoutCommand(
                JobCardId: id,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

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
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult> handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 01.4 — capture X-App-Version
            // (fallback "unknown") so the labour-payout CostEntry's
            // Provenance.AppVersion records the real client version.
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();

            var command = new SettleJobCardPayoutCommand(
                JobCardId: id,
                ActualPayoutAmount: request.ActualPayoutAmount,
                ActualPayoutCurrencyCode: request.ActualPayoutCurrencyCode,
                SettlementNote: request.SettlementNote,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

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
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<CancelJobCardCommand, CancelJobCardResult> handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane F99 — the card's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCardFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
                return ToErrorResult(refused);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CancelJobCardCommand(
                JobCardId: id,
                Reason: request.Reason ?? string.Empty,
                CallerUserId: new UserId(actorUserId),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CancelJobCard");

        // GET /farms/{farmId}/job-cards?status=... → 200
        group.MapGet("/farms/{farmId:guid}/job-cards", async (
            Guid farmId,
            string? status,
            ClaimsPrincipal user,
            HttpContext httpContext,
            GetJobCardsForFarmHandler handler,
            ICallerFarmTenantScope tenantScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            // lane MU-3 fix 1 (F94) — the caller's farm scope first (the route answered 500 without it).
            var established = await tenantScope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!established.IsSuccess)
                return ToErrorResult(established.Error);

            JobCardStatus? statusFilter = null;
            if (!string.IsNullOrWhiteSpace(status) &&
                Enum.TryParse<JobCardStatus>(status, ignoreCase: true, out var parsed))
            {
                statusFilter = parsed;
            }

            var query = new GetJobCardsForFarmQuery(
                FarmId: new FarmId(farmId),
                CallerUserId: new UserId(actorUserId),
                StatusFilter: statusFilter,
                // lane MU-3 fix 2 (N1) — only a phone that shows a withheld pay as withheld gets one (never 1.0.17).
                ClientShowsWithheldPay: ShramSafal.Application.Services.ClientContract.ShowsWithheldPay(
                    ResolveClientAppVersion(httpContext)));

            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetJobCardsForFarm");

        // GET /workers/{userId}/job-cards → 200
        group.MapGet("/workers/{userId:guid}/job-cards", async (
            Guid userId,
            Guid? farmId,
            ClaimsPrincipal user,
            HttpContext httpContext,
            GetJobCardsForWorkerHandler handler,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
                return Results.Unauthorized();

            var query = new GetJobCardsForWorkerQuery(
                WorkerUserId: new UserId(userId),
                CallerUserId: new UserId(actorUserId),
                // lane MU-3 fix 2 (N1) — only a phone that shows a withheld pay as withheld gets one (never 1.0.17).
                ClientShowsWithheldPay: ShramSafal.Application.Services.ClientContract.ShowsWithheldPay(
                    ResolveClientAppVersion(httpContext)));

            // lane MU-3 fix 2 — the route opened no tenant scope (its first read failed closed, 500 for everyone). The
            // worker page names its farm (the new phone does): that farm's scope is opened, so the worker's seat there is
            // visible and the list is that farm's. Without a farm (1.0.17) the caller's OWN user scope: his own list.
            if (farmId is { } farm)
            {
                var established = await farmScope.EstablishForCallerAsync(farm, actorUserId, ct);
                if (!established.IsSuccess)
                    return ToErrorResult(established.Error);
            }

            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(query, token), ct)
                : await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetJobCardsForWorker");

        return group;
    }

    /// <summary>lane F99 — a card's farm, found under the caller's own scope (another farm's card is not found), then its scope.</summary>
    private static Task<Error?> OpenCardFarmAsync(
        Guid id,
        Guid callerUserId,
        IShramSafalRepository repository,
        ICallerUserTenantScope userScope,
        ICallerFarmTenantScope farmScope,
        CancellationToken ct) =>
        RouteFarmScope.OpenForRecordAsync(
            userScope,
            farmScope,
            callerUserId,
            async token => (await repository.GetJobCardByIdAsync(id, token))?.FarmId.Value,
            ShramSafalErrors.JobCardNotFound,
            ct);

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
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring
    // the sub-phase 01.4 fallback used by the SettleJobCardPayout endpoint
    // above (and the Logs / Attachments / Memberships endpoints in Sub-commit A).
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
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
