using AgriSync.BuildingBlocks.Events;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Domain.Events;

public sealed class LogVerifiedEvent : DomainEvent
{
    public LogVerifiedEvent(
        Guid eventId,
        DateTime occurredOnUtc,
        Guid dailyLogId,
        VerificationStatus status,
        UserId verifiedByUserId)
        : base(eventId, occurredOnUtc)
    {
        DailyLogId = dailyLogId;
        Status = status;
        VerifiedByUserId = verifiedByUserId;
    }

    public Guid DailyLogId { get; }
    public VerificationStatus Status { get; }
    public UserId VerifiedByUserId { get; }
}
