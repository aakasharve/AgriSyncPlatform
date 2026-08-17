// spec: dfes-companion-2026-07-11 (wave-4.4)

using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Work;

/// <summary>
/// <b>TIER 3 — what Shram Safal itself counts.</b> Founder model, 2026-08-17:
/// "Shram Safal generated number of completed tasks or completed field work hours."
///
/// <para>Nobody claims these. They fall out of work already recorded, which is the entire
/// reason they are worth anything to a farm that has never met the man: <b>a reference
/// letter can be written by a friend and a number can be invented — this can be
/// neither.</b></para>
///
/// <para><b>Doctrine P4 governs every field here: no fabricated numbers.</b> Derived from
/// real rows or absent. Never estimated, never defaulted, never back-filled to look
/// better. Every property is nullable for exactly that reason, and null means "Shram Safal
/// cannot honestly say" — which is a different statement from zero, and must be rendered
/// as nothing at all rather than as a zero a reader would take for a judgement on him.
/// </para>
/// </summary>
/// <param name="CompletedTasks">
/// Job cards this worker was assigned that actually reached a completed state. Null when
/// the permitted rows contain none — "we have not seen him complete work here" is not the
/// same claim as "he completed none", and only the first one is true.
/// </param>
/// <param name="FieldWorkHours">
/// Hours of field work completed. <b>Always null today — see
/// <see cref="WhyFieldWorkHoursAreNotCounted"/>.</b> The field exists because it is the
/// second thing the founder named, and because leaving it out would hide the gap instead
/// of stating it.
/// </param>
public sealed record WorkerDerivedCounts(int? CompletedTasks, decimal? FieldWorkHours)
{
    /// <summary>Nothing could be derived. Not a zero — an absence.</summary>
    public static readonly WorkerDerivedCounts Nothing = new(null, null);

    /// <summary>
    /// Why <see cref="FieldWorkHours"/> is null and must stay null until something real is
    /// recorded. Two candidate sources exist in the model today and NEITHER is hours worked:
    ///
    /// <list type="number">
    ///   <item><c>JobCardLineItem.ExpectedHours</c> is what the job was PLANNED to take,
    ///   typed by whoever wrote the card before the work happened. Reporting a plan as an
    ///   achievement is precisely the fabrication P4 forbids.</item>
    ///   <item><c>JobCard.StartedAtUtc</c> → <c>CompletedAtUtc</c> is elapsed wall-clock,
    ///   not time worked — it counts lunch, rain and the walk home. It is also frequently
    ///   absent: <c>CompleteWithLog</c> is reachable straight from <c>Assigned</c>, so a
    ///   quick-turn card has no start stamp at all.</item>
    /// </list>
    ///
    /// <para>Making this real needs an actual record of hours worked — a stamped start and
    /// stop by the worker, or the owner stating the hours. Until one exists, the honest
    /// output is nothing.</para>
    /// </summary>
    public const string WhyFieldWorkHoursAreNotCounted =
        "field_work_hours_not_recorded: only planned hours and elapsed wall-clock exist today";

    /// <summary>
    /// Count what the permitted job cards genuinely say about this worker.
    /// </summary>
    /// <remarks>
    /// <paramref name="permittedFarmIds"/> is not advisory. It is the tier-3 half of the
    /// boundary: the count is derived only over farms the caller is entitled to, so an
    /// unconsented reader gets a count of the work he could already see rather than a
    /// figure quietly folding in another farm's record. Pass
    /// <c>WorkerRecordAccess.PermittedFarmIds</c>, never a raw client-supplied list.
    /// </remarks>
    public static WorkerDerivedCounts FromJobCards(
        IEnumerable<JobCard> jobCards,
        UserId workerUserId,
        IReadOnlyCollection<Guid> permittedFarmIds)
    {
        ArgumentNullException.ThrowIfNull(jobCards);
        ArgumentNullException.ThrowIfNull(permittedFarmIds);

        var farms = permittedFarmIds.Distinct().ToHashSet();

        var completed = jobCards.Count(j =>
            j.AssignedWorkerUserId == workerUserId
            && farms.Contains(j.FarmId.Value)
            && IsCompleted(j.Status));

        // Zero completions is reported as nothing, not as 0. A "0" beside a man's name
        // reads as a verdict on him; the truth is only that this system has not seen him
        // finish anything here yet.
        int? completedTasks = completed == 0 ? null : completed;

        // See WhyFieldWorkHoursAreNotCounted. Do not fill this in from ExpectedHours, and
        // do not fill it in from StartedAtUtc → CompletedAtUtc either.
        decimal? fieldWorkHours = null;

        return new WorkerDerivedCounts(completedTasks, fieldWorkHours);
    }

    /// <summary>
    /// The work is done and stayed done. <c>Completed</c> is the worker's own milestone;
    /// the two states past it are the farm confirming and paying, and a card cannot leave
    /// them (both are terminal in <see cref="JobCard"/>).
    ///
    /// <para><c>Cancelled</c> is excluded, and so is everything before <c>Completed</c> —
    /// counting an assigned-but-unfinished card would be crediting work that has not
    /// happened.</para>
    /// </summary>
    private static bool IsCompleted(JobCardStatus status)
        => status is JobCardStatus.Completed
            or JobCardStatus.VerifiedForPayout
            or JobCardStatus.PaidOut;
}
