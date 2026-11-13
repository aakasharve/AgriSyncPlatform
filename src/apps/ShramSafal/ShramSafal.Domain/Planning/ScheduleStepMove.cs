using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 - lane ATT-W (R29, path b; founder L8-C1 note). "पुढे ठरवा" on a step a FOLLOWED
/// schedule asks (a schedule step is read straight from the schedule's stored days, never a <c>PlannedActivity</c> row): ONE row says
/// "from schedule day <see cref="OriginalDate"/>, remind me on <see cref="NewDate"/> instead". <c>ssf.schedule_step_moves</c>.
///
/// <para><b>Append-only (doctrine P3).</b> A move is never edited and never removed (the database grants the app role SELECT and INSERT
/// only). The latest row per (<see cref="ScheduleSubscriptionId"/>, <see cref="TemplateActivityId"/>, <see cref="OriginalDate"/>) is the
/// step's reminder day; every earlier row is history. The row holds ids and dates only - no free text, no reason, no words of a person.</para>
///
/// <para><b>It changes ONLY when लक्ष द्या reminds.</b> The stage panel and तुलना keep the schedule's own day (what the schedule asked).</para>
/// </summary>
public sealed class ScheduleStepMove : Entity<Guid>
{
    private ScheduleStepMove() : base(Guid.Empty) { } // EF Core

    private ScheduleStepMove(
        Guid id,
        FarmId farmId,
        Guid scheduleSubscriptionId,
        Guid templateActivityId,
        DateOnly originalDate,
        DateOnly newDate,
        UserId movedByUserId,
        DateTime movedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        ScheduleSubscriptionId = scheduleSubscriptionId;
        TemplateActivityId = templateActivityId;
        OriginalDate = originalDate;
        NewDate = newDate;
        MovedByUserId = movedByUserId;
        MovedAtUtc = movedAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid ScheduleSubscriptionId { get; private set; }
    public Guid TemplateActivityId { get; private set; }

    /// <summary>The day the schedule itself asks the step (an <c>Expand</c> date).</summary>
    public DateOnly OriginalDate { get; private set; }

    /// <summary>The day लक्ष द्या reminds instead.</summary>
    public DateOnly NewDate { get; private set; }

    public UserId MovedByUserId { get; private set; }
    public DateTime MovedAtUtc { get; private set; }

    public static ScheduleStepMove Create(
        Guid id,
        FarmId farmId,
        Guid scheduleSubscriptionId,
        Guid templateActivityId,
        DateOnly originalDate,
        DateOnly newDate,
        UserId movedByUserId,
        DateTime movedAtUtc)
    {
        if (id == Guid.Empty)
        {
            throw new ArgumentException("Move id is required.", nameof(id));
        }

        if (farmId.IsEmpty)
        {
            throw new ArgumentException("FarmId is required.", nameof(farmId));
        }

        if (scheduleSubscriptionId == Guid.Empty)
        {
            throw new ArgumentException("Subscription id is required.", nameof(scheduleSubscriptionId));
        }

        if (templateActivityId == Guid.Empty)
        {
            throw new ArgumentException("Activity id is required.", nameof(templateActivityId));
        }

        if (movedByUserId.IsEmpty)
        {
            throw new ArgumentException("The mover is required.", nameof(movedByUserId));
        }

        return new ScheduleStepMove(
            id, farmId, scheduleSubscriptionId, templateActivityId, originalDate, newDate, movedByUserId,
            DateTime.SpecifyKind(movedAtUtc, DateTimeKind.Utc));
    }
}
