using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Application.UseCases.Planning.CheckSchedule;
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
    // spec: plr-d10 lane SCH-OWN fix round 1 (M008) - a stored answer belongs to the PERSON who made the request: another person's command id never
    // returns it. (The store's first key part is a device id elsewhere; here it is "user:<id>".)
    private static string ReplayKey(Guid callerUserId) => $"user:{callerUserId:N}";

    private const string MutationType = "schedule.edit";

    public async Task<Result<EditScheduleTemplateResult>> HandleAsync(
        EditScheduleTemplateCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate. spec: plr-d10 lane SCH-OWN-c (R-c18) - a made-for tag comes only with a whole version (Stages): a rename carries the tags of
        // the version before and never rewrites them.
        var anyTag = command.Variety is not null || command.SoilType is not null || command.Region is not null || command.Climate is not null;
        if (command.SourceTemplateId == Guid.Empty || command.NewTemplateId == Guid.Empty || command.CallerUserId == Guid.Empty
            || (command.Stages is null && (command.Activities is not null || anyTag)))
        {
            return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.InvalidCommand);
        }

        // Step 2: idempotency check
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(
                ReplayKey(command.CallerUserId), command.ClientCommandId, ct);
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
        // spec: plr-d10 lane L8b-1 fix round 1 (review H3; founder D-88), lane SCH-OWN (R32) and SCH-OWN-c (D-137) — whose schedule the source is: one he
        // may not see is not found; a Private one is its owner's; a person's OWN schedule (names its owner) needs the farm named to be one of the
        // OWNER's farms and is then written by that farm's owner or an Active seat holding "पीक वेळापत्रकाचे नमुने" there; any other Team or Licensed one
        // needs the farm named and is its OWNER's alone, under the scope's author rule (a delegate no longer versions it: R32). All in ScheduleTemplateWriteGate.
        if (await ScheduleTemplateWriteGate.RefuseEditAsync(
                repository, source, command.FarmId, command.CallerUserId, command.CallerRole, clock.UtcNow, ct) is { } refused)
        {
            return Result.Failure<EditScheduleTemplateResult>(refused);
        }

        // spec: plr-d10 lane SCH-OWN (E4; D10) — the id is a new one: a row that already has it is never overwritten.
        if (await repository.GetScheduleTemplateByIdAsync(command.NewTemplateId, ct) is not null)
        {
            return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.ScheduleIdTaken);
        }

        // Step 5: copy-on-write edit — the new version records its maker, the editor (D-88: "each version shows who made it")
        ScheduleTemplate newTemplate;
        if (command.Stages is null)
        {
            // The old edit (a rename / a new stage label): unchanged, so a release that sends only that keeps working (P11).
            newTemplate = source.EditCopyOnWrite(
                command.NewTemplateId,
                command.NewName,
                command.NewStage,
                new UserId(command.CallerUserId),
                clock.UtcNow);
        }
        else
        {
            // spec: plr-d10 lane SCH-OWN (D7, D9) — the next version written whole, as sent: exactly these stages and works; the version
            // before is left as it was (P3). A day that does not hold is refused with the import rule's own words.
            var drafts = new List<ScheduleActivityDraft>(command.Activities?.Count ?? 0);
            foreach (var a in command.Activities ?? [])
            {
                if (!ImportScheduleTemplateHandler.TryParseMode(a.FrequencyMode, out var mode))
                {
                    return Result.Failure<EditScheduleTemplateResult>(Error.Validation(
                        "ShramSafal.ScheduleImportRepeat",
                        $"\"{a.Name}\": the repeat must be one_time, every_n_days or per_week."));
                }

                drafts.Add(new ScheduleActivityDraft(a.Name ?? string.Empty, a.Part ?? string.Empty, a.OperationKey, a.StartDay, a.EndDay, mode, a.IntervalDays));
            }

            // spec: plr-d10 lane SCH-OWN-c (D-137, Q10 = 1) — the made-for tags of the whole version, as sent (absent = none; the version before keeps its
            // own, P3); a tag outside its list is refused with words BEFORE anything is written (400 ShramSafal.ScheduleMadeFor / a permanent push failure).
            var madeFor = new ScheduleMadeFor(command.Variety, command.SoilType, command.Region, command.Climate).Normalize();
            if (MadeForLists.Check(source.CropKey, madeFor) is { } tagProblem)
            {
                return Result.Failure<EditScheduleTemplateResult>(Error.Validation("ShramSafal.ScheduleMadeFor", tagProblem.Message));
            }

            var edited = source.EditCopyOnWrite(
                command.NewTemplateId,
                command.NewName,
                command.NewStage,
                command.Stages.Select(s => new StageDefinition(s.Name ?? string.Empty, s.StartDay, s.EndDay)).ToList(),
                drafts,
                new UserId(command.CallerUserId),
                clock.UtcNow,
                out var problem,
                madeFor: madeFor);
            if (edited is null)
            {
                return Result.Failure<EditScheduleTemplateResult>(Error.Validation($"ShramSafal.{problem!.Code}", problem.Message));
            }

            newTemplate = edited;
        }

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

        // Step 8: save (spec: plr-d10 lane SCH-OWN - a rival that took the id between the check above and this save is answered, never a 500)
        switch (await repository.TrySaveNewScheduleAsync(ct))
        {
            case ScheduleCopySave.CopyExists:
                return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.ScheduleCopyExists);
            case ScheduleCopySave.IdTaken:
                // M011: a rival saved this id between the check and the save - this request's own earlier success is a replay, anything else is taken.
                if (await repository.GetScheduleTemplateByIdAsync(command.NewTemplateId, ct) is not { } stored
                    || !ScheduleReplay.IsSameRequest(stored, newTemplate))
                {
                    return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.ScheduleIdTaken);
                }

                break;
        }

        // Step 9: store idempotency result
        var result = new EditScheduleTemplateResult(command.NewTemplateId, newTemplate.Version);

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
