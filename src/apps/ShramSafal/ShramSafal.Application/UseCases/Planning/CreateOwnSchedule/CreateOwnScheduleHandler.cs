using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CreateOwnSchedule;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 (founder D-74, D-82 = 3; R31) and lane SCH-OWN-c (founder D-137
/// Q9 = 1 / Q10 = 1; F222 (c)): "start blank". Makes a person's OWN schedule - Team, version 1, owned by the OWNER of the farm named, typed by the
/// caller, EMPTY (no stage and no work: it stores no days, so it cannot be followed or checked until a version with days is made; P4) - for a crop
/// THE FARM GROWS, with what it was made for (four optional tags). In order:
/// <list type="number">
/// <item>the shape (ids, a name of 1 to 120, a crop of 1 to 60): <see cref="ShramSafalErrors.InvalidCommand"/>; a made-for tag outside its list
/// (<see cref="MadeForLists"/>): <c>ShramSafal.ScheduleMadeFor</c> (a validation refusal: 400, a permanent push failure);</item>
/// <item>a repeated request (same client command id): the stored answer, nothing written;</item>
/// <item><see cref="OwnScheduleGate.OwnerIfAllowedAsync"/> - the farm's owner, or an Active seat holding "पीक वेळापत्रकाचे नमुने" there; never the
/// account's global role (R31) - asked BEFORE anything else about the farm is read: <see cref="ShramSafalErrors.Forbidden"/>. It answers the farm's
/// OWNER, read from the SAME farm row the gate trusted (E4), never from the body: that person owns the schedule, whoever typed it (Q9 = 1);</item>
/// <item>the id is new (E4; D10): a row that already has it is never overwritten - <see cref="ShramSafalErrors.ScheduleIdTaken"/> (409);</item>
/// <item>the crop is one ShramSafal knows and the farm grows (any season, D5): <see cref="ShramSafalErrors.ScheduleCropNotOnFarm"/>.</item>
/// </list>
/// The audit row (<c>schedule.created</c>) carries no farm id on the row, like the other schedule-template audit rows (D8); its payload names the
/// owner, the farm, the crop, the name and the tags.
/// </summary>
public sealed class CreateOwnScheduleHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
    : IHandler<CreateOwnScheduleCommand, CreateOwnScheduleResult>
{
    // spec: plr-d10 lane SCH-OWN fix round 1 (M008) - a stored answer belongs to the PERSON who made the request: another person's command id never
    // returns it. (The store's first key part is a device id elsewhere; here it is "user:<id>".)
    private static string ReplayKey(Guid callerUserId) => $"user:{callerUserId:N}";

    private const string MutationType = "schedule.create";

    public async Task<Result<CreateOwnScheduleResult>> HandleAsync(
        CreateOwnScheduleCommand command,
        CancellationToken ct = default)
    {
        if (new CreateOwnScheduleValidator().Validate(command).Any())
        {
            return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.InvalidCommand);
        }

        // spec: plr-d10 lane SCH-OWN-c (D-137, Q10 = 1) - the made-for tags are list codes (shape and list, MadeForLists): a tag outside its list is a
        // validation refusal with words, before anything is read or written. Tags never refuse a follow.
        var madeFor = new ScheduleMadeFor(command.Variety, command.SoilType, command.Region, command.Climate).Normalize();
        if (MadeForLists.Check(command.CropKey, madeFor) is { } tagProblem)
        {
            return Result.Failure<CreateOwnScheduleResult>(Error.Validation("ShramSafal.ScheduleMadeFor", tagProblem.Message));
        }

        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(ReplayKey(command.CallerUserId), command.ClientCommandId, ct);
            if (existing is not null)
            {
                var cached = JsonSerializer.Deserialize<CreateOwnScheduleResult>(existing.ResponsePayloadJson);
                if (cached is not null)
                {
                    return Result.Success(cached);
                }
            }
        }

        // The gate names the farm's OWNER from the row it trusted (E4): whose schedule this is (Q9 = 1), whoever types it.
        if (await OwnScheduleGate.OwnerIfAllowedAsync(repository, command.FarmId, command.CallerUserId, clock.UtcNow, ct) is not { } owner)
        {
            return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.Forbidden);
        }

        if (await repository.GetScheduleTemplateByIdAsync(command.ScheduleTemplateId, ct) is not null)
        {
            return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.ScheduleIdTaken);
        }

        if (!await ScheduleTemplateWriteGate.FarmGrowsAsync(repository, command.FarmId, command.CropKey, ct))
        {
            return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.ScheduleCropNotOnFarm);
        }

        var template = ScheduleTemplate.CreateOwn(
            command.ScheduleTemplateId, command.Name, command.CropKey, new UserId(owner), new UserId(command.CallerUserId), clock.UtcNow, madeFor);
        await repository.AddScheduleTemplateAsync(template, ct);

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleTemplate",
                entityId: command.ScheduleTemplateId,
                action: "schedule.created",
                actorUserId: command.CallerUserId,
                actorRole: command.CallerRole.ToString().ToLowerInvariant(),
                payload: new
                {
                    ownerUserId = owner,
                    farmId = command.FarmId,
                    cropKey = template.CropKey,
                    name = template.Name,
                    variety = template.Variety,
                    soilType = template.SoilType,
                    region = template.Region,
                    climate = template.Climate,
                },
                farmId: null,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        switch (await repository.TrySaveNewScheduleAsync(ct))
        {
            case ScheduleCopySave.CopyExists:
                return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.ScheduleCopyExists);
            case ScheduleCopySave.IdTaken:
                // A rival saved this id between the check and the save: the row now stored is either THIS request's own earlier success (a replay)
                // or someone else's schedule (taken).
                if (await repository.GetScheduleTemplateByIdAsync(command.ScheduleTemplateId, ct) is not { } stored
                    || !ScheduleReplay.IsSameRequest(stored, template))
                {
                    return Result.Failure<CreateOwnScheduleResult>(ShramSafalErrors.ScheduleIdTaken);
                }

                break;
        }

        var result = new CreateOwnScheduleResult(command.ScheduleTemplateId, template.Version);
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            await syncMutationStore.TryStoreSuccessAsync(
                ReplayKey(command.CallerUserId),
                command.ClientCommandId,
                MutationType,
                JsonSerializer.Serialize(result),
                clock.UtcNow,
                ct);
        }

        return Result.Success(result);
    }
}
