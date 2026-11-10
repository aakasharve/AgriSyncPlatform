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
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 3 (founder D-74, D-82 = 3; R30, R31): "start blank". Makes the
/// farm's OWN schedule - Team, version 1, owned by the farm, EMPTY (no stage and no work: it stores no days, so it cannot be followed or
/// checked until a version with days is made; P4) - for a crop THE FARM GROWS. In order:
/// <list type="number">
/// <item>the shape (ids, a name of 1 to 120, a crop of 1 to 60): <see cref="ShramSafalErrors.InvalidCommand"/>;</item>
/// <item>a repeated request (same client command id): the stored answer, nothing written;</item>
/// <item><see cref="OwnScheduleGate"/> - the farm's owner, or an Active seat holding "पीक वेळापत्रकाचे नमुने" there; never the account's global
/// role (R31) - asked BEFORE anything about the farm is read and before <c>own_farm_id</c> is set (E4: a foreign-key check bypasses
/// row-level security): <see cref="ShramSafalErrors.Forbidden"/>;</item>
/// <item>the id is new (E4; D10): a row that already has it is never overwritten - <see cref="ShramSafalErrors.ScheduleIdTaken"/> (409);</item>
/// <item>the crop is one ShramSafal knows and the farm grows (any season, D5): <see cref="ShramSafalErrors.ScheduleCropNotOnFarm"/>.</item>
/// </list>
/// The audit row (<c>schedule.created</c>) carries no farm id, like the other schedule-template audit rows (D8).
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

        if (!await OwnScheduleGate.AllowsAsync(repository, command.FarmId, command.CallerUserId, clock.UtcNow, ct))
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
            command.ScheduleTemplateId, command.Name, command.CropKey, command.FarmId, new UserId(command.CallerUserId), clock.UtcNow);
        await repository.AddScheduleTemplateAsync(template, ct);

        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "ScheduleTemplate",
                entityId: command.ScheduleTemplateId,
                action: "schedule.created",
                actorUserId: command.CallerUserId,
                actorRole: command.CallerRole.ToString().ToLowerInvariant(),
                payload: new { ownFarmId = command.FarmId, cropKey = template.CropKey, name = template.Name },
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
