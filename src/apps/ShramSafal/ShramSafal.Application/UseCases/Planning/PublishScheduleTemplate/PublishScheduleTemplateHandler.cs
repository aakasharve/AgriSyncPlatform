using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;

/// <summary>
/// CEI Phase 2 §4.7 — promotes a draft schedule template to published.
/// Idempotent on <see cref="PublishScheduleTemplateCommand.ClientCommandId"/>.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (PublishScheduleTemplate): caller-shape
/// validation lives in <see cref="PublishScheduleTemplateValidator"/>;
/// template existence + author + scope-role authorization lives in
/// <see cref="PublishScheduleTemplateAuthorizer"/>. When this handler
/// is resolved via the pipeline, both run before the body. The body
/// keeps its inline gates as defense-in-depth for direct callers
/// (legacy domain tests).
/// </para>
/// </summary>
public sealed class PublishScheduleTemplateHandler(
    IShramSafalRepository repository,
    ISyncMutationStore syncMutationStore,
    IClock clock)
    : IHandler<PublishScheduleTemplateCommand, PublishScheduleTemplateResult>
{
    private const string MutationType = "schedule.publish";

    public async Task<Result<PublishScheduleTemplateResult>> HandleAsync(
        PublishScheduleTemplateCommand command,
        CancellationToken ct = default)
    {
        // Step 1: validate
        if (command.TemplateId == Guid.Empty || command.CallerUserId == Guid.Empty)
        {
            return Result.Failure<PublishScheduleTemplateResult>(ShramSafalErrors.InvalidCommand);
        }

        // Step 2: idempotency check
        if (!string.IsNullOrWhiteSpace(command.ClientCommandId))
        {
            var existing = await syncMutationStore.GetAsync(
                command.ClientCommandId, command.ClientCommandId, ct);
            if (existing is not null)
            {
                var cached = JsonSerializer.Deserialize<PublishScheduleTemplateResult>(existing.ResponsePayloadJson);
                if (cached is not null)
                {
                    return Result.Success(cached);
                }
            }
        }

        // Step 3: load template
        var template = await repository.GetScheduleTemplateByIdAsync(command.TemplateId, ct);
        if (template is null)
        {
            return Result.Failure<PublishScheduleTemplateResult>(ShramSafalErrors.ScheduleTemplateNotFound);
        }

        // Step 4a: only the author may publish
        if (template.CreatedByUserId is null || template.CreatedByUserId.Value.Value != command.CallerUserId)
        {
            return Result.Failure<PublishScheduleTemplateResult>(ShramSafalErrors.Forbidden);
        }

        // Step 4b: scope role gate (CEI Phase 2 §4.7)
        // Publishing to Licensed / Team scopes requires the matching role set.
        if (!ScopeRoleGate.IsAllowed(template.TenantScope, command.CallerRole))
        {
            return Result.Failure<PublishScheduleTemplateResult>(ShramSafalErrors.Forbidden);
        }

        // Step 5: publish (mutates template in-place)
        template.Publish(new UserId(command.CallerUserId), clock.UtcNow);

        // Step 6: audit
        var audit = AuditEvent.Create(
            entityType: "ScheduleTemplate",
            entityId: command.TemplateId,
            action: "schedule.published",
            actorUserId: command.CallerUserId,
            actorRole: command.CallerRole.ToString().ToLowerInvariant(),
            payload: new
            {
                templateId = command.TemplateId,
                version = template.Version,
                publishedAtUtc = template.PublishedAtUtc
            },
            clientCommandId: command.ClientCommandId,
            occurredAtUtc: clock.UtcNow);

        await repository.AddAuditEventAsync(audit, ct);

        // Step 7: save
        await repository.SaveChangesAsync(ct);

        // Step 8: store idempotency result
        var result = new PublishScheduleTemplateResult(template.PublishedAtUtc!.Value, template.Version);

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
