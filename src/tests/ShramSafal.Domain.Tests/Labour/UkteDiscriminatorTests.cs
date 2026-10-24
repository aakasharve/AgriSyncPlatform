using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// FOUNDER'S CORRECTED ECONOMIC MODEL (closure direction, 2026-09-03) — the
/// seven cases, pinned.
///
/// <para>"रोजंदारी and उक्ते काम describe the BASIS on which the farmer is
/// obligated to pay for that work. They do not describe worker identity,
/// worker frequency, or whether names were captured."</para>
///
/// <list type="bullet">
/// <item>No KNOWN उक्ते agreement governs the engagement → ordinary day-rate work.</item>
/// <item>A KNOWN उक्ते agreement governs it → उक्ते काम.</item>
/// <item>unnamed is not an unknown payment model; an occasional worker is not a
///       contract worker; Mukadam involvement is not automatically contract.</item>
/// <item>Headcount proves human execution happened. It NEVER by itself produces
///       rupees: without a trustworthy rate source, show a dash, never zero.</item>
/// </list>
///
/// <para><b>What decides the bucket:</b> <see cref="LabourAssignment.EngagementType"/>
/// — the field whose whole job is "how labour was engaged" and which carries a
/// <see cref="LabourEngagementType.Contract"/> member — plus a stated
/// <see cref="LabourAssignment.ContractUnit"/>, which is the unit a contract
/// RATE is quoted in and therefore evidence of the same agreement. NOT
/// TotalCost (day-rate work states totals too), NOT the crew link (case C), NOT
/// worker names (cases A and B).</para>
/// </summary>
public sealed class UkteDiscriminatorTests
{
    private static readonly DateTime CreatedAtUtc = new(2026, 9, 3, 6, 0, 0, DateTimeKind.Utc);

    private static LabourAssignment Engagement(
        Guid logId,
        LabourEngagementType engagementType = LabourEngagementType.Hired,
        ContractUnit? contractUnit = null,
        decimal? contractQuantity = null,
        decimal? totalCost = null,
        decimal? wagePerPerson = null,
        int? count = null,
        IReadOnlyList<string>? workerNames = null,
        Guid? engagedThrough = null)
        => LabourAssignment.Create(
            id: Guid.NewGuid(), dailyLogId: logId, engagementType: engagementType,
            maleCount: null, femaleCount: null, workerCount: count, wagePerPerson: wagePerPerson,
            contractUnit: contractUnit, contractQuantity: contractQuantity, totalCost: totalCost,
            linkedActivityId: null, createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed(), shift: null, task: null,
            workerNames: workerNames ?? [],
            engagedThroughFieldOperatorId: engagedThrough);

    /// <summary>
    /// A. Six workers, nobody named, no उक्ते agreement anywhere — all six are
    /// ordinary day-rate work. Unnamed is not a payment model.
    /// </summary>
    [Fact]
    public void A_UnnamedSixWithNoAgreementAreDayRate()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, count: 6)],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(6, home.OnFarmToday);
        Assert.Equal(6, home.RojandariToday);
        Assert.Null(home.UkteToday);
    }

    /// <summary>
    /// B. A worker who appears exactly once is still day-rate. Frequency is not
    /// a payment model — an occasional worker is not a contract worker.
    /// </summary>
    [Fact]
    public void B_AWorkerSeenOnlyOnceIsStillDayRate()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, count: 1, workerNames: ["गणेश"])],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(1, home.RojandariToday);
        Assert.Null(home.UkteToday);
    }

    /// <summary>
    /// C. A Mukadam brought eight, and no उक्ते agreement was stated — day-rate.
    /// Mukadam involvement is NOT automatically contract: the crew link says
    /// through WHOM, never on what BASIS.
    /// </summary>
    [Fact]
    public void C_MukadamCrewWithNoAgreementIsStillDayRate()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, count: 8, engagedThrough: Guid.NewGuid())],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(8, home.OnFarmToday);
        Assert.Equal(8, home.RojandariToday);
        Assert.Null(home.UkteToday);
    }

    /// <summary>
    /// D. The SAME Mukadam crew, this time governed by an उक्ते agreement and
    /// carrying no measurement unit — all eight are उक्ते. What flipped the
    /// bucket is the agreement, not the mukadam and not a unit.
    /// </summary>
    [Fact]
    public void D_MukadamCrewUnderAnUkteAgreementIsUkte()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, LabourEngagementType.Contract, count: 8, engagedThrough: Guid.NewGuid())],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(8, home.OnFarmToday);
        Assert.Equal(8, home.UkteToday);
        Assert.Null(home.RojandariToday);
    }

    /// <summary>
    /// E. A whole-job fixed amount with NO measurement unit. This is उक्ते: the
    /// money comes from the agreement, never headcount times day-rate. Before
    /// this pin the row landed in रोजंदारी, because the only discriminator was
    /// a non-null ContractUnit and this job has none.
    /// </summary>
    [Fact]
    public void E_WholeJobFixedAmountWithNoUnitIsUkte()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, LabourEngagementType.Contract, totalCost: 15000m)],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(15000m, home.UkteAgreed);
        Assert.Null(home.RojandariStated);   // never lands on the day-rate card
    }

    /// <summary>
    /// F. Four day-rate workers and an eight-strong उक्ते crew on the same plot
    /// on the same day — twelve on the farm, split 4 + 8. The breakdown is a
    /// breakdown, and the two money truths never combine.
    /// </summary>
    [Fact]
    public void F_DayRateAndUkteOnTheSameDaySplitWithoutCombining()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [
                Engagement(log, count: 4, totalCost: 1200m),
                Engagement(log, LabourEngagementType.Contract, count: 8, totalCost: 15000m),
            ],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(12, home.OnFarmToday);
        Assert.Equal(4, home.RojandariToday);
        Assert.Equal(8, home.UkteToday);
        Assert.Equal(1200m, home.RojandariStated);   // never 16200 anywhere
        Assert.Equal(15000m, home.UkteAgreed);
    }

    /// <summary>
    /// G. Day-rate headcount is known but no rate and no total were ever stated
    /// — the headcount stands and the money stays blank. Headcount proves human
    /// execution happened; it never by itself produces rupees.
    /// </summary>
    [Fact]
    public void G_KnownHeadcountWithNoRateProducesNoRupees()
    {
        var log = Guid.NewGuid();
        var home = GetLabourDataHandler.BuildLabourHome(
            [Engagement(log, count: 6, wagePerPerson: null, totalCost: null)],
            todaysLogIds: new HashSet<Guid> { log });

        Assert.Equal(6, home.RojandariToday);
        Assert.Null(home.RojandariStated);   // a dash, never zero and never 6 x a guessed rate
        Assert.Null(home.UkteAgreed);
    }
}
