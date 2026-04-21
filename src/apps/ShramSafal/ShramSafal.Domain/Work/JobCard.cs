using AgriSync.BuildingBlocks.Domain;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Logs;

namespace ShramSafal.Domain.Work;

/// <summary>
/// Work Trust Ledger aggregate — CEI Phase 4 §4.8.
/// Tracks the lifecycle of a piece of agricultural work from planning
/// through assignment, execution, verification, and payout.
/// </summary>
public sealed class JobCard : Entity<Guid>
{
    private readonly List<JobCardLineItem> _lineItems = [];

    // EF Core parameterless constructor
    private JobCard() : base(Guid.Empty) { }

    private JobCard(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid? cropCycleId,
        UserId createdByUserId,
        DateOnly plannedDate,
        IEnumerable<JobCardLineItem> items,
        DateTime createdAtUtc) : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        CropCycleId = cropCycleId;
        CreatedByUserId = createdByUserId;
        PlannedDate = plannedDate;
        _lineItems.AddRange(items);
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
        Status = JobCardStatus.Draft;
    }

    // ─── Properties ──────────────────────────────────────────────────────────

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid? CropCycleId { get; private set; }
    public UserId CreatedByUserId { get; private set; }
    public UserId? AssignedWorkerUserId { get; private set; }
    public DateOnly PlannedDate { get; private set; }
    public JobCardStatus Status { get; private set; } = JobCardStatus.Draft;
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public DateTime? StartedAtUtc { get; private set; }
    public DateTime? CompletedAtUtc { get; private set; }
    public Guid? LinkedDailyLogId { get; private set; }
    public Guid? PayoutCostEntryId { get; private set; }

    public IReadOnlyCollection<JobCardLineItem> LineItems => _lineItems.AsReadOnly();

    /// <summary>
    /// Sum of RatePerHour × ExpectedHours for each line item.
    /// All line items must share the same currency (enforced at creation).
    /// </summary>
    public Money EstimatedTotal
    {
        get
        {
            if (_lineItems.Count == 0)
                return Money.Zero(Currency.Inr);

            var total = Money.Zero(_lineItems[0].RatePerHour.Currency);
            foreach (var item in _lineItems)
            {
                var lineTotal = new Money(item.RatePerHour.Amount * item.ExpectedHours,
                                         item.RatePerHour.Currency);
                total = total.Add(lineTotal);
            }
            return total;
        }
    }

    // ─── Factory ─────────────────────────────────────────────────────────────

    public static JobCard CreateDraft(
        Guid id,
        FarmId farmId,
        Guid plotId,
        Guid? cropCycleId,
        UserId createdByUserId,
        DateOnly plannedDate,
        IEnumerable<JobCardLineItem> items,
        DateTime createdAtUtc)
    {
        ArgumentNullException.ThrowIfNull(items, nameof(items));

        var itemList = items.ToList();
        if (itemList.Count == 0)
            throw new ArgumentException("At least one line item is required.", nameof(items));

        var job = new JobCard(id, farmId, plotId, cropCycleId, createdByUserId, plannedDate, itemList, createdAtUtc);

        job.Raise(new JobCardCreatedEvent(id, farmId, plotId, createdByUserId, createdAtUtc));

        return job;
    }

    // ─── State transitions ────────────────────────────────────────────────────

    /// <summary>
    /// Assign the job card to a worker. Assigner must have at least Mukadam role.
    /// </summary>
    public void Assign(UserId workerUserId, UserId assignerUserId, AppRole assignerRole, DateTime occurredAtUtc)
    {
        if (Status != JobCardStatus.Draft)
            throw new InvalidOperationException(
                $"Cannot assign a JobCard that is not in Draft status (current: {Status}).");

        if (!IsEligibleToAssign(assignerRole))
            throw new InvalidOperationException(
                $"Role {assignerRole} is not permitted to assign job cards. Requires Mukadam or higher.");

        AssignedWorkerUserId = workerUserId;
        Status = JobCardStatus.Assigned;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new JobCardAssignedEvent(Id, workerUserId, assignerUserId, assignerRole, occurredAtUtc));
    }

    /// <summary>
    /// Start the job. Only the exact assigned worker may call this.
    /// </summary>
    public void Start(UserId workerUserId, DateTime occurredAtUtc)
    {
        if (Status != JobCardStatus.Assigned)
            throw new InvalidOperationException(
                $"Cannot start a JobCard that is not in Assigned status (current: {Status}).");

        if (AssignedWorkerUserId != workerUserId)
            throw new InvalidOperationException(
                "Only the assigned worker may start this job card.");

        StartedAtUtc = occurredAtUtc;
        Status = JobCardStatus.InProgress;
        ModifiedAtUtc = occurredAtUtc;
    }

    /// <summary>
    /// Complete the job with a linked DailyLog.
    /// Allowed from InProgress or Assigned (quick-turn: assigned → completed in one step).
    /// </summary>
    public void CompleteWithLog(Guid dailyLogId, UserId completerUserId, DateTime occurredAtUtc)
    {
        if (Status != JobCardStatus.InProgress && Status != JobCardStatus.Assigned)
            throw new InvalidOperationException(
                $"Cannot complete a JobCard in status {Status}. Must be InProgress or Assigned.");

        LinkedDailyLogId = dailyLogId;
        CompletedAtUtc = occurredAtUtc;
        Status = JobCardStatus.Completed;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new JobCardCompletedEvent(Id, dailyLogId, completerUserId, occurredAtUtc));
    }

    /// <summary>
    /// Returns payout eligibility based on the verification status of the linked daily log.
    /// </summary>
    public PayoutEligibility CheckEligibility(VerificationStatus linkedLogStatus)
    {
        if (linkedLogStatus != VerificationStatus.Verified)
        {
            return new PayoutEligibility(
                IsEligible: false,
                ReasonEn: "Daily log must be verified before payout",
                ReasonMr: "पेआउटपूर्वी दैनंदिन नोंद सत्यापित असणे आवश्यक आहे");
        }

        return new PayoutEligibility(IsEligible: true, ReasonEn: null, ReasonMr: null);
    }

    /// <summary>
    /// CEI-I9: Mark the job card as verified for payout.
    /// Requires Status = Completed and linkedLogStatus = Verified.
    /// Verifier role must be PrimaryOwner, SecondaryOwner, Agronomist, or FpcTechnicalManager.
    /// </summary>
    public void MarkVerifiedForPayout(
        VerificationStatus linkedLogStatus,
        UserId verifierUserId,
        AppRole verifierRole,
        DateTime occurredAtUtc)
    {
        if (Status != JobCardStatus.Completed)
            throw new InvalidOperationException(
                $"Cannot verify for payout a JobCard in status {Status}. Must be Completed.");

        if (linkedLogStatus != VerificationStatus.Verified)
            throw new InvalidOperationException(
                "Daily log must have status Verified before this job card can be marked as VerifiedForPayout. " +
                "Verified status is required.");

        if (!IsEligibleToVerifyForPayout(verifierRole))
            throw new InvalidOperationException(
                $"Role {verifierRole} is not permitted to verify job cards for payout.");

        Status = JobCardStatus.VerifiedForPayout;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new JobCardVerifiedForPayoutEvent(
            Id,
            LinkedDailyLogId!.Value,
            verifierUserId,
            verifierRole,
            occurredAtUtc));
    }

    /// <summary>
    /// CEI-I8: Mark the job card as paid out, linking it to a CostEntry.
    /// Requires Status = VerifiedForPayout.
    /// </summary>
    public void MarkPaidOut(Guid costEntryId, DateTime occurredAtUtc)
    {
        if (Status != JobCardStatus.VerifiedForPayout)
            throw new InvalidOperationException(
                $"Cannot mark as paid out a JobCard in status {Status}. Must be VerifiedForPayout.");

        PayoutCostEntryId = costEntryId;
        Status = JobCardStatus.PaidOut;
        ModifiedAtUtc = occurredAtUtc;

        Raise(new JobCardPaidOutEvent(Id, costEntryId, occurredAtUtc));
    }

    /// <summary>
    /// Cancel the job card. Allowed from Draft, Assigned, InProgress, or Completed.
    /// Blocked from VerifiedForPayout and PaidOut (terminal guard).
    /// </summary>
    public void Cancel(UserId cancellerUserId, AppRole cancellerRole, string reason, DateTime occurredAtUtc)
    {
        if (Status is JobCardStatus.VerifiedForPayout or JobCardStatus.PaidOut)
            throw new InvalidOperationException(
                $"Cannot cancel a JobCard in terminal status {Status}. " +
                "VerifiedForPayout and PaidOut are terminal states.");

        if (Status == JobCardStatus.Cancelled)
            throw new InvalidOperationException("JobCard is already cancelled.");

        Status = JobCardStatus.Cancelled;
        ModifiedAtUtc = occurredAtUtc;
    }

    // ─── Private helpers ─────────────────────────────────────────────────────

    private static bool IsEligibleToAssign(AppRole role) =>
        role is AppRole.Mukadam
            or AppRole.PrimaryOwner
            or AppRole.SecondaryOwner;

    private static bool IsEligibleToVerifyForPayout(AppRole role) =>
        role is AppRole.PrimaryOwner
            or AppRole.SecondaryOwner
            or AppRole.Agronomist
            or AppRole.FpcTechnicalManager;
}
