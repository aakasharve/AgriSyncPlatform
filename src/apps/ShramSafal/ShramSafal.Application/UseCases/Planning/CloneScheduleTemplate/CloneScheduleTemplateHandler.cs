using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
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
                command.ClientCommandId, command.ClientCommandId, ct);
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

        // Step 4: scope authz — per-scope role gate (CEI Phase 2 §4.7)
        //
        // Public  → only backend seed job; handler path always rejected
        // Licensed → PrimaryOwner | SecondaryOwner | Agronomist | Consultant
        // Team     → all Licensed roles + FpcTechnicalManager
        // Private  → any authenticated farm member (no role restriction)
        if (!ScopeRoleGate.IsAllowed(command.NewScope, command.CallerRole))
        {
            return Result.Failure<CloneScheduleTemplateResult>(ShramSafalErrors.Forbidden);
        }

        // Step 5: clone
        var newTemplate = source.Clone(
            command.NewTemplateId,
            new UserId(command.CallerUserId),
            command.NewScope,
            command.Reason,
            clock.UtcNow);

        // Step 6: persist new template
        await repository.AddScheduleTemplateAsync(newTemplate, ct);

        // Step 7-8: audit
        var audit = AuditEvent.Create(
            farmId: null,
            entityType: "ScheduleTemplate",
            entityId: command.NewTemplateId,
            action: "schedule.cloned",
            actorUserId: command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                sourceTemplateId = command.SourceTemplateId,
                newScope = command.NewScope.ToString(),
                reason = command.Reason
            },
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: clock.UtcNow);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 9: save
        await repository.SaveChangesAsync(ct);

        // Step 10: store idempotency result
        var result = new CloneScheduleTemplateResult(
            command.NewTemplateId,
            Version: 1,
            DerivedFromTemplateId: newTemplate.DerivedFromTemplateId);

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
