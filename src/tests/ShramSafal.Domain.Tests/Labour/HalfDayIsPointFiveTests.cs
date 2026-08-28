using System.Globalization;
using System.Linq;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Task 6 (spec: 2026-08-28-labour-v2-release-1) — Defect A: <c>LabourLedgerDto.WeekTotal</c>,
/// <c>DailyTotals</c> and <c>LabourLedgerRowDto.Total</c> were all <c>int</c>, so a half day
/// (0.5) had nowhere to go. The shipped design fixture (<c>labourMock.ts</c>) already fabricated
/// this: a worker with 5 present + 1 half days was given a total of <b>6</b>, not 5.5 — a whole
/// day of work nobody did. Founder ruling D9.9 (supersedes D4): half a day is 0.5 day of
/// EVIDENCE, never half a wage — Money is Release 2 and must not appear here.
///
/// <para>
/// Before this task these three DTO members could not even COMPILE a half-day value — the type
/// system itself enforced "always a whole number," which was the bug (Task 1's report makes the
/// same observation about <c>RecordedWages</c>: a compile-time failure is a stronger proof of the
/// defect than a runtime one, because pre-fix the type cannot express the true value at all).
/// </para>
/// </summary>
public sealed class HalfDayIsPointFiveTests
{
    [Fact]
    public void Row_total_is_five_point_five_not_six_for_five_present_and_one_half()
    {
        // The brief's exact scenario: 5 "present" + 1 "half" + 1 "absent" (a
        // full 7-day week) = 5.5 real days of work. The old `int`-typed Total
        // could only round that up to a fabricated whole day (6).
        var cells = new string?[] { "present", "present", "half", "present", "present", "present", "absent" };
        var total = cells.Sum(c => c switch
        {
            "present" => 1m,
            "half" => 0.5m,
            _ => 0m, // "absent" or no fact yet (null) — both contribute nothing.
        });

        var row = new LabourLedgerRowDto("w1", "worker", "w", "or", cells, total);

        Assert.Equal(5.5m, row.Total);
        // A decimal must render as "5.5", never "5.500000" — see the report
        // for why summing only 0m/0.5m/1m operands keeps the scale bounded.
        Assert.Equal("5.5", row.Total.ToString(CultureInfo.InvariantCulture));
    }

    [Fact]
    public void A_full_week_of_halves_is_three_point_five_not_rounded()
    {
        var cells = new string?[] { "half", "half", "half", "half", "half", "half", "half" };
        var total = cells.Sum(c => c == "half" ? 0.5m : 0m);

        var row = new LabourLedgerRowDto("w2", "worker", "w", "or", cells, total);

        Assert.Equal(3.5m, row.Total);
    }

    [Fact]
    public void Ledger_daily_totals_and_week_total_hold_half_days_exactly()
    {
        // Column sums across several workers' rows for one week — mirrors what
        // `DailyTotals`/`WeekTotal` roll up once Stage 5 populates real Rows.
        var dailyTotals = new decimal[] { 3m, 3.5m, 3.5m, 4m, 3.5m, 2m, 1m };
        var weekTotal = dailyTotals.Sum();

        var ledger = new LabourLedgerDto("wk", ["सो"], [], dailyTotals, weekTotal);

        Assert.Equal(20.5m, ledger.WeekTotal);
        Assert.Equal(new decimal[] { 3m, 3.5m, 3.5m, 4m, 3.5m, 2m, 1m }, ledger.DailyTotals);
    }
}
