using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Planning;

// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9, "One take with origin kept"; approved spec plr-d10-schedule-approved-spec-2026-11-23)

/// <summary>
/// Where an own work came from when the farmer TOOK it from a schedule the plot follows (<c>schedule.take_task</c>): the schedule's owner, the schedule
/// (version, its chain and its name then) and the task, and the farm-local day it was taken. One row per TAKE ACT that puts the own work in, numbered by Sequence within the work (the current origin is the latest row; old rows are history), written ONCE with
/// the work and never changed: APPEND-ONLY by privilege (the application role has SELECT and INSERT only). Approved spec: "Origin = owner, schedule, version,
/// task. It never changes. The farmer owns their copy." An edit, a move, a removal, a withdrawal of the source, a transfer of the farm and the next season all
/// leave this row exactly as it was; a withdrawn source or an erased creator changes how the origin is READ, never the row.
/// </summary>
public sealed class OwnScheduleItemOrigin : Entity<Guid>
{
    /// <summary>The prefix of the short origin text kept on the own work itself (<see cref="OwnScheduleItem.Origin"/>): <c>take:</c> and the version id, 32 hex digits.</summary>
    public const string TextPrefix = "take:";

    private OwnScheduleItemOrigin() : base(Guid.Empty) { } // EF Core

    private OwnScheduleItemOrigin(
        OwnScheduleItem item,
        Guid sourceVersionId,
        Guid? sourceChainId,
        string sourceName,
        int sourceVersionNumber,
        Guid? sourceOwnerUserId,
        string sourceTaskKey,
        string? chosenDose,
        UserId takenByUserId,
        DateOnly takenOn,
        DateTime takenAtUtc,
        int sequence)
        : base(Guid.NewGuid())
    {
        ItemId = item.Id;
        Sequence = sequence;
        FarmId = item.FarmId;
        PlotId = item.PlotId;
        CropCycleId = item.CropCycleId;
        OwnerUserId = item.OwnerUserId;
        TaskKey = item.TaskKey;
        SourceVersionId = sourceVersionId;
        SourceChainId = sourceChainId;
        SourceName = sourceName;
        SourceVersionNumber = sourceVersionNumber;
        SourceOwnerUserId = sourceOwnerUserId;
        SourceTaskKey = sourceTaskKey;
        ChosenDose = chosenDose;
        TakenByUserId = takenByUserId;
        TakenOn = takenOn;
        TakenAtUtc = takenAtUtc;
    }

    /// <summary>The own work this is an origin of.</summary>
    public Guid ItemId { get; private set; }

    /// <summary>1 for the first take of the work, one more for every later take that put it back; the highest is the current origin.</summary>
    public int Sequence { get; private set; }

    public FarmId FarmId { get; private set; }
    public Guid PlotId { get; private set; }
    public Guid CropCycleId { get; private set; }

    /// <summary>The owner of the farm when the work was taken (from the farm row, never a body); the database refuses any other value.</summary>
    public UserId OwnerUserId { get; private set; }

    /// <summary>The own work's key (the same as <see cref="SourceTaskKey"/>: the work keeps the key it has in the schedule).</summary>
    public string TaskKey { get; private set; } = string.Empty;

    /// <summary>The version of the schedule the work was taken from.</summary>
    public Guid SourceVersionId { get; private set; }

    /// <summary>The chain that version belongs to (a reference schedule's versions share one), or null.</summary>
    public Guid? SourceChainId { get; private set; }

    /// <summary>The schedule's name and version number at the time, so the origin can still be read when the schedule is withdrawn.</summary>
    public string SourceName { get; private set; } = string.Empty;
    public int SourceVersionNumber { get; private set; }

    /// <summary>The person the source schedule belongs to (its owner, else its maker), or null for a schedule that names none (a library reference).</summary>
    public Guid? SourceOwnerUserId { get; private set; }

    /// <summary>The key of the task in the source version.</summary>
    public string SourceTaskKey { get; private set; } = string.Empty;

    /// <summary>The dose the farmer picked when the work had several, as written in the source; null when none was picked.</summary>
    public string? ChosenDose { get; private set; }

    public UserId TakenByUserId { get; private set; }

    /// <summary>The farm-local day it was taken.</summary>
    public DateOnly TakenOn { get; private set; }

    public DateTime TakenAtUtc { get; private set; }

    /// <summary>The short text of an own work taken from <paramref name="sourceVersionId"/> (fits <c>own_schedule_items.origin</c>).</summary>
    public static string TextFor(Guid sourceVersionId) => TextPrefix + sourceVersionId.ToString("N");

    /// <summary>Whether <paramref name="origin"/> is the origin text of a taken work.</summary>
    public static bool IsTakenText(string? origin) => origin is not null && origin.StartsWith(TextPrefix, StringComparison.Ordinal);

    /// <summary>
    /// The origin of the COPY of a work carried into next season (slice 11): exactly the previous work's CURRENT origin (the same schedule owner, schedule, version, task, dose and the
    /// take that made it), sequence 1 of the new work. A withdrawn source stays withdrawn: nothing is re-read from the schedule. Origin never changes.
    /// </summary>
    public static OwnScheduleItemOrigin CarriedFrom(OwnScheduleItem item, OwnScheduleItemOrigin previous)
    {
        ArgumentNullException.ThrowIfNull(item);
        ArgumentNullException.ThrowIfNull(previous);
        return new OwnScheduleItemOrigin(
            item, previous.SourceVersionId, previous.SourceChainId, previous.SourceName, previous.SourceVersionNumber, previous.SourceOwnerUserId,
            previous.SourceTaskKey, previous.ChosenDose, previous.TakenByUserId, previous.TakenOn, previous.TakenAtUtc, 1);
    }

    /// <summary>The origin of the own work <paramref name="item"/>, taken from <paramref name="source"/> by <paramref name="takenBy"/>.</summary>
    public static OwnScheduleItemOrigin Of(
        OwnScheduleItem item,
        ScheduleTemplate source,
        string? chosenDose,
        UserId takenBy,
        DateOnly takenOn,
        DateTime takenAtUtc,
        int sequence = 1)
    {
        ArgumentNullException.ThrowIfNull(item);
        if (sequence < 1)
        {
            throw new ArgumentOutOfRangeException(nameof(sequence));
        }

        ArgumentNullException.ThrowIfNull(source);
        if (takenBy.IsEmpty)
        {
            throw new ArgumentException("A take names who took it.", nameof(takenBy));
        }

        return new OwnScheduleItemOrigin(
            item,
            source.Id,
            source.ChainId,
            source.Name,
            source.Version,
            (source.OwnerUserId ?? source.CreatedByUserId) is { } owner && !owner.IsEmpty ? owner.Value : null,
            item.TaskKey,
            chosenDose,
            takenBy,
            takenOn,
            takenAtUtc,
            sequence);
    }
}
