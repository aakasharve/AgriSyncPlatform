using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;

public sealed class CloneScheduleTemplateHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
    : IHandler<CloneScheduleTemplateCommand, CloneScheduleTemplateResult>
{
    // spec: plr-d10 lane SCH-OWN fix round 1 (M008) - a stored answer belongs to the PERSON who made the request: another person's command id never
    // returns it. (The store's first key part is a device id elsewhere; here it is "user:<id>".)
    private static string ReplayKey(Guid callerUserId) => $"user:{callerUserId:N}";

    private const string MutationType = "schedule.clone";

    public async Task<Result<CloneScheduleTemplateResult>> HandleAsync(
        CloneScheduleTemplateCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate
        if (command.SourceTemplateId == Guid.Empty ||
            command.NewTemplateId == Guid.Empty ||
            command.CallerUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.Reason))
        {
            return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.InvalidCommand);
        }

        // Step 2: idempotency check
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(
                ReplayKey(command.CallerUserId), command.ClientCommandId, ct);
            if (existing is not null)
            {
                var cached = JsonSerializer.Deserialize<CloneScheduleTemplateResult>(existing.ResponsePayloadJson);
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
            return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // spec: plr-d10 lane L8b-1 fix round 1 (review H3) — only a schedule he may see is copied: another account's
        // Private or Team one is answered exactly like an unknown id (E4).
        if (await ScheduleTemplateWriteGate.RefuseCopyAsync(repository, source, command.CallerUserId, ct) is { } unseen)
        {
            return Result.Failure<CloneScheduleTemplateResult>(unseen);
        }

        // Step 4: scope authz — per-scope role gate (CEI Phase 2 §4.7)
        //
        // Public  → only backend seed job; handler path always rejected
        // Licensed → PrimaryOwner | SecondaryOwner | Agronomist | Consultant
        // Team     → all Licensed roles + FpcTechnicalManager
        // Private  → any authenticated farm member (no role restriction)
        //
        // spec: plr-d10 lane SCH-OWN — into the farm's OWN schedule (D-82 = 3) the rule is OwnScheduleGate (never ScopeRoleGate: the account's
        // global role decides nothing here, R31), asked BEFORE own_farm_id is ever set (E4: a foreign-key check bypasses row-level security),
        // and the source must be a schedule ShramSafal has checked NOW (D4) of a crop this farm grows (D5).
        if (command.IntoFarmOwn)
        {
            if (await ScheduleTemplateWriteGate.RefuseCloneIntoFarmOwnAsync(
                    repository, source, command.FarmId, command.NewScope, command.CallerUserId, clock.UtcNow, ct) is { } refusedOwn)
            {
                return Result.Failure<CloneScheduleTemplateResult>(refusedOwn);
            }
        }
        else if (!await ScopeRoleGate.IsAllowedAsync(
                repository, command.NewScope, command.FarmId, command.CallerUserId, command.CallerRole, clock.UtcNow, ct))
        {
            return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.Forbidden);
        }

        // spec: plr-d10 lane SCH-OWN (E4; D10) — the id is a new one: a row that already has it is never overwritten (the table has no row
        // policy, so the answer is the same for a row the caller may not see).
        if (await repository.GetScheduleTemplateByIdAsync(command.NewTemplateId, ct) is not null)
        {
            return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.ScheduleIdTaken);
        }

        // Step 5: clone
        var newTemplate = source.Clone(
            command.NewTemplateId,
            new UserId(command.CallerUserId),
            command.NewScope,
            command.Reason,
            clock.UtcNow,
            ownFarmId: command.IntoFarmOwn ? command.FarmId : null);

        // Step 6: persist new template
        await repository.AddScheduleTemplateAsync(newTemplate, ct);

        // Step 7-8: audit
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. ScheduleTemplate is a tenant-scoped artefact
        // (no farmId binding), so farmId is null.
        var audit = AuditEventFactory.Create(
            entityType: "ScheduleTemplate",
            entityId: command.NewTemplateId,
            action: "schedule.cloned",
            actorUserId: command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                sourceTemplateId = command.SourceTemplateId,
                newScope = command.NewScope.ToString(),
                reason = command.Reason,
                intoFarmOwn = command.IntoFarmOwn,
                ownFarmId = command.IntoFarmOwn ? command.FarmId : null
            },
            farmId: null,
            clientCommandId: command.ClientCommandId,
            appVersion: command.ClientAppVersion,
            deviceId: command.AuditDeviceId,
            ipHash: command.AuditIpHash,
            sourceAiJobId: null);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 9: save
        // spec: plr-d10 lane L8b-1 fix round 1 (review M1) — one copy per source and version is all the index allows
        // (ix_schedule_templates_derived_version, which lane SCH-OWN re-keys): a second copy is answered 409 with words,
        // never a 500, and nothing of it is kept.
        // spec: plr-d10 lane SCH-OWN — the same save also answers the own-copy-per-farm index (one own copy of a source per farm) and a rival
        // that took the id between the check above and this save.
        switch (await repository.TrySaveNewScheduleAsync(ct))
        {
            case ScheduleCopySave.CopyExists:
                return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.ScheduleCopyExists);
            case ScheduleCopySave.IdTaken:
                // M011: a rival saved this id between the check and the save - this request's own earlier success is a replay, anything else is taken.
                if (await repository.GetScheduleTemplateByIdAsync(command.NewTemplateId, ct) is not { } stored
                    || !ScheduleReplay.IsSameRequest(stored, newTemplate))
                {
                    return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.ScheduleIdTaken);
                }

                break;
        }

        // Step 10: store idempotency result
        var result = new CloneScheduleTemplateResult(
            command.NewTemplateId,
            Version: 1,
            DerivedFromTemplateId: newTemplate.DerivedFromTemplateId);

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
