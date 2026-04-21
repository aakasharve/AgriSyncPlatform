using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Domain.Work;

/// <summary>
/// CEI-I9: raised when a PrimaryOwner/SecondaryOwner/Agronomist/FpcTechnicalManager
/// marks a completed job as verified for payout after the linked DailyLog is Verified.
/// </summary>
public sealed record JobCardVerifiedForPayoutEvent(
    Guid JobCardId,
    Guid LinkedDailyLogId,
    UserId VerifiedByUserId,
    AppRole VerifierRole,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
