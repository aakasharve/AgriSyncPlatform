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
        // spec: plr-d10 lane L8b-1F — and what THIS PLOT's farm may follow (FollowableOnPlot; E4, R23) and the check rule
        // (D-82, D-91 = 1, R7) are decided in the same one place, ScheduleLibrary.ChooseAsync, for adopt and migrate alike.
        var templateId = new ScheduleTemplateId(command.ScheduleTemplateId);
        var choice = await new Services.ScheduleLibrary(repository).ChooseAsync(
            command.ScheduleTemplateId, command.ActorUserId, farm.OwnerUserId.Value, cropCycle.CropName, command.CarryOver, ct);
        if (!choice.IsSuccess)
        {
            return Result.Failure<ScheduleSubscriptionDto>(choice.Error);
        }

        var template = choice.Value.Template;

        var cropKey = (cropCycle.CropName ?? string.Empty).Trim().ToLowerInvariant();
        var versionTag = Services.ScheduleLibrary.VersionTagOf(template);

        // Stages the choice in place `slot`: the subscription, its audit row and the late-change flag (one unit of work, saved by the caller).
        async Task<ScheduleSubscription> StageAsync(short slot)
        {
            var nowUtc = clock.UtcNow;
            var staged = ScheduleSubscription.Adopt(
                command.SubscriptionId ?? idGenerator.New(),
                farmId,
                command.PlotId,
                command.CropCycleId,
                cropKey,
                templateId,
                versionTag,
                nowUtc,
                command.ReferenceDate,
                choice.Value.Origin,
                choice.Value.CheckStateAtAdopt,
                slot);

            await repository.AddScheduleSubscriptionAsync(staged, ct);
            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
            // (sentinel provenance) to AuditEventFactory.Create with the real
            // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
            // AuditContextAccessor.
            await repository.AddAuditEventAsync(
                AuditEventFactory.Create(
                    entityType: "ScheduleSubscription",
                    entityId: staged.Id,
                    action: "Adopted",
                    actorUserId: command.ActorUserId,
                    actorRole: command.ActorRole ?? "unknown",
                    payload: new
                    {
                        subscriptionId = staged.Id,
                        farmId = command.FarmId,
                        plotId = command.PlotId,
                        cropCycleId = command.CropCycleId,
                        cropKey,
                        templateId = template.Id,
                        templateName = template.Name,
                        versionTag,
                        referenceDate = command.ReferenceDate,
                        origin = choice.Value.Origin.ToString(),
                        checkStateAtAdopt = choice.Value.CheckStateAtAdopt?.ToString(),
                        slot
                    },
                    farmId: command.FarmId,
                    clientCommandId: command.ClientCommandId,
                    appVersion: command.ClientAppVersion,
                    deviceId: command.AuditDeviceId,
                    ipHash: command.AuditIpHash,
                    sourceAiJobId: null),
                ct);

            await Services.ScheduleChangeGate.FlagIfLateAsync(
                repository, decision, staged.Id, "Adopted", command.FarmId, command.ActorUserId, command.ActorRole ?? "unknown",
                clock.UtcNow, command.ClientCommandId, command.ClientAppVersion, command.AuditDeviceId, command.AuditIpHash, ct);

            return staged;
        }

        var origin = choice.Value.Origin;
        var limit = origin == ScheduleOrigin.Own ? ShramSafalErrors.OwnScheduleLimitReached : ShramSafalErrors.ScheduleLimitReached;

        // spec: plr-d10 lane L8b-3 (founder D-74, "3 + 1") - replaces invariant I-14 (one Active schedule per plot-season): a
        // plot-season follows up to 3 outside schedules plus 1 of his own, each in its own place (slot). The same schedule twice is
        // still refused. The check rule above runs FIRST: a schedule it refuses never takes a place. Two phones can compute the same
        // lowest free place; the database holds the places unique, so the loser re-reads ONCE and takes the next free one of its
        // origin, else is told the limit (Open point 7).
        ScheduleSubscription? subscription = null;
        for (var attempt = 0; attempt < 2 && subscription is null; attempt++)
        {
            var active = await repository.GetActiveScheduleSubscriptionsAsync(command.PlotId, command.CropCycleId, ct);
            if (active.Any(s => s.ScheduleTemplateId == templateId))
            {
                return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
            }

            // spec: plr-d10 lane L8b-1F (R7) - a carry-over is the phone's one-time upload of the single choice it held BEFORE 3 + 1
            // existed; onto a plot-season that already follows something on the server it must not become a second followed schedule
            // nobody chose there (Open point 5). The phone then shows the server's choice.
            if (command.CarryOver && active.Count > 0)
            {
                return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
            }

            // A row with no place (written by a binary that sets none) still counts toward the limit of its kind.
            var ofThisKind = active.Count(s => (s.Origin == ScheduleOrigin.Own) == (origin == ScheduleOrigin.Own));
            var maxOfKind = origin == ScheduleOrigin.Own ? ScheduleSlots.MaxOwnSchedulesPerPlot : ScheduleSlots.MaxOutsideSchedulesPerPlot;
            var slot = ofThisKind >= maxOfKind
                ? null
                : ScheduleSlots.NextFree(origin, active.Where(s => s.Slot.HasValue).Select(s => s.Slot!.Value));
            if (slot is null)
            {
                return Result.Failure<ScheduleSubscriptionDto>(limit);
            }

            var staged = await StageAsync(slot.Value);
            switch (await repository.TrySaveScheduleSubscriptionAsync(ct))
            {
                case ScheduleSubscriptionSave.Saved:
                    subscription = staged;
                    break;
                case ScheduleSubscriptionSave.TemplateAlreadyFollowed:
                    return Result.Failure<ScheduleSubscriptionDto>(ShramSafalErrors.ScheduleAlreadyAdopted);
                default:
                    // A rival took the place first: the next loop re-reads once; a second loss is the limit.
                    break;
            }
        }

        if (subscription is null)
        {
            return Result.Failure<ScheduleSubscriptionDto>(limit);
        }

        // spec: plr-d10 lane SCH-OWN - a farm's own schedule carries no check state (D-82 = 3).
        return Result.Success(subscription.ToDto(choice.Value.Origin == ScheduleOrigin.Own ? null : choice.Value.LiveCheckState.ToString()));
    }
}
