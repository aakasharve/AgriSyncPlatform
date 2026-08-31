using AgriSync.SharedKernel.Contracts.Ids;
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
        Assert.Equal(expected, Mark(day, night).Value);
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

        Assert.Equal(unmarked.Value, absent.Value);   // indistinguishable in arithmetic
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

        Assert.Equal(unmarked.Value, notWorked.Value);
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

        var (previousDay, previousNight) = mark.Amend(DayMark.Full, NightMark.Worked, otherActor, later);

        Assert.Equal(DayMark.Half, previousDay);
        Assert.Equal(NightMark.Unmarked, previousNight);
        Assert.Equal(DayMark.Full, mark.Day);
        Assert.Equal(2m, mark.Value);
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
            () => mark.Amend(DayMark.Unmarked, NightMark.Unmarked, Actor, At.AddHours(1)));
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
}
