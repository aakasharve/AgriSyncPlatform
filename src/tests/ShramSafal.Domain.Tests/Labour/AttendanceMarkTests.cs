using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Founder decision D-H3, which says of itself: "THIS IS A SCHEMA DECISION, NOT
/// A VISUAL ONE. The current shape — one PresenceStatus per person per day —
/// cannot hold this."
///
/// A cell is two independently-markable halves. A day is worth 0, 0.5, 1, 1.5
/// or 2, and the grid can no longer count to 1. These pin the arithmetic and,
/// more importantly, the fourth state.
/// </summary>
public sealed class AttendanceMarkTests
{
    private static readonly FarmId Farm = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId Actor = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly Guid Operator = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateOnly Day = new(2026, 8, 31);
    private static readonly DateTime At = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);

    private static AttendanceMark Mark(DayMark day, NightMark night) =>
        AttendanceMark.Create(Guid.NewGuid(), Farm, Operator, Day, day, night, Actor, At);

    // ── D-H3's arithmetic: 0, 0.5, 1, 1.5, 2 ────────────────────────────────

    [Theory]
    [InlineData(DayMark.Full, NightMark.Unmarked, 1)]
    [InlineData(DayMark.Half, NightMark.Unmarked, 0.5)]
    [InlineData(DayMark.Absent, NightMark.Unmarked, 0)]
    [InlineData(DayMark.Unmarked, NightMark.Worked, 1)]
    [InlineData(DayMark.Full, NightMark.Worked, 2)]
    [InlineData(DayMark.Half, NightMark.Worked, 1.5)]
    [InlineData(DayMark.Absent, NightMark.Worked, 1)]
    public void ADayIsWorthZeroToTwo(DayMark day, NightMark night, decimal expected)
    {
#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(expected, Mark(day, night).Value);
#pragma warning restore CS0618
    }

    // ── THE FOURTH STATE ────────────────────────────────────────────────────

    /// <summary>
    /// D-H3: "unmarked is a fourth state, not a synonym for absent. On paper
    /// they look alike; on screen and in the data they must not."
    ///
    /// Both contribute 0 to a total, which is exactly why the ENUM has to keep
    /// them apart — the arithmetic cannot, so the type must.
    /// </summary>
    [Fact]
    public void UnmarkedIsNotAbsentEvenThoughBothCountZero()
    {
        var unmarked = Mark(DayMark.Unmarked, NightMark.Worked);
        var absent = Mark(DayMark.Absent, NightMark.Worked);

#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(unmarked.Value, absent.Value);   // indistinguishable in arithmetic
#pragma warning restore CS0618
        Assert.NotEqual(unmarked.Day, absent.Day);    // and never in the data
    }

    /// <summary>
    /// "Nobody marking a night is not the same as a night not worked, and the
    /// app may never assert the second from the first (P4)."
    /// </summary>
    [Fact]
    public void AnUnmarkedNightIsNotANightNotWorked()
    {
        var unmarked = Mark(DayMark.Full, NightMark.Unmarked);
        var notWorked = Mark(DayMark.Full, NightMark.NotWorked);

#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(unmarked.Value, notWorked.Value);
#pragma warning restore CS0618
        Assert.NotEqual(unmarked.Night, notWorked.Night);
    }

    /// <summary>
    /// Unmarked is the ZERO value of both enums, so a row that somehow arrives
    /// without a stated mark says "nobody said" rather than "he did not come".
    /// A default of Absent would make silence into an accusation.
    /// </summary>
    [Fact]
    public void TheDefaultOfBothEnumsIsUnmarked()
    {
        Assert.Equal(DayMark.Unmarked, default);
        Assert.Equal(NightMark.Unmarked, default);
    }

    // ── A mark must say something ───────────────────────────────────────────

    /// <summary>
    /// Both halves unmarked is the ABSENCE of a mark, and absence is expressed
    /// by having no row. A row asserting nothing would occupy the slot that
    /// "nobody has ruled yet" is expressed by.
    /// </summary>
    [Fact]
    public void ARowThatSaysNothingIsRefused()
    {
        Assert.Throws<ArgumentException>(() => Mark(DayMark.Unmarked, NightMark.Unmarked));
    }

    [Fact]
    public void AMarkMustBeAboutSomebody()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Guid.Empty, Day, DayMark.Full, NightMark.Unmarked, Actor, At));
    }

    // ── Amending ────────────────────────────────────────────────────────────

    /// <summary>
    /// A change hands back what it changed FROM, so the caller can write the
    /// append-only correction. The founder's ruling: a correction must remember
    /// the original fact, who changed it and when.
    /// </summary>
    [Fact]
    public void AmendReturnsWhatItChangedFrom()
    {
        var mark = Mark(DayMark.Half, NightMark.Unmarked);
        var later = At.AddHours(3);
        var otherActor = new UserId(Guid.Parse("44444444-4444-4444-4444-444444444444"));

        var previous = mark.Amend(
            DayMark.Full, NightMark.Worked, null, null, LabourTimeBasis.Unspecified, otherActor, later);

        Assert.Equal(DayMark.Half, previous.Day);
        Assert.Equal(NightMark.Unmarked, previous.Night);
        Assert.Equal(DayMark.Full, mark.Day);
#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(2m, mark.Value);
#pragma warning restore CS0618
        Assert.Equal(later, mark.ModifiedAtUtc);
        Assert.Equal(otherActor, mark.RecordedByUserId);
    }

    /// <summary>
    /// Blanking both halves would erase the fact that a mark was ever made.
    /// Un-saying is a deletion, and a deletion has to be recorded as one.
    /// </summary>
    [Fact]
    public void AmendingToNothingIsRefused()
    {
        var mark = Mark(DayMark.Full, NightMark.Worked);

        Assert.Throws<ArgumentException>(
            () => mark.Amend(DayMark.Unmarked, NightMark.Unmarked, null, null,
                LabourTimeBasis.Unspecified, Actor, At.AddHours(1)));
    }

    /// <summary>
    /// Creation stamps both timestamps identically, so "never amended" is
    /// readable without a nullable field.
    /// </summary>
    [Fact]
    public void ANewMarkHasNotBeenModified()
    {
        var mark = Mark(DayMark.Full, NightMark.Unmarked);
        Assert.Equal(mark.RecordedAtUtc, mark.ModifiedAtUtc);
    }
    // ── The five day-realities: hours land on the mark (final direction §1) ──

    /// <summary>
    /// Task 2.5 acceptance, verbatim from the plan: "गणेश रात्री 3 तास होता"
    /// persists Night=Worked AND Hours=3 with basis=Explicit — and NOTHING
    /// converts hours into day fractions.
    /// </summary>
    [Fact]
    public void StatedNightHoursPersistBesideTheNightMarkAndConvertToNothing()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Worked,
            Actor, At, hoursWorked: 3m, hoursBasis: LabourTimeBasis.Explicit);

        Assert.Equal(NightMark.Worked, mark.Night);
        Assert.Equal(3m, mark.HoursWorked);
        Assert.Equal(LabourTimeBasis.Explicit, mark.HoursBasis);

        var without = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Worked, Actor, At);
#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(without.Value, mark.Value); // hours never fold into day-worth (C12 stays pinned)
#pragma warning restore CS0618
    }

    /// <summary>The widened emptiness guard: hours alone are now a statement.</summary>
    [Fact]
    public void AnHoursOnlyRulingIsAMarkNowNotARefusal()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Unmarked, NightMark.Unmarked,
            Actor, At, hoursWorked: 4m, hoursBasis: LabourTimeBasis.Explicit);
        Assert.Equal(4m, mark.HoursWorked);
    }

    /// <summary>"+2 जादा" is a distinct fact beside Full — never an invented 1.25 days.</summary>
    [Fact]
    public void ExtraHoursRideBesideAFullDayNeverInsideIt()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, extraHours: 2m, hoursBasis: LabourTimeBasis.Explicit);
        Assert.Equal(DayMark.Full, mark.Day);
        Assert.Equal(2m, mark.ExtraHours);
#pragma warning disable CS0618 // Value is [Obsolete] (Phase 4): pin stays, documented, acknowledged.
        Assert.Equal(1m, mark.Value);
#pragma warning restore CS0618
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void NonPositiveHoursAreRefused(int hours)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: hours, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>
    /// The recorder is "never the app" (AttendanceMark.cs). Hours on a mark are
    /// somebody's WORDS: basis must be Explicit — Assumed is the server inventing
    /// a duration, which belongs to the engagement, never here.
    /// </summary>
    [Theory]
    [InlineData(LabourTimeBasis.Unspecified)]
    [InlineData(LabourTimeBasis.Assumed)]
    public void HoursWithoutExplicitProvenanceAreRefused(LabourTimeBasis basis)
    {
        Assert.Throws<ArgumentException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3m, hoursBasis: basis));
    }

    [Fact]
    public void ABasisWithNoHoursIsRefused()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>numeric(4,1) would silently round a second decimal; stored must equal stated (P4).</summary>
    [Fact]
    public void ASecondDecimalPlaceIsRefusedSoStoredEqualsStated()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3.25m, hoursBasis: LabourTimeBasis.Explicit));
    }

    /// <summary>
    /// The guard nuance Phase 0 demanded be decided in the domain shape:
    /// Amend may RESTATE stated hours, never silently blank them — "nobody said"
    /// has no value name a correction row could record, so a quiet null here
    /// would be an unrecorded deletion.
    /// </summary>
    [Fact]
    public void AmendMayRestateHoursButNeverSilentlyDropThem()
    {
        var mark = AttendanceMark.Create(
            Guid.NewGuid(), Farm, Operator, Day, DayMark.Full, NightMark.Unmarked,
            Actor, At, hoursWorked: 3m, hoursBasis: LabourTimeBasis.Explicit);

        Assert.Throws<ArgumentException>(() => mark.Amend(
            DayMark.Full, NightMark.Unmarked, null, null, LabourTimeBasis.Unspecified,
            Actor, At.AddHours(1)));

        var previous = mark.Amend(
            DayMark.Full, NightMark.Unmarked, 3.5m, null, LabourTimeBasis.Explicit,
            Actor, At.AddHours(2));
        Assert.Equal(3m, previous.HoursWorked);
        Assert.Equal(LabourTimeBasis.Explicit, previous.HoursBasis);
        Assert.Equal(3.5m, mark.HoursWorked);
    }
}
