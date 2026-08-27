// spec: dfes-companion-2026-07-11 (wave-3.5)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// SPEC RULING 3 (2026-08-15) — <b>do not ask the farmer to repeat weather the app
/// already knows.</b>
///
/// <para><b>The gap this closes.</b> <c>ssf.weather_stamps</c> has been written on the same
/// unit of work as the log since 20260630040851 and had <i>never been read back</i>.
/// Meanwhile <c>CoverWeather</c> credits only farmer-STATED weather (a disturbance reason
/// or a weather-tagged observation), so a farmer whose phone silently captured the day's
/// weather was still charged for not mentioning it. Task 3.9 then retired the weather
/// QUESTION from the bank — which, until this change, left a bucket that could be lost with
/// no question offered to fill it.</para>
///
/// <para><b>Where the change lives, and why that matters.</b> In
/// <c>DfesLensExtractor.Build</c>'s completeness roster — NEVER in
/// <c>DayUnderstandingScore.NotYetEarnable</c>. The /10 is derived on READ from
/// <c>components_json</c> (<c>GetDayUnderstandingHandler</c>), so a read-time exclusion
/// would rescore every historical row the instant the API deployed, before any recompute.
/// These tests therefore assert on the ROSTER (<c>Input.Possible</c>), which is what is
/// persisted, not on a read-time rollup.</para>
///
/// <para><b>Honesty bound.</b> <see cref="WeatherStamp"/> carries no confidence and no
/// staleness column, so "usable" is defined from the only two honest signals it has — a
/// real provider and the observation time. Three of the five proofs below are negative:
/// missing, Mock-provider and wrong-day weather must all LEAVE the bucket owed. Proof 1 is
/// what makes those three meaningful — without it they would all pass against an extractor
/// that simply ignored weather stamps entirely.</para>
/// </summary>
public sealed class DfesLensExtractorWeatherTests
{
    private static readonly Guid LogId = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid PlotId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid OtherPlotId = Guid.Parse("77777777-7777-7777-7777-777777777777");

    private static readonly DateOnly LocalDate = new(2026, 7, 12);

    /// <summary>06:00 UTC = 11:30 IST — unambiguously inside 2026-07-12 local.</summary>
    private static readonly DateTime LocalNoon = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    // He sprayed and said nothing about the weather. WEATHER sits at coverage 0 —
    // owed and unfilled — which is exactly the bucket under test.
    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── the one positive proof — without it every negative below is vacuous ──

    [Fact]
    public void Reliable_plot_weather_removes_WEATHER_from_what_the_farmer_owes()
    {
        var day = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, PlotId, LocalNoon)]);

        Dim(day, "WEATHER").Applicable.Should().BeFalse(
            "the app measured the day's weather itself — asking the farmer to repeat it charges him "
            + "for a fact we already hold (Ruling 3)");
    }

    // ── the negatives: anything less than genuinely-held weather keeps asking ──

    [Fact]
    public void Missing_weather_does_not_remove_the_bucket()
    {
        var day = Run(SprayDay, systemWeather: []);

        Dim(day, "WEATHER").Applicable.Should().BeTrue(
            "no stamp exists, so the app does NOT have the weather — the bucket stays owed");
    }

    [Fact]
    public void Mock_provider_weather_does_not_remove_the_bucket()
    {
        var day = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.Mock, PlotId, LocalNoon)]);

        Dim(day, "WEATHER").Applicable.Should().BeTrue(
            "CreateDailyLogHandler.MapWeatherProvider sends every UNRECOGNISED provider string to "
            + "Mock, so Mock means 'unknown' as well as 'fake' — neither is weather we actually have");
    }

    [Fact]
    public void Weather_from_a_different_day_does_not_remove_the_bucket()
    {
        var day = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, PlotId, LocalNoon.AddDays(-3))]);

        Dim(day, "WEATHER").Applicable.Should().BeTrue(
            "Tuesday's weather says nothing about Friday — the stamp must fall on the SCORED local day");
    }

    [Fact]
    public void Weather_for_a_different_plot_does_not_remove_the_bucket()
    {
        var day = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, OtherPlotId, LocalNoon)]);

        Dim(day, "WEATHER").Applicable.Should().BeTrue(
            "a stamp for another plot is not this plot's weather");
    }

    [Fact]
    public void A_multi_plot_day_passes_no_plot_and_matches_any_plot_of_the_day()
    {
        // The derivation service passes plotId = null when the day's logs span several
        // plots. A day with no single plot has no single plot to be WRONG about, so
        // demanding a stamp for "the" plot would keep the bucket owed forever on any
        // multi-plot farm — which is a different lie, not a safer one.
        var day = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, OtherPlotId, LocalNoon)],
            multiPlotDay: true);

        Dim(day, "WEATHER").Applicable.Should().BeFalse();
    }

    // ── the retirement must not disturb the rest of the roster ───────────────

    [Fact]
    public void Retiring_WEATHER_touches_no_other_dimension()
    {
        var without = Run(SprayDay, systemWeather: []);
        var with = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, PlotId, LocalNoon)]);

        foreach (var name in new[] { "WHAT", "COST", "DOSE", "CARRIER", "OBS_FACET", "LEARN_FACET" })
        {
            Dim(with, name).Should().Be(Dim(without, name),
                "only WEATHER may move — {0} must be untouched by the weather rule", name);
        }
    }

    [Fact]
    public void The_LENS_reading_of_weather_is_deliberately_untouched()
    {
        // Two readings of "applicable" are kept apart on purpose. The LENS list feeds
        // ThreeLensScorer -> DayClassifier -> the reward economy, whose calibration is
        // founder-gated; only the ROSTER (the farmer-facing /10's denominator) changes.
        var without = Run(SprayDay, systemWeather: []);
        var with = Run(SprayDay, systemWeather: [Stamp(WeatherProvider.TomorrowIo, PlotId, LocalNoon)]);

        with.Lenses.InsightScore.Should().Be(without.Lenses.InsightScore,
            "the reward economy must not move by a single point on a change to the /10's denominator");
        with.Input.Insight.Single(d => d.Name == "WEATHER").Applicable.Should().BeTrue(
            "the LENS weather dimension stays exactly as it was");
    }

    // ── harness ──────────────────────────────────────────────────────────────
    private sealed record Scored(LensInput Input, LensScores Lenses);

    /// <param name="multiPlotDay">Passes <c>PlotId = null</c>, exactly as
    /// <c>DailyRichnessDerivationService</c> does when the day's logs span several plots.</param>
    private static Scored Run(
        string json,
        IReadOnlyList<WeatherStamp> systemWeather,
        bool multiPlotDay = false,
        string? scoredUnder = null)
    {
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement], [], null, null,
                systemWeather, multiPlotDay ? null : PlotId, LocalDate, scoredUnder),
            probe,
            clientDatePlausible: true);

        return new Scored(input, probe.Scores);
    }

    private static ScoredDimension Dim(Scored day, string name)
        => day.Input.Possible!.Single(d => d.Name == name);

    /// <summary>A system weather stamp exactly as CreateDailyLogHandler writes one.</summary>
    private static WeatherStamp Stamp(WeatherProvider provider, Guid? plot, DateTime observedUtc)
        => WeatherStamp.Create(
            Guid.NewGuid(), LogId, plot,
            timestampLocal: observedUtc, timestampProvider: observedUtc, provider: provider,
            tempC: 29.5m, humidity: 62m, windKph: 7.4m, precipMm: 0m, cloudCoverPct: 20m,
            conditionText: "Clear", iconCode: "1000", rainProbNext6h: 5m,
            windGustKph: null, soilMoisture0To10: null, uvIndex: null, alertsJson: null,
            createdAtUtc: observedUtc);
}
