using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.ApproveCostEntry;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.GetFinanceSummary;
using ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Api.Endpoints;

public static class FinanceEndpoints
{
    public static RouteGroupBuilder MapFinanceEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/finance/price-config", async (
            SetPriceConfigRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            SetPriceConfigVersionHandler handler,
            ICallerUserTenantScope userScope,
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

            var command = new SetPriceConfigVersionCommand(
                request.ItemName,
                request.UnitPrice,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Version,
                actorUserId,
                PriceConfigId: null,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            // spec: plr-d10 lane F99 fix pass 1 (review F-4; D-72) — the price list belongs to no farm, so the write runs under
            // the caller's own user scope (the route opened none: it failed closed for everyone, admin included). The handler
            // lets only ShramSafal's platform admin write; anyone else is refused with the rule's reason (403).
            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct);
            if (!result.IsSuccess && result.Error.Code == ShramSafalErrors.PriceListPlatformAdminOnly.Code)
            {
                return Results.Json(
                    new { error = result.Error.Code, message = result.Error.Description },
                    statusCode: StatusCodes.Status403Forbidden);
            }

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetPriceConfigVersion");

        // T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): resolves the
        // pipeline-wrapped handler. ValidationBehavior surfaces
        // InvalidCommand / UseSettleJobCardForLabourPayout,
        // AuthorizationBehavior surfaces FarmNotFound / Forbidden, and
        // the body re-checks farm + membership as defense-in-depth
        // before running the entitlement gate, plot lookup, crop-cycle
        // lookup, duplicate detection, high-amount flagging, audit,
        // save, and analytics. PushSyncBatchHandler stays on the raw
        // handler in this rollout pass (per the "only-with-tests"
        // guardrail).
        // spec: plr-d10 lane F99 fix pass 2 (review N-8) — may this person edit the global price list (D-72)? The phone's
        // price book asks this to show or hide its edit controls. It asks the one rule the write obeys, quietly: a farmer
        // opening the price book is not recorded as an unauthorised admin (it used to ask /admin/me/scope, which is).
        group.MapGet("/finance/price-config/may-write", async (
            ClaimsPrincipal user,
            ShramSafal.Application.Admin.Ports.IEntitlementResolver adminResolver,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var mayWrite = await userScope.RunForCallerAsync(actorUserId,
                token => adminResolver.IsPlatformOwnerAsync(new AgriSync.SharedKernel.Contracts.Ids.UserId(actorUserId), token), ct);
            return Results.Ok(new { mayWrite });
        })
        .WithName("MayWritePriceList");

        group.MapPost("/finance/cost-entry", async (
            AddCostEntryRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<AddCostEntryCommand, AddCostEntryResultDto> handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the money is for: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 01.4 — X-App-Version (fallback
            // "unknown"). SourceAiJobId arrives in the request body when the
            // farmer Confirms a voice draft that produced a cost entry; the
            // handler lifts Voice provenance from that AiJob.
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();

            var command = new AddCostEntryCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.CategoryId,
                request.Description,
                request.Amount,
                request.CurrencyCode,
                request.EntryDate,
                actorUserId,
                request.Location?.ToDomain(),
                CostEntryId: null,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                SourceAiJobId: request.SourceAiJobId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AddCostEntry")
        .RequireAuthorization();

        group.MapPost("/finance/allocate", async (
            AllocateGlobalExpenseRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AllocateGlobalExpenseHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the expense's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCostFarmAsync(request.CostEntryId, actorUserId, repository, userScope, farmScope, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AllocateGlobalExpenseCommand(
                request.CostEntryId,
                request.AllocationBasis,
                // lane F99 — a body with no allocations is the handler's InvalidCommand (400), never a null read (500).
                (request.Allocations ?? [])
                    .Select(a => new AllocateGlobalExpenseAllocationCommand(a.PlotId, a.Amount))
                    .ToList(),
                actorUserId,
                request.DayLedgerId,
                EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AllocateGlobalExpense")
        .RequireAuthorization();

        group.MapPost("/finance/cost-entry/{id:guid}/correct", async (
            Guid id,
            CorrectCostEntryRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CorrectCostEntryHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the entry's farm, found under his own scope, then its scope (the route answered 500 without it).
            if (await OpenCostFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CorrectCostEntryCommand(
                id,
                request.CorrectedAmount,
                request.CurrencyCode,
                request.Reason,
                actorUserId,
                FinanceCorrectionId: null,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CorrectCostEntry")
        .RequireAuthorization();

        // spec: plr-d10 lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and when") — a reviewer's मंजूर on
        // one bill, online. The SAME handler as the sync push's approve_cost_entry. A version that moved on is answered 409
        // with the L4b code and the version to look at; every other refusal as the money doors answer it.
        group.MapPost("/finance/cost-entry/{id:guid}/approve", async (
            Guid id,
            ApproveCostEntryRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            ApproveCostEntryHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The bill's farm, found under his own scope, then its scope (a bill he cannot see is not found).
            if (await OpenCostFarmAsync(id, actorUserId, repository, userScope, farmScope, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var command = new ApproveCostEntryCommand(
                id,
                FarmId: null,
                BillVersion: request.BillVersion ?? 0,
                ApprovedByUserId: actorUserId,
                ApprovalId: request.ApprovalId,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: ResolveClientAppVersion(httpContext),
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            if (result.IsSuccess)
            {
                return Results.Ok(result.Value);
            }

            if (result.Error.Code == ShramSafalErrors.LogChangedSinceReview.Code)
            {
                var current = await repository.GetCostEntryByIdAsync(id, ct);
                return Results.Conflict(new
                {
                    error = result.Error.Code,
                    message = result.Error.Description,
                    billVersion = current?.ContentVersion,
                });
            }

            return ToErrorResult(result.Error);
        })
        .WithName("ApproveCostEntry")
        .RequireAuthorization();

        group.MapGet("/finance/summary", async (
            string? groupBy,
            DateOnly? fromDate,
            DateOnly? toDate,
            ClaimsPrincipal user,
            [FromServices] GetFinanceSummaryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var query = new GetFinanceSummaryQuery(actorUserId, groupBy ?? "day", fromDate, toDate);
            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFinanceSummary");

        group.MapGet("/finance/plot-summary", async (
            Guid plotId,
            DateOnly? fromDate,
            DateOnly? toDate,
            ClaimsPrincipal user,
            [FromServices] GetPlotFinanceSummaryHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane MU-3 fix 1 (F94) — the route names a PLOT, so its farm is found under the caller's own
            // user scope first (a plot of a farm he is not on is not found), then the farm scope is opened as
            // every working farm route does. Without both the first read failed closed: 500 for everyone.
            var plotFarmId = await userScope.RunForCallerAsync(
                actorUserId,
                async token => (await repository.GetPlotByIdAsync(plotId, token)) is { } plot ? (Guid?)(Guid)plot.FarmId : null,
                ct);
            if (plotFarmId is not { } farmOfPlot)
            {
                return ToErrorResult(ShramSafalErrors.Forbidden);
            }

            var established = await farmScope.EstablishForCallerAsync(farmOfPlot, actorUserId, ct);
            if (!established.IsSuccess)
            {
                return ToErrorResult(established.Error);
            }

            var result = await handler.HandleAsync(
                new GetPlotFinanceSummaryQuery(actorUserId, plotId, fromDate, toDate),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlotFinanceSummary");

        group.MapPost("/finance/duplicate-check", async (
            DuplicateCheckRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IClock clock,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (request.FarmId == Guid.Empty ||
                string.IsNullOrWhiteSpace(request.CategoryId) ||
                request.Amount <= 0)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Request is invalid."
                });
            }

            // lane F99 — the farm's scope first (the route answered 500 without it): its gate refuses a farm he is not an
            // active member of, as the membership check below did.
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is not null)
            {
                return Results.Forbid();
            }

            var canReadFarm = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
            if (!canReadFarm)
            {
                return Results.Forbid();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 01.4 — the candidate CostEntry built
            // here is a transient duplicate-check probe (never persisted), so it
            // stamps Provenance.Manual(appVersion) from the same X-App-Version
            // header that /finance/cost-entry reads. CostEntry.Create requires a
            // valid provenance object — the construct fails otherwise.
            var headerAppVersion = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
            var clientAppVersion = string.IsNullOrWhiteSpace(headerAppVersion)
                ? "unknown"
                : headerAppVersion!.Trim();

            var windowMinutes = request.WindowMinutes <= 0 ? 120 : request.WindowMinutes;
            var candidate = CostEntry.Create(
                Guid.NewGuid(),
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.CategoryId,
                request.Description ?? string.Empty,
                request.Amount,
                request.CurrencyCode,
                request.EntryDate,
                actorUserId,
                null,
                clock.UtcNow,
                provenance: Provenance.Manual(clientAppVersion));

            // spec: plr-d10 lane PRV fix pass 1 (L4) — a money record kept from him is never matched, so its id never
            // reaches him (and whether it exists is not told either). The window is bounded as before.
            var visibility = await ShramSafal.Application.Services.RecordVisibility.ForFarmAsync(repository, request.FarmId, actorUserId, clock.UtcNow, ct);
            // lane F99 — the route answers now (it failed closed before), so it must not become a way to ask about money he
            // may not see: it matches only the money the pull sends him — any money with see money, on the plots he covers
            // (MU-3; MU-4), and always his own submissions (MU-4 M5).
            var readScope = await ShramSafal.Application.Services.FarmReadGate.ScopeAsync(repository, request.FarmId, actorUserId, clock.UtcNow, ct);
            var existing = (await repository.GetCostEntriesForDuplicateCheck(
                    new FarmId(request.FarmId),
                    request.PlotId,
                    request.CategoryId,
                    clock.UtcNow.AddMinutes(-Math.Min(windowMinutes, 24 * 60)),
                    ct))
                .Where(entry => visibility.MaySeeCost(entry.Id))
                .Where(entry => entry.CreatedByUserId.Value == actorUserId
                    || (readScope is { SeeMoney: true } money
                        && (entry.PlotId is { } plot ? money.CoversPlot(plot) : money.PlotIds is null)))
                .ToList();

            var isDuplicate = DuplicateDetector.IsPotentialDuplicate(existing, candidate, windowMinutes);
            // DATA_PRINCIPLE_SPINE sub-phase 02.5 — codes are exact, so the
            // matched-entry lookup matches the DuplicateDetector body (plain ==).
            var matchedEntryId = existing.FirstOrDefault(entry =>
                entry.CategoryId == candidate.CategoryId &&
                entry.PlotId == candidate.PlotId &&
                decimal.Round(entry.Amount, 2, MidpointRounding.AwayFromZero) == decimal.Round(candidate.Amount, 2, MidpointRounding.AwayFromZero) &&
                Math.Abs((entry.CreatedAtUtc - candidate.CreatedAtUtc).TotalMinutes) <= windowMinutes)?.Id;

            return Results.Ok(new DuplicateCheckResponse(isDuplicate, matchedEntryId));
        })
        .WithName("CheckDuplicateCostEntry");

        // spec: plr-d10 lane RATE-1 part A (founder D-72) — each farm's own price and rate list (its own file).
        group.MapFarmRateEndpoints();

        return group;
    }

    /// <summary>lane F99 — a cost entry's farm, found under the caller's own scope (another farm's is not found), then its scope.</summary>
    private static Task<Error?> OpenCostFarmAsync(
        Guid costEntryId,
        Guid callerUserId,
        IShramSafalRepository repository,
        ICallerUserTenantScope userScope,
        ICallerFarmTenantScope farmScope,
        CancellationToken ct) =>
        RouteFarmScope.OpenForRecordAsync(
            userScope,
            farmScope,
            callerUserId,
            async token => (await repository.GetCostEntryByIdAsync(costEntryId, token))?.FarmId.Value,
            ShramSafalErrors.CostEntryNotFound,
            ct);

    private static IResult ToErrorResult(Error error)
    {
        // lane F99 (MU-4 review R3-L4) — the plot rule's refusal carries its code and words, as the job-card and test routes do.
        if (PlotRefusalResult.For(error) is { } plotRefusal)
        {
            return plotRefusal;
        }

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring the
    // sub-phase 01.4 fallback used by the AddCostEntry endpoint above.
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }

}

public sealed record SetPriceConfigRequest(
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version);

public sealed record AddCostEntryRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    // DATA_PRINCIPLE_SPINE sub-phase 02.5 — renamed from `Category`;
    // must be one of the 13 canonical codes in `ssf.cost_categories`.
    string CategoryId,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    LocationRequest? Location,
    // DATA_PRINCIPLE_SPINE sub-phase 01.4 — present only when the farmer
    // Confirmed a voice draft that produced a cost entry. Sub-phase 01.6
    // wires the frontend to send it; until then this stays null and the
    // handler stamps Provenance.Manual().
    Guid? SourceAiJobId = null);

public sealed record AllocateGlobalExpenseRequest(
    Guid CostEntryId,
    string AllocationBasis,
    IReadOnlyList<AllocateGlobalExpenseAllocationRequest> Allocations,
    Guid? DayLedgerId = null);

public sealed record DuplicateCheckRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string CategoryId,
    string? Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    int WindowMinutes = 120);

public sealed record DuplicateCheckResponse(bool IsDuplicate, Guid? MatchedEntryId);

/// <summary>lane BILL-1 — the version of the bill he saw (required), and optionally the stamp's own id for a safe retry.</summary>
public sealed record ApproveCostEntryRequest(
    int? BillVersion,
    Guid? ApprovalId = null);

public sealed record CorrectCostEntryRequest(
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason);

public sealed record AllocateGlobalExpenseAllocationRequest(
    Guid PlotId,
    decimal Amount);

