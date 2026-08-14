using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// AnsweredGap turns a farmer's answer to a gap question into a fact the scorer
/// can credit (founder ruling A, 2026-08-14 — answering Sathi must raise the day).
///
/// Gap questions are keyed `gap.&lt;dimension&gt;` in lower case by
/// dfesQuestionBank.ts:115. Every other question key (safety.*, weather.*,
/// stage.*, schedule.*, followup.*, learning.*) is NOT a gap and must never
/// credit a dimension.
/// </summary>
public sealed class AnsweredGapTests
{
    private static readonly DateOnly Date = new(2026, 8, 14);

    [Theory]
    [InlineData("gap.dose", "DOSE")]
    [InlineData("gap.what", "WHAT")]
    [InlineData("gap.cost", "COST")]
    [InlineData("gap.carrier", "CARRIER")]
    [InlineData("gap.weather", "WEATHER")]
    [InlineData("gap.scope", "SCOPE")]
    [InlineData("gap.purpose", "PURPOSE")]
    [InlineData("gap.continuity", "CONTINUITY")]
    public void TryFrom_normalises_the_dimension_to_upper_case(string key, string expected)
    {
        var ok = AnsweredGap.TryFrom(key, "250ml", Date, out var gap);

        Assert.True(ok);
        Assert.Equal(expected, gap.Dimension);
        Assert.Equal(Date, gap.LocalDate);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void TryFrom_rejects_an_empty_response_so_silence_never_scores(string? response)
    {
        var ok = AnsweredGap.TryFrom("gap.dose", response, Date, out _);

        Assert.False(ok);
    }

    [Theory]
    [InlineData("safety.spray_wind_high")]
    [InlineData("weather.rain_before_spray")]
    [InlineData("stage.confirm_current")]
    [InlineData("schedule.category_planned_not_done")]
    [InlineData("followup.observation_outcome")]
    [InlineData("learning.deepen_hypothesis")]
    public void TryFrom_rejects_a_non_gap_question_key(string key)
    {
        var ok = AnsweredGap.TryFrom(key, "yes", Date, out _);

        Assert.False(ok);
    }

    [Theory]
    [InlineData("gap.")]
    [InlineData("gap")]
    [InlineData("")]
    [InlineData(null)]
    public void TryFrom_rejects_a_malformed_key(string? key)
    {
        var ok = AnsweredGap.TryFrom(key!, "250ml", Date, out _);

        Assert.False(ok);
    }
}
