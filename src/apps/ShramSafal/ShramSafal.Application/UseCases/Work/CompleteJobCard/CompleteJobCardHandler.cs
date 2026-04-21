using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Work.CompleteJobCard;

/// <summary>
/// CEI Phase 4 §4.8 — Task 2.1.4.
/// Completes a JobCard and links it to a DailyLog.
/// Validates that the daily log belongs to the same farm+plot and shares at least
/// one ActivityType with the job card's line items.
/// </summary>
public sealed class CompleteJobCardHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<CompleteJobCardResult>> HandleAsync(
        CompleteJobCardCommand command,
        CancellationToken ct = default)
    {
        // 1. Load job card.
        var jobCard = await repository.GetJobCardByIdAsync(command.JobCardId, ct);
        if (jobCard is null)
            return Result.Failure<CompleteJobCardResult>(ShramSafalErrors.JobCardNotFound);

        // 2. Load daily log.
        var dailyLog = await repository.GetDailyLogByIdAsync(command.DailyLogId, ct);
        if (dailyLog is null)
            return Result.Failure<CompleteJobCardResult>(ShramSafalErrors.DailyLogNotFound);

        // 3. Assert same farm + plot.
        if (dailyLog.FarmId != jobCard.FarmId || dailyLog.PlotId != jobCard.PlotId)
            return Result.Failure<CompleteJobCardResult>(ShramSafalErrors.JobCardDailyLogMismatch);

        // 4. Assert at least one matching ActivityType.
        var jobActivityTypes = jobCard.LineItems
            .Select(li => li.ActivityType)
            .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var hasMatchingActivity = dailyLog.Tasks
            .Any(t => jobActivityTypes.Contains(t.ActivityType));

        if (!hasMatchingActivity)
            return Result.Failure<CompleteJobCardResult>(ShramSafalErrors.JobCardActivityTypeMismatch);

        // 5. Delegate to domain.
        try
        {
            jobCard.CompleteWithLog(command.DailyLogId, command.CallerUserId, clock.UtcNow);
        }
        catch (InvalidOperationException)
        {
            return Result.Failure<CompleteJobCardResult>(ShramSafalErrors.JobCardInvalidState);
        }

        // 6. Emit audit event.
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farmId: jobCard.FarmId.Value,
                entityType: "JobCard",
                entityId: jobCard.Id,
                action: "jobcard.completed",
                actorUserId: command.CallerUserId.Value,
                actorRole: "Worker",
                payload: new { jobCard.Id, DailyLogId = command.DailyLogId, CompletedAtUtc = jobCard.CompletedAtUtc },
                clientCommandId: command.ClientCommandId,
                occurredAtUtc: clock.UtcNow),
            ct);

        await repository.SaveChangesAsync(ct);

        return Result.Success(new CompleteJobCardResult(
            jobCard.Id,
            command.DailyLogId,
            jobCard.CompletedAtUtc!.Value));
    }
}
