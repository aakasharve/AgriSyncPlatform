using System.Globalization;
using System.Linq;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Task 6's defect (spec: 2026-08-28-labour-v2-release-1, D9.9): int-typed
/// register totals rounded a half day (0.5) up into a fabricated whole day —
/// a day of work nobody did. The founder master review 2026-09-02 (D4) then
/// DELETED every aggregate from the grid contract — <c>Total</c>,
/// <c>WeekTotal</c>, <c>DailyTotals</c> — so the rounding surface no longer
/// exists to get wrong; their structural absence is pinned by
/// <c>BuildHajeriLedgerTests.TheGridContractCarriesNoAggregateAndNoMoney</c>.
///
/// <para>What SURVIVES of this suite's intent, and is pinned here: a half day
/// stays its own DISCRETE fact ("half" — 1 अर्धा in the dimensional detail
/// read), never a number a reader could round; and the members that do hold
/// numbers (stated hours) are decimal, so .5-granularity facts survive
/// exactly — never rounded, never folded into a whole day.</para>
/// </summary>
public sealed class HalfDayIsPointFiveTests
{
    private static LabourLedgerCellDto Cell(string day) => new(day, null, null, null, false, null);

    [Fact]
    public void A_half_day_is_a_discrete_state_not_a_number_that_could_round()
    {
        // The brief's exact scenario, on the CLEAN contract: 5 full + 1 half
        // + 1 absent across a 7-day week. The old int Total fabricated a 6th
        // whole day out of the half; the new contract has no total to
        // fabricate into — the week reads dimensionally (5 पूर्ण · 1 अर्धा),
        // each state its own count, the half never promoted.
        var week = new LabourLedgerCellDto?[]
        {
            Cell("full"), Cell("full"), Cell("half"), Cell("full"),
            Cell("full"), Cell("full"), Cell("absent"),
        };

        Assert.Equal(5, week.Count(c => c!.Day == "full"));
        Assert.Equal(1, week.Count(c => c!.Day == "half"));
        Assert.Equal(1, week.Count(c => c!.Day == "absent"));
    }

    [Fact]
    public void Stated_hours_hold_a_half_exactly_and_render_it_as_point_five()
    {
        // The type-level proof the old suite carried for totals, now on the
        // members that DO hold numbers: decimal, so 3.5 is 3.5 — never 4,
        // and never "3.500000" on the wire (stated is stored is shown).
        var cell = new LabourLedgerCellDto("half", null, 3.5m, 0.5m, false, null);

        Assert.Equal(3.5m, cell.Hours);
        Assert.Equal("3.5", cell.Hours!.Value.ToString(CultureInfo.InvariantCulture));
        Assert.Equal(0.5m, cell.ExtraHours);
    }
}
