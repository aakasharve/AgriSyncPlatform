using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11, "Season end and next year"; approved spec plr-d10-schedule-approved-spec-2026-11-23, decision 3)

/// <summary>What the farmer said about one work of the season that ended: how it is carried into next season's own schedule.</summary>
public enum ScheduleCarryChoice
{
    /// <summary>"शेड्यूलप्रमाणे": the work as the own schedule wrote it (ideal and practice are the same, or he chose the written one).</summary>
    AsScheduled = 0,

    /// <summary>"मी केलं तसं": the work with the day (and the quantity, where the record has one) of what was recorded.</summary>
    AsIDid = 1,

    /// <summary>"नको": the work is not carried. Its row of this season stays (P3); only next season does without it.</summary>
    Skip = 2,

    /// <summary>A work that was only planned and never in the own schedule, which the farmer picked: asked, never copied by itself.</summary>
    PlanOnlyPicked = 3,
}

/// <summary>
/// The ONE place the content of a carried work is made. Pure: no clock, no database. The copy keeps every TIMER (a day from pruning, after a work, when seen),
/// never a literal date, so the dates follow the next pruning. "मी केलं तसं" changes only what the record states: the day of a once-only day-timer work, and a
/// quantity only when the record states BOTH the value and its unit; any part the record lacks keeps the work's own value (P4: nothing is invented). Safety gaps
/// (re-entry, pre-harvest) and the origin text are never touched: a gap never shrinks.
/// </summary>
public static class ScheduleCarry
{
    /// <summary>
    /// The content of the copy of <paramref name="previous"/>. <paramref name="recordedStoredDay"/> is the day of the record as a STORED day from the pruning of its season
    /// (shown - 1, <see cref="ScheduleDayNumbers"/>); <paramref name="recordedDose"/> a quantity with its unit exactly as the record states it, or null.
    /// </summary>
    public static ScheduleTaskContent Content(ScheduleTaskContent previous, ScheduleCarryChoice choice, int? recordedStoredDay, string? recordedDose)
    {
        ArgumentNullException.ThrowIfNull(previous);
        if (choice != ScheduleCarryChoice.AsIDid)
        {
            return previous;
        }

        var copy = previous;
        var timing = previous.Timing;
        if (recordedStoredDay is { } day
            && timing.Timer == ScheduleTimerKind.Day && timing.Repeat == ScheduleRepeatMode.Once && timing.FromDay is { } from)
        {
            var toDay = timing.ToDay is { } to ? day + Math.Max(0, to - from) : (int?)null;
            copy = copy with { Timing = timing with { FromDay = day, ToDay = toDay } };
        }

        if (!string.IsNullOrWhiteSpace(recordedDose))
        {
            copy = copy with { Dose = recordedDose.Trim() };
        }

        return copy;
    }
}

/// <summary>
/// One answer of the season-end review, written ONCE and never changed (APPEND-ONLY by privilege, <c>ssf.own_schedule_season_carries</c>): for the plot's season that
/// ended (<see cref="FromCropCycleId"/>) and the next (<see cref="CropCycleId"/>), what was said about the work <see cref="TaskKey"/> and which copy it made. One row per
/// (plot, from, to, key) - its id is a UUIDv5 of those four - so a replay or a second phone writes the same row, never a second copy (idempotent). A work the farmer did not
/// answer is carried as written and the row says so (<see cref="Answered"/> false): the review never refuses a save (P8). The row is also the previous-item link:
/// <see cref="PreviousItemId"/> is the work of the season that ended, <see cref="NewItemId"/> its copy (null when it was not carried).
/// </summary>
public sealed class OwnScheduleSeasonCarry : Entity<Guid>
{
    public static readonly Guid IdNamespace = Guid.Parse("5d2b7e41-96a3-4c08-b1f4-3a7c9e0d6285");

    private OwnScheduleSeasonCarry() : base(Guid.Empty) { } // EF Core

    private OwnScheduleSeasonCarry(
        Guid id, FarmId farmId, Guid plotId, Guid fromCropCycleId, Guid cropCycleId, UserId ownerUserId, string taskKey, Guid? previousItemId, Guid? newItemId,
        ScheduleCarryChoice choice, bool answered, int? recordedStoredDay, UserId decidedBy, DateTime decidedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        PlotId = plotId;
        FromCropCycleId = fromCropCycleId;
        CropCycleId = cropCycleId;
        OwnerUserId = ownerUserId;
        TaskKey = taskKey;
        PreviousItemId = previousItemId;
        NewItemId = newItemId;
        Choice = choice;
        Answered = answered;
        RecordedStoredDay = recordedStoredDay;
        DecidedByUserId = decidedBy;
        DecidedAtUtc = decidedAtUtc;
    }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }

    /// <summary>The crop season that ended.</summary>
    public Guid FromCropCycleId { get; private set; }

    /// <summary>The crop season the work is carried into (the column the place trigger checks).</summary>
    public Guid CropCycleId { get; private set; }

    public UserId OwnerUserId { get; private set; }
    public string TaskKey { get; private set; } = string.Empty;

    /// <summary>The work of the season that ended; null for a work that was only planned (never in the own schedule).</summary>
    public Guid? PreviousItemId { get; private set; }

    /// <summary>The copy in the next season, or null when the work was not carried.</summary>
    public Guid? NewItemId { get; private set; }

    public ScheduleCarryChoice Choice { get; private set; }

    /// <summary>False when the farmer left it unanswered and it was carried as written.</summary>
    public bool Answered { get; private set; }

    /// <summary>The stored day (from pruning) a "मी केलं तसं" took from the record; null when none was taken.</summary>
    public int? RecordedStoredDay { get; private set; }

    public UserId DecidedByUserId { get; private set; }
    public DateTime DecidedAtUtc { get; private set; }

    public static Guid IdFor(Guid plotId, Guid fromCropCycleId, Guid cropCycleId, string taskKey)
    {
        ArgumentException.ThrowIfNullOrEmpty(taskKey);
        return MoneyEntryIdentity.V5(
            IdNamespace,
            $"{plotId.ToString("D").ToLowerInvariant()}:{fromCropCycleId.ToString("D").ToLowerInvariant()}:{cropCycleId.ToString("D").ToLowerInvariant()}:{taskKey}");
    }

    public static OwnScheduleSeasonCarry Of(
        FarmId farmId, Guid plotId, Guid fromCropCycleId, Guid cropCycleId, UserId ownerUserId, string taskKey, Guid? previousItemId, Guid? newItemId,
        ScheduleCarryChoice choice, bool answered, int? recordedStoredDay, UserId decidedBy, DateTime decidedAtUtc) =>
        new(IdFor(plotId, fromCropCycleId, cropCycleId, taskKey), farmId, plotId, fromCropCycleId, cropCycleId, ownerUserId, taskKey, previousItemId, newItemId,
            choice, answered, recordedStoredDay, decidedBy, decidedAtUtc);
}
