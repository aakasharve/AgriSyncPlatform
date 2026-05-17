// spec: data-principle-spine-2026-05-05/10.4
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy.Pii;

namespace ShramSafal.Application.UseCases.Privacy.PiiReview;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — admin reviewer
/// decision handler. Backs both the approve and reject endpoints; the
/// command's <see cref="ReviewPiiQueueEntryCommand.Decision"/> field
/// branches between the two aggregate methods.
/// </summary>
public sealed class ReviewPiiQueueEntryHandler(
    IShramSafalRepository repository,
    IClock clock)
{
    public async Task<Result<PiiReviewQueueEntry>> HandleAsync(
        ReviewPiiQueueEntryCommand command,
        CancellationToken ct)
    {
        if (command.EntryId == Guid.Empty || command.ReviewerUserId == Guid.Empty)
        {
            return Result.Failure<PiiReviewQueueEntry>(ShramSafalErrors.InvalidCommand);
        }

        var entry = await repository.GetPiiReviewQueueEntryAsync(command.EntryId, ct);
        if (entry is null)
        {
            return Result.Failure<PiiReviewQueueEntry>(
                new Error("pii_review.entry_not_found",
                    $"PII review queue entry {command.EntryId} not found.",
                    ErrorKind.NotFound));
        }

        if (entry.Status != PiiReviewStatus.Pending)
        {
            return Result.Failure<PiiReviewQueueEntry>(
                new Error("pii_review.already_reviewed",
                    $"Entry {command.EntryId} is in status {entry.Status} (not Pending).",
                    ErrorKind.Conflict));
        }

        var nowUtc = clock.UtcNow;
        if (command.Decision == PiiReviewDecision.Approve)
        {
            entry.Approve(command.ReviewerUserId, command.Note, nowUtc);
        }
        else
        {
            entry.Reject(command.ReviewerUserId, command.Note, nowUtc);
        }

        // Append an AuditEvent so the decision is traceable in the
        // standard audit ledger even though the queue table also
        // carries the reviewer id.
        var auditEvent = AuditEventFactory.Create(
            entityType: "PiiReviewQueueEntry",
            entityId: entry.Id,
            action: command.Decision == PiiReviewDecision.Approve
                ? "PiiReview.Approved"
                : "PiiReview.Rejected",
            actorUserId: command.ReviewerUserId,
            actorRole: "pii_reviewer",
            payload: new
            {
                transcriptId = entry.TranscriptId,
                note = command.Note,
                priorStatus = "Pending",
                newStatus = entry.Status.ToString(),
            },
            farmId: null,
            clientCommandId: null,
            appVersion: string.IsNullOrWhiteSpace(command.ClientAppVersion)
                ? AgriSync.BuildingBlocks.Persistence.AppVersionProvider.Current
                : command.ClientAppVersion,
            deviceId: string.IsNullOrWhiteSpace(command.AuditDeviceId) ? "admin" : command.AuditDeviceId,
            ipHash: string.IsNullOrWhiteSpace(command.AuditIpHash) ? "sha256:admin" : command.AuditIpHash);

        await repository.AddAuditEventAsync(auditEvent, ct);

        return Result.Success(entry);
    }
}

public enum PiiReviewDecision
{
    Approve = 1,
    Reject = 2,
}

public sealed record ReviewPiiQueueEntryCommand(
    Guid EntryId,
    Guid ReviewerUserId,
    PiiReviewDecision Decision,
    string? Note,
    string? ClientAppVersion,
    string? AuditDeviceId,
    string? AuditIpHash);
