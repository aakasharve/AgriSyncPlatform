using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.UseCases.Schedules.AdoptSchedule;

public sealed class AdoptScheduleHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock,
    IEntitlementPolicy entitlementPolicy)
{
    public async Task<Result<ScheduleSubscriptionDto>> HandleAsync(
        AdoptScheduleCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.PlotId == Guid.Empty ||
            command.CropCycleId == Guid.Empty ||
            command.ScheduleTemplateId == Guid.Empty ||
            command.ActorUserId == Guid.Empty)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.SubscriptionId.HasValue && command.SubscriptionId.Value == Guid.Empty)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.InvalidCommand);
        }

        var farmId = new FarmId(command.FarmId);

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.FarmNotFound);
        }

        var plot = await repository.GetPlotByIdAsync(command.PlotId, ct);
        if (plot is null || plot.FarmId != farmId)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.PlotNotFound);
        }

        var cropCycle = await repository.GetCropCycleByIdAsync(command.CropCycleId, ct);
        if (cropCycle is null || cropCycle.PlotId != command.PlotId)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.CropCycleNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(command.FarmId, command.ActorUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane L8b-1 Task 3 (founder D-73) — who may change a plot's schedule: the primary owner, or a seat the
        // owner gave "कामाचं नियोजन करणे" (PlanWork), with the MU-4 plot rule inside the gate. A change made offline before
        // the authority ended counts inside the late window and is flagged for the owner below (MU design §11.2).
        var decision = await Services.ScheduleChangeGate.DecideAsync(
            repository, command.FarmId, command.PlotId, command.ActorUserId, clock.UtcNow, command.DecidedAtUtc, ct);
        if (decision.Refusal is { } refused)
        {
            return Result.Failure<ScheduleSubscriptionDto>(refused);
        }

        // Phase 5 entitlement gate — schedule adoption is a setup-level
        // operation, tiered with PaidFeature.CreatePlot.
        var gate = await EntitlementGate.CheckAsync<ScheduleSubscriptionDto>(
            entitlementPolicy, new UserId(command.ActorUserId), farmId,
            PaidFeature.CreatePlot, ct);
        if (gate is not null) return gate;

        // spec: plr-d10 lane L8b-1 Task 1 — the schedule is looked up in the library the phone lists (ScheduleLibrary),
        // never in the compliance model (crop_schedule_templates) nobody lists. A schedule he may not see answers exactly
        // like an unknown id (E4). The crop rule is the phone's own (one shared fixture pins both).
        var templateId = new ScheduleTemplateId(command.ScheduleTemplateId);
        var template = await new Services.ScheduleLibrary(repository).FindAsync(command.ScheduleTemplateId, command.ActorUserId, ct);
        if (template is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        if (!Services.ScheduleLibrary.MatchesCrop(template, cropCycle.CropName))
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleTemplateCropMismatch);
        }

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        var versionTag = Services.ScheduleLibrary.VersionTagOf(template);

        // Invariant I-14: at most one Active subscription per (plot, cropKey, cycle).
        var existingActive = await repository.GetActiveScheduleSubscriptionAsync(
            command.PlotId, cropKey, command.CropCycleId, ct);
        if (existingActive is not null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
        }

        var nowUtc = clock.UtcNow;
        var subscription = ScheduleSubscription.Adopt(
            command.SubscriptionId ?? idGenerator.New(),
            farmId,
            command.PlotId,
            command.CropCycleId,
            cropKey,
            templateId,
            versionTag,
            nowUtc,
            command.ReferenceDate);

        await repository.AddScheduleSubscriptionAsync(subscription, ct);
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleSubscription",
                entityId: subscription.Id,
                action: "Adopted",
                actorUserId: command.ActorUserId,
                actorRole: command.ActorRole ?? "unknown",
                payload: new
                {
                    subscriptionId = subscription.Id,
                    farmId = command.FarmId,
                    plotId = command.PlotId,
                    cropCycleId = command.CropCycleId,
                    cropKey,
                    templateId = template.Id,
                    templateName = template.Name,
                    versionTag,
                    referenceDate = command.ReferenceDate
                },
                farmId: command.FarmId,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await Services.ScheduleChangeGate.FlagIfLateAsync(
            repository, decision, subscription.Id, "Adopted", command.FarmId, command.ActorUserId, command.ActorRole ?? "unknown",
            clock.UtcNow, command.ClientCommandId, command.ClientAppVersion, command.AuditDeviceId, command.AuditIpHash, ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(subscription.ToDto());
    }
}
