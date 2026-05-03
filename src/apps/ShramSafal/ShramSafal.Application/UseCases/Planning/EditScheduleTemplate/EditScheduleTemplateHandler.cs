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

/// <summary>
/// CEI Phase 2 §4.7 — copy-on-write edit of a schedule template. Source
/// template stays untouched; a new template version is materialised.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (EditScheduleTemplate): caller-shape
/// validation lives in <see cref="EditScheduleTemplateValidator"/>;
/// source-template existence + (Private-author OR per-scope role gate)
/// authorization lives in <see cref="EditScheduleTemplateAuthorizer"/>.
/// When this handler is resolved via the pipeline, both run before the
/// body. The body keeps its inline gates as defense-in-depth for direct
/// callers (legacy domain tests).
/// </para>
/// </summary>
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
        if (source.TenantScope == TenantScope.Private)
        {
            // Private templates: only the author may edit
            if (source.CreatedByUserId is null || source.CreatedByUserId.Value.Value != command.CallerUserId)
            {
                return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.Forbidden);
            }
        }
        else
        {
            // Non-private: apply the scope/role gate (CEI Phase 2 §4.7)
            if (!ScopeRoleGate.IsAllowed(source.TenantScope, command.CallerRole))
            {
                return Result.Failure<EditScheduleTemplateResult>(ShramSafalErrors.Forbidden);
            }
        }

        // Step 5: copy-on-write edit
        var newTemplate = source.EditCopyOnWrite(
            command.NewTemplateId,
            command.NewName,
            command.NewStage,
            new UserId(command.CallerUserId),
            clock.UtcNow);

        // Step 6: persist
        await repository.AddScheduleTemplateAsync(newTemplate, ct);

        // Step 7: audit
        var audit = AuditEvent.Create(
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
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: clock.UtcNow);

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
