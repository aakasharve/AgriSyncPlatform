using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Founder ruling 2026-08-31 — "remember it". Corrections are expected and
/// fine; silent ones are not. A confirmed record that can be quietly edited
/// manufactures false confidence with a second person's name attached to it,
/// which is worse than no confirmation at all.
/// </summary>
public sealed class AttendanceMarkCorrectionTests
{
    private static readonly FarmId Farm = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly UserId Actor = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly Guid MarkId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateTime At = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);

    private static AttendanceMarkCorrection Correction(
        string field = AttendanceMarkCorrection.DayField,
        string from = "Half",
        string to = "Full")
        => AttendanceMarkCorrection.Create(Guid.NewGuid(), MarkId, Farm, field, from, to, Actor, At);

    [Fact]
    public void ItRecordsWhatChangedFromWhatToWhatByWhomAndWhen()
    {
        var c = Correction();

        Assert.Equal(MarkId, c.AttendanceMarkId);
        Assert.Equal(AttendanceMarkCorrection.DayField, c.ChangedField);
        Assert.Equal("Half", c.OriginalValue);
        Assert.Equal("Full", c.NewValue);
        Assert.Equal(Actor, c.CorrectedByUserId);
        Assert.Equal(At, c.CorrectedAtUtc);
    }

    /// <summary>
    /// A correction that cannot say what it changed FROM is not a record of a
    /// change — it is the change happening quietly, which is the one thing this
    /// entity exists to prevent.
    /// </summary>
    [Theory]
    [InlineData("", "Full")]
    [InlineData("   ", "Full")]
    [InlineData("Half", "")]
    [InlineData("Half", "   ")]
    public void ACorrectionThatCannotSayWhatChangedIsRefused(string from, string to)
    {
        Assert.Throws<ArgumentException>(() => Correction(from: from, to: to));
    }

    /// <summary>
    /// Recording a non-change pads the history and buries real corrections
    /// among restatements of the same fact.
    /// </summary>
    [Fact]
    public void ANonChangeIsRefused()
    {
        Assert.Throws<ArgumentException>(() => Correction(from: "Full", to: "Full"));
    }

    /// <summary>
    /// D-H3: day and night are independently markable, so they are
    /// independently correctable. A row holding both would make "only the night
    /// changed" indistinguishable from "both were restated".
    /// </summary>
    [Theory]
    [InlineData(AttendanceMarkCorrection.DayField)]
    [InlineData(AttendanceMarkCorrection.NightField)]
    public void EachHalfIsCorrectedOnItsOwnRow(string field)
    {
        Assert.Equal(field, Correction(field, "Unmarked", "Worked").ChangedField);
    }

    [Fact]
    public void AFieldOutsideTheTwoHalvesIsRefused()
    {
        Assert.Throws<ArgumentException>(() => Correction("headcount", "4", "5"));
    }

    [Fact]
    public void ACorrectionMustPointAtAMark()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMarkCorrection.Create(
            Guid.NewGuid(), Guid.Empty, Farm, AttendanceMarkCorrection.DayField,
            "Half", "Full", Actor, At));
    }

    /// <summary>
    /// Values are stored as enum NAMES, not numbers. A correction has to stay
    /// readable years later, and an enum whose members were renumbered would
    /// silently rewrite history recorded as integers.
    /// </summary>
    [Fact]
    public void ValuesAreStoredAsNamesNotNumbers()
    {
        var c = AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, AttendanceMarkCorrection.DayField,
            DayMark.Half.ToString(), DayMark.Absent.ToString(), Actor, At);

        Assert.Equal("Half", c.OriginalValue);
        Assert.Equal("Absent", c.NewValue);
        Assert.False(int.TryParse(c.OriginalValue, out _));
    }
    /// <summary>
    /// Unlike day/night — where Unmarked is a real value name — "nobody said"
    /// has NO name for the hours fields. So for them a null side is legal
    /// (first-ever statement), and the both-required rule keeps holding for the
    /// two enum halves.
    /// </summary>
    [Theory]
    [InlineData(AttendanceMarkCorrection.HoursWorkedField)]
    [InlineData(AttendanceMarkCorrection.ExtraHoursField)]
    public void AFirstEverHoursStatementRecordsNullToValue(string field)
    {
        var c = AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, field,
            null, AttendanceMarkCorrection.FormatHours(3.5m, LabourTimeBasis.Explicit), Actor, At);

        Assert.Null(c.OriginalValue);
        Assert.Equal("3.5|Explicit", c.NewValue);
    }

    [Fact]
    public void DayAndNightStillRequireBothSides()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, AttendanceMarkCorrection.DayField,
            null, "Full", Actor, At));
    }

    [Fact]
    public void ANullToNullHoursCorrectionIsRefused()
    {
        Assert.Throws<ArgumentException>(() => AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, AttendanceMarkCorrection.HoursWorkedField,
            null, null, Actor, At));
    }

    [Theory]
    [InlineData(AttendanceMarkCorrection.HoursWorkedField)]
    [InlineData(AttendanceMarkCorrection.ExtraHoursField)]
    public void TheHoursFieldsAreCorrectable(string field)
    {
        var c = AttendanceMarkCorrection.Create(
            Guid.NewGuid(), MarkId, Farm, field,
            AttendanceMarkCorrection.FormatHours(3m, LabourTimeBasis.Explicit),
            AttendanceMarkCorrection.FormatHours(4m, LabourTimeBasis.Explicit), Actor, At);
        Assert.Equal(field, c.ChangedField);
    }
}
