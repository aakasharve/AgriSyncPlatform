using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Money;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Work;

namespace ShramSafal.Application.UseCases.Work.CreateJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.1.
/// Creates a new JobCard in Draft status.
/// The caller must hold the review-money authority on the farm (F95; the primary account holder always does).
/// </summary>
public sealed class CreateJobCardHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<CreateJobCardCommand, CreateJobCardResult>
{
    public async Task<Result<CreateJobCardResult>> HandleAsync(
        CreateJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Basic validation
        if (command.LineItems is null || command.LineItems.Count == 0)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);

        // 2. Idempotency — if a ClientCommandId was already processed, short-circuit.
        //    We check for a duplicate audit event with the same ClientCommandId.
        //    (Pattern: the AuditEvent table stores ClientCommandId; if it already exists,
        //     we return success with the original jobCard's id from the audit event.)
        //    Full idempotency store is a future concern; for now we guard via repo.

        // 3. Resolve caller role on farm.
        var callerRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);

        if (callerRole is null)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.Forbidden);

        // spec: plr-d10 lane MU-1 (register F95) - a card names a rate, so writing it needs lane 2b's ReviewMoney (the primary
        // account holder always holds it): a label (सहमालक, मुकादम) grants nothing, and a seat that may not see money cannot
        // set a rate it could not read back. REST and sync alike.
        if (!await Services.FarmAuthorityGate.MayWriteRateAsync(
                repository, command.FarmId.Value, command.CallerUserId.Value, clock.UtcNow, ct))
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);

        // spec: plr-d10 lane F99 fix pass 1 (review F-9; E4) — the plot and the season the card names must be this farm's,
        // asked in application code for every seat, on REST and push alike: a card on farm A never points at farm B's plot
        // or season. A foreign id answers exactly as a made-up one.
        if (await repository.GetPlotByIdAsync(command.PlotId, ct) is not { } plot || (Guid)plot.FarmId != command.FarmId.Value)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.PlotNotFound);
        var season = command.CropCycleId is { } seasonId ? await repository.GetCropCycleByIdAsync(seasonId, ct) : null;
        if (command.CropCycleId is not null && (season is null || (Guid)season.FarmId != command.FarmId.Value))
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.CropCycleNotFound);

        // spec: plr-d10 lane MU-4 fix pass 1 (H1) — a seat on chosen plots writes only on his plots (REST and sync alike).
        if (await Services.PlotScopeGate.RefuseAsync(
                repository, command.FarmId.Value, command.PlotId, command.CallerUserId.Value, clock.UtcNow, ct) is { } outsidePlots)
            return Result.Failure<CreateJobCardResult>(outsidePlots);

        // fix pass 2 (N2) — and the crop season it names, the same way.
        if (command.CropCycleId is { } namedCycle
            && await Services.PlotScopeGate.RefuseCycleAsync(
                repository, command.FarmId.Value, namedCycle, command.CallerUserId.Value, clock.UtcNow, ct) is { } outsideSeason)
            return Result.Failure<CreateJobCardResult>(outsideSeason);

        // lane F99 fix pass 1 (F-9) — and the season is this plot's. Asked AFTER the plot-scope rules, so a seat on chosen
        // plots naming another plot's season of this farm is still told the plot rule in its words (MU-4 fix pass 2, N2).
        if (season is not null && season.PlotId != command.PlotId)
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.CropCycleNotFound);

        // 4. Map DTOs to domain line items.
        List<JobCardLineItem> lineItems;
        try
        {
            lineItems = command.LineItems
                .Select(dto => new JobCardLineItem(
                    dto.ActivityType,
                    dto.ExpectedHours,
                    new Money(dto.RatePerHourAmount, new Currency(dto.RatePerHourCurrencyCode)),
                    dto.Notes))
                .ToList();
        }
        catch (Exception ex) when (ex is ArgumentException or InvalidOperationException)
        {
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);
        }

        // 5. Create the aggregate.
        JobCard jobCard;
        try
        {
            jobCard = JobCard.CreateDraft(
                idGenerator.New(),
                command.FarmId,
                command.PlotId,
                command.CropCycleId,
                command.CallerUserId,
                command.PlannedDate,
                lineItems,
                clock.UtcNow);
        }
        catch (ArgumentException)
        {
            return Result.Failure<CreateJobCardResult>(ShramSafalErrors.InvalidCommand);
        }

        // 6. Persist.
        await repository.AddJobCardAsync(jobCard, ct);

        // 7. Emit audit event.
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Owner/Mukadam-initiated; no AI job correlation.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.created",
                actorUserId: command.CallerUserId.Value,
                actorRole: callerRole.Value.ToString(),
                payload: new { jobCard.Id, FarmId = command.FarmId.Value, command.PlotId, command.CropCycleId, command.PlannedDate },
                farmId: command.FarmId.Value,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new CreateJobCardResult(jobCard.Id));
    }
}
