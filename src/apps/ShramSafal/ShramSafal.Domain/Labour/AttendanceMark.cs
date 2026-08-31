using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Labour;

/// <summary>
/// What somebody RULED about a person on a farm-day: the हजेरी mark.
/// </summary>
/// <remarks>
/// <para>
/// <b>Founder decision D-H3, which is a schema decision and says so.</b> "The
/// current shape — one PresenceStatus per person per day — cannot hold this."
/// A cell is two independently-markable halves, so a person-day carries a DAY
/// mark and a NIGHT mark, and a day is worth 0, 0.5, 1, 1.5 or 2. The grid can
/// no longer count to 1.
/// </para>
/// <para>
/// <b>UNMARKED IS A FOURTH STATE, NOT A SYNONYM FOR ABSENT.</b> On paper they
/// look alike; here they must not. Nobody marking a night is not the same as a
/// night not worked, and the app may never assert the second from the first
/// (P4). Every read of this entity has to keep them apart — which is why
/// <see cref="DayMark.Unmarked"/> and <see cref="NightMark.Unmarked"/> are the
/// DEFAULT values of their enums: a row that somehow arrives without a stated
/// mark says "nobody said", never "he did not come".
/// </para>
/// <para>
/// <b>This is NOT <see cref="FieldOperatorWorkRow"/>, and the difference is the
/// point.</b> A work row is an attribution overlay — it records that a person
/// worked a given engagement, and its grain is person × engagement. This is a
/// RULING about a person on a DAY, and it exists for facts a work row cannot
/// carry: an absence is not an attribution (attributing work to someone who did
/// not work is a contradiction), and a half-day is a fraction the work row
/// deliberately has no room for ("this type carries no count").
/// </para>
/// <para>
/// <b>Attribution never changes reported quantity (Constraint 3 / P7), and
/// neither does this.</b> Marking four people present does not make a crew of
/// eight into four. The engagement stays the single source of truth for how
/// many worked; this says who, and how much of the day, by someone's word.
/// </para>
/// </remarks>
public sealed class AttendanceMark : Entity<Guid>
{
    private AttendanceMark() : base(Guid.Empty) { } // EF Core

    private AttendanceMark(
        Guid id,
        FarmId farmId,
        Guid fieldOperatorId,
        DateOnly workDate,
        DayMark day,
        NightMark night,
        UserId recordedByUserId,
        DateTime recordedAtUtc)
        : base(id)
    {
        FarmId = farmId;
        FieldOperatorId = fieldOperatorId;
        WorkDate = workDate;
        Day = day;
        Night = night;
        RecordedByUserId = recordedByUserId;
        RecordedAtUtc = recordedAtUtc;
        ModifiedAtUtc = recordedAtUtc;
    }

    public FarmId FarmId { get; private set; }

    /// <summary>
    /// The person this rules on. A <see cref="FieldOperator"/> id — a spoken
    /// name with no operator behind it cannot be marked, because there would be
    /// nobody for the mark to be about.
    /// </summary>
    public Guid FieldOperatorId { get; private set; }

    /// <summary>The farm-day. One mark per person per day; see the unique index.</summary>
    public DateOnly WorkDate { get; private set; }

    public DayMark Day { get; private set; }

    public NightMark Night { get; private set; }

    /// <summary>Who made this ruling. Never the app.</summary>
    public UserId RecordedByUserId { get; private set; }

    public DateTime RecordedAtUtc { get; private set; }

    /// <summary>
    /// When it last changed. What it changed FROM lives in
    /// <see cref="LabourCorrection"/>, which is append-only — a correction here
    /// must never be silent (founder ruling 2026-08-31).
    /// </summary>
    public DateTime ModifiedAtUtc { get; private set; }

    public static AttendanceMark Create(
        Guid id,
        FarmId farmId,
        Guid fieldOperatorId,
        DateOnly workDate,
        DayMark day,
        NightMark night,
        UserId recordedByUserId,
        DateTime recordedAtUtc)
    {
        if (fieldOperatorId == Guid.Empty)
        {
            throw new ArgumentException(
                "A mark must be about somebody — an empty operator id would be a ruling with no subject.",
                nameof(fieldOperatorId));
        }

        if (day == DayMark.Unmarked && night == NightMark.Unmarked)
        {
            // Nothing was said. A row asserting nothing is worse than no row:
            // it occupies the slot that "nobody has ruled yet" is expressed by,
            // and every reader would have to re-derive the distinction.
            throw new ArgumentException(
                "A mark must state something. Both halves unmarked is the absence of a mark, "
                + "which is represented by having no row at all.",
                nameof(day));
        }

        return new AttendanceMark(
            id, farmId, fieldOperatorId, workDate, day, night, recordedByUserId, recordedAtUtc);
    }

    /// <summary>
    /// Re-rules this person-day. Returns the PREVIOUS values so the caller can
    /// write the append-only correction row — this type will not let a change
    /// happen quietly, but it is not this type's job to write that row.
    /// </summary>
    public (DayMark PreviousDay, NightMark PreviousNight) Amend(
        DayMark day, NightMark night, UserId amendedByUserId, DateTime amendedAtUtc)
    {
        if (day == DayMark.Unmarked && night == NightMark.Unmarked)
        {
            throw new ArgumentException(
                "An amendment must state something. To un-say a mark, delete the row and record "
                + "the deletion — silently blanking it would erase the fact that it was ever made.",
                nameof(day));
        }

        var previous = (Day, Night);
        Day = day;
        Night = night;
        RecordedByUserId = amendedByUserId;
        ModifiedAtUtc = amendedAtUtc;
        return previous;
    }

    /// <summary>
    /// The day's worth in days: 0, 0.5, 1, 1.5 or 2 (D-H3). <c>Unmarked</c>
    /// contributes NOTHING on either half — it is not a zero, it is a silence,
    /// and a row total must never turn one into the other.
    /// </summary>
    public decimal Value =>
        (Day switch { DayMark.Full => 1m, DayMark.Half => 0.5m, _ => 0m })
        + (Night == NightMark.Worked ? 1m : 0m);
}

/// <summary>
/// D-H3. <see cref="Unmarked"/> is FIRST so it is the zero value: a mark that
/// arrives without a stated day says "nobody said", never "he did not come".
/// </summary>
public enum DayMark
{
    Unmarked = 0,
    Full = 1,
    Half = 2,
    Absent = 3,
}

/// <summary>
/// D-H3. <see cref="Unmarked"/> is FIRST for the same reason as
/// <see cref="DayMark"/>: nobody marking a night is not a night not worked.
/// </summary>
public enum NightMark
{
    Unmarked = 0,
    Worked = 1,
    NotWorked = 2,
}
