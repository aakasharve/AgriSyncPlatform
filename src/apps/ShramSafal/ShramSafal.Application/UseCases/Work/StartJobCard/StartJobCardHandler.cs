using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.StartJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.3.
/// Starts a JobCard. The domain enforces that only the assigned worker may call this.
/// Idempotent when the same ClientCommandId is resubmitted.
/// </summary>
public sealed class StartJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
    : IHandler<StartJobCardCommand, StartJobCardResult>
{
    public async Task<Result<StartJobCardResult>> HandleAsync(
        StartJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<StartJobCardResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Idempotency: if already InProgress and the caller is the assigned worker,
        //    return the existing StartedAtUtc (same-timestamp idempotency).
        if (jobCard.StartedAtUtc.HasValue && jobCard.AssignedWorkerUserId == command.CallerUserId)
            return Result.Success(new StartJobCardResult(jobCard.Id, jobCard.StartedAtUtc.Value));

        // 3. Delegate to domain — domain enforces the assigned-worker invariant.
        try
        {
            jobCard.Start(command.CallerUserId, clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            // Domain says "only the assigned worker may start" or wrong status.
            return Result.Failure<StartJobCardResult>(ShramSafalErrors.JobCardRoleNotAllowed);
        }

        // 4. Emit audit event.
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor. Worker-initiated state transition; no AI job
        // correlation.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.started",
                actorUserId: command.CallerUserId.Value,
                actorRole: "Worker",
                payload: new { jobCard.Id, StartedAtUtc = jobCard.StartedAtUtc },
                farmId: jobCard.FarmId.Value,
                clientCommandId: command.ClientCommandId,
                appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                    ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                    : command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new StartJobCardResult(jobCard.Id, jobCard.StartedAtUtc!.Value));
    }
}
