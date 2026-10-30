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

    /// <summary>
    /// spec: plr-d10 (I27; founder D-44, D-46) — the record version
    /// (<see cref="DailyLog.ContentVersion"/>) an authorised person confirmed. Set ONLY on the
    /// <see cref="VerificationStatus.Verified"/> event of an owner confirmation; null on every
    /// other event and on every event written before this change.
    /// </summary>
    public int? ConfirmedLogVersion { get; private set; }

    /// <summary>
    /// spec: plr-d10 (I27; founder D-44) — how the confirmer reviewed the record:
    /// <see cref="Logs.ReviewBasis.Heard"/> (he played the original voice) or
    /// <see cref="Logs.ReviewBasis.Read"/> (he confirmed from the text without listening).
    /// Null = not stated (an older phone, or not an owner confirmation).
    /// </summary>
    public string? ReviewBasis { get; private set; }

    /// <summary>
    /// Stamps the confirmation evidence on THIS event before it is first saved (a verification
    /// event is written once and never updated; history is added, never rewritten).
    /// </summary>
    internal void RecordConfirmationEvidence(int confirmedLogVersion, string? reviewBasis)
    {
        if (Status != VerificationStatus.Verified)
        {
            throw new InvalidOperationException("Only a Verified event carries confirmation evidence.");
        }

        if (confirmedLogVersion < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(confirmedLogVersion), confirmedLogVersion,
                "A record version starts at 1.");
        }

        ConfirmedLogVersion = confirmedLogVersion;
        ReviewBasis = reviewBasis;
    }
}
