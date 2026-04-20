using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Logs;

public sealed class VerificationEvent : Entity<Guid>
{
    private VerificationEvent() : base(Guid.Empty) { } // EF Core

    internal VerificationEvent(
        Guid id,
        Guid dailyLogId,
        VerificationStatus status,
        string? reason,
        UserId verifiedByUserId,
        DateTime occurredAtUtc)
        : base(id)
    {
        if (status == VerificationStatus.Disputed && string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException("Reason is required when disputing a log.", nameof(reason));
        }

        DailyLogId = dailyLogId;
        Status = status;
        Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim();
        VerifiedByUserId = verifiedByUserId;
        OccurredAtUtc = occurredAtUtc;
    }

    public Guid DailyLogId { get; private set; }
    public VerificationStatus Status { get; private set; }
    public string? Reason { get; private set; }
    public UserId VerifiedByUserId { get; private set; }
    public DateTime OccurredAtUtc { get; private set; }
}
