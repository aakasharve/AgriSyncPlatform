using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// Master review D6 — one Labour, TWO money truths, never one figure: the
/// system never says "₹16,650 खर्च". रोजंदारी · नोंदलेली and उक्ते काम ·
/// ठरलेली aggregate SAME-KIND stated amounts under honest labels; nothing
/// blends them, nothing derives rate × days, nothing presents agreed as spent.
/// Blanks are null, never 0.
/// </summary>
public sealed class LabourHomeMoneyTests
{
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);

    private static LabourAssignment Engagement(Guid logId, decimal? totalCost, ContractUnit? unit, int? count = null)
        => LabourAssignment.Create(
            id: Guid.NewGuid(), dailyLogId: logId, engagementType: LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: count, wagePerPerson: null,
            contractUnit: unit, contractQuantity: null, totalCost: totalCost,
            linkedActivityId: null, createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed(), shift: null, task: null, workerNames: []);

    [Fact]
    public void TheTwoKindsNeverCombineAndBlanksAreNulls()
    {
        var todayLog = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [
                Engagement(todayLog, totalCost: 1200m, unit: null, count: 4),        // रोजंदारी, stated
                Engagement(todayLog, totalCost: null, unit: null),                   // रोजंदारी, nothing stated
                Engagement(todayLog, totalCost: 12000m, unit: ContractUnit.Acre, count: 8), // उक्ते, agreed
            ],
            todaysLogIds: new HashSet<Guid> { todayLog });

        Assert.Equal(1200m, home.RojandariStated);
        Assert.Equal(12000m, home.UkteAgreed);      // never 13200 anywhere
        Assert.Equal(12, home.OnFarmToday);         // whole count, stated headcounts
        Assert.Equal(4, home.RojandariToday);
        Assert.Equal(8, home.UkteToday);
    }

    [Fact]
    public void NoStatedMoneyIsNullNeverZero()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, totalCost: null, unit: null)],
            todaysLogIds: new HashSet<Guid>());

        Assert.Null(home.RojandariStated);
        Assert.Null(home.UkteAgreed);
        Assert.Null(home.OnFarmToday);              // no engagement today → unknown, not 0
    }

    [Fact]
    public void UnknownHeadcountStaysBlankInsideTheBreakdown()
    {
        var todayLog = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [
                Engagement(todayLog, totalCost: null, unit: null, count: 4),
                Engagement(todayLog, totalCost: null, unit: ContractUnit.Acre, count: null), // उक्ते, count unstated
            ],
            todaysLogIds: new HashSet<Guid> { todayLog });

        Assert.Equal(4, home.OnFarmToday);          // known figures are not poisoned…
        Assert.Equal(4, home.RojandariToday);
        Assert.Null(home.UkteToday);                // …and the unknown part stays blank, never 0
    }
}
