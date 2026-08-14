using System;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-3).
///
/// <para><b>Why this arithmetic is worth pinning.</b> Three call sites now share
/// <see cref="FarmLocalDay"/> — the question handler (which day did the farmer just answer
/// for), the repository (which rows are that day's question events) and the derivation
/// service (which day is "today" for the client-date sanity check). Its failure mode is
/// precisely the one it exists to prevent: an answer credited to a DIFFERENT day than the
/// one whose score the farmer is watching. He would answer, the number would not move, and
/// the daily loop would be broken by an off-by-one that no integration test near midday
/// could ever catch.</para>
///
/// <para>The integration proof deliberately uses 09:00 UTC — comfortably mid-day in IST —
/// so that it does not tautologise the date rule. That leaves the boundaries untested,
/// which is exactly where a +05:30 conversion goes wrong. They are tested here, for free.</para>
/// </summary>
public sealed class FarmLocalDayTests
{
    private static readonly DateOnly Day = new(2026, 8, 14);

    // 18:30 UTC is 00:00 IST. The window is half-open [start, end), so the instant that
    // OPENS a local day belongs to it and the instant that opens the NEXT one does not.
    [Theory]
    // ── the previous day's 18:30 UTC opens `Day` — inclusive start ──
    [InlineData(2026, 8, 13, 18, 30, 0, 2026, 8, 14)]
    // ── one second before the next boundary is still `Day` ──
    [InlineData(2026, 8, 14, 18, 29, 59, 2026, 8, 14)]
    // ── 18:30 UTC on `Day` has already rolled over — exclusive end ──
    [InlineData(2026, 8, 14, 18, 30, 0, 2026, 8, 15)]
    // ── mid-day sanity: 09:00 UTC = 14:30 IST, the instant the integration proof uses ──
    [InlineData(2026, 8, 14, 9, 0, 0, 2026, 8, 14)]
    // ── UTC midnight is 05:30 IST — same date, the case a naive `.Date` also gets right ──
    [InlineData(2026, 8, 14, 0, 0, 0, 2026, 8, 14)]
    // ── 18:29:59 the day BEFORE is still the previous local day ──
    [InlineData(2026, 8, 13, 18, 29, 59, 2026, 8, 13)]
    public void Maps_a_utc_instant_to_the_local_day_it_actually_falls_on(
        int y, int mo, int d, int h, int mi, int s, int ey, int emo, int ed)
    {
        var utc = new DateTime(y, mo, d, h, mi, s, DateTimeKind.Utc);

        Assert.Equal(new DateOnly(ey, emo, ed), FarmLocalDay.From(utc));
    }

    [Fact]
    public void Window_opens_at_the_previous_days_1830_utc_and_lasts_exactly_one_day()
    {
        var (startUtc, endUtcExclusive) = FarmLocalDay.UtcWindow(Day);

        Assert.Equal(new DateTime(2026, 8, 13, 18, 30, 0, DateTimeKind.Utc), startUtc);
        Assert.Equal(new DateTime(2026, 8, 14, 18, 30, 0, DateTimeKind.Utc), endUtcExclusive);
        Assert.Equal(TimeSpan.FromDays(1), endUtcExclusive - startUtc);
    }

    /// <summary>
    /// Both ends must be <see cref="DateTimeKind.Utc"/>: they are compared against
    /// <c>timestamp with time zone</c> columns, and Npgsql rejects an Unspecified-kind
    /// DateTime for one. A Kind regression would fail at runtime, not at compile time.
    /// </summary>
    [Fact]
    public void Window_bounds_are_utc_kind_because_they_are_compared_against_timestamptz()
    {
        var (startUtc, endUtcExclusive) = FarmLocalDay.UtcWindow(Day);

        Assert.Equal(DateTimeKind.Utc, startUtc.Kind);
        Assert.Equal(DateTimeKind.Utc, endUtcExclusive.Kind);
    }

    /// <summary>
    /// THE property the whole design rests on: the window is the exact inverse of the
    /// conversion. If these two ever disagree, the handler credits one day and the
    /// repository reads another — the off-by-one this type exists to make impossible.
    /// Swept minute by minute across a full day plus both boundaries.
    /// </summary>
    [Fact]
    public void Window_is_the_exact_inverse_of_the_conversion_across_a_whole_day()
    {
        var (startUtc, endUtcExclusive) = FarmLocalDay.UtcWindow(Day);

        // Start one hour BEFORE the window and end one hour after, so the sweep proves
        // both that everything inside maps to Day and that nothing outside does.
        for (var t = startUtc.AddHours(-1); t < endUtcExclusive.AddHours(1); t = t.AddMinutes(1))
        {
            var insideWindow = t >= startUtc && t < endUtcExclusive;

            Assert.Equal(insideWindow, FarmLocalDay.From(t) == Day);
        }
    }

    /// <summary>
    /// The same inverse property, checked from the other direction and across month,
    /// year and leap-day rollovers — where a hand-rolled offset is most likely to slip.
    /// </summary>
    [Theory]
    [InlineData(2026, 1, 1)]
    [InlineData(2026, 2, 28)]
    [InlineData(2028, 2, 29)]   // leap day
    [InlineData(2026, 8, 14)]
    [InlineData(2026, 12, 31)]
    public void Every_windows_first_and_last_instant_map_back_to_its_own_day(int y, int mo, int d)
    {
        var day = new DateOnly(y, mo, d);
        var (startUtc, endUtcExclusive) = FarmLocalDay.UtcWindow(day);

        Assert.Equal(day, FarmLocalDay.From(startUtc));
        Assert.Equal(day, FarmLocalDay.From(endUtcExclusive.AddTicks(-1)));
        Assert.Equal(day.AddDays(-1), FarmLocalDay.From(startUtc.AddTicks(-1)));
        Assert.Equal(day.AddDays(1), FarmLocalDay.From(endUtcExclusive));
    }
}
