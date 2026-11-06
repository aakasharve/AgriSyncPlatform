using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;

public sealed class EditScheduleTemplateHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
    : IHandler<EditScheduleTemplateCommand, EditScheduleTemplateResult>
{
    private const string MutationType = "schedule.edit";

    public async Task<Result<EditScheduleTemplateResult>> HandleAsync(
        EditScheduleTemplateCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate
        if (command.SourceTemplateId == Guid.Empty || command.NewTemplateId == Guid.Empty || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.InvalidCommand);
        }

        // Step 2: idempotency check
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(
                command.ClientCommandId, command.ClientCommandId, ct);
            if (existing is not null)
            {
                var cached = JsonSerializer.Deserialize<EditScheduleTemplateResult>(existing.ResponsePayloadJson);
                if (cached is not null)
                {
                    return Result.Success(cached);
                }
            }
        }

        // Step 3: load source template
        var source = await repository.GetScheduleTemplateByIdAsync(command.SourceTemplateId, ct);
        if (source is null)
        {
            return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // Step 4: authz
        // spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88) — whose schedule the source is: one he may not see
        // is not found; a Private one is its maker's; a Team or Licensed one needs the farm named, and is that farm's
        // schedule edited by a holder of "पीक वेळापत्रकाचे नमुने" there, or his own (ScheduleTemplateWriteGate).
        if (await ScheduleTemplateWriteGate.RefuseEditAsync(
                repository, source, command.FarmId, command.CallerUserId, command.CallerRole, clock.UtcNow, ct) is { } refused)
        {
            return Result.Failure<EditScheduleTemplateResult>(refused);
        }

        // Step 5: copy-on-write edit — the new version records its maker, the editor (D-88: "each version shows who made it")
        var newTemplate = source.EditCopyOnWrite(
            command.NewTemplateId,
            command.NewName,
            command.NewStage,
            new UserId(command.CallerUserId),
            clock.UtcNow);

        // Step 6: persist
        await repository.AddScheduleTemplateAsync(newTemplate, ct);

        // Step 7: audit
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. ScheduleTemplate is a tenant-scoped artefact
        // (no farmId binding), so farmId is null.
        var audit = AuditEventFactory.Create(
            entityType: "ScheduleTemplate",
            entityId: command.NewTemplateId,
            action: "schedule.edited",
            actorUserId: command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                sourceId = command.SourceTemplateId,
                newVersion = newTemplate.Version
            },
            farmId: null,
            clientCommandId: command.ClientCommandId,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 8: save
        await repository.SaveChangesAsync(ct);

        // Step 9: store idempotency result
        var result = new EditScheduleTemplateResult(command.NewTemplateId, newTemplate.Version);

        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            await syncMutationStore.TryStoreSuccessAsync(
                command.ClientCommandId,
                command.ClientCommandId,
                MutationType,
                JsonSerializer.Serialize(result),
                clock.UtcNow,
                ct);
        }

        return Result.Success(result);
    }
}
