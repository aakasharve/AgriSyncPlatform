using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// STAGE 5 — today's attendance draft, which used to be hardcoded
/// <c>Plot: "", Headcount: 0, Rows: []</c> for every farm on every request.
///
/// The zero was the dangerous half. A farm with four people working today and
/// nobody having said HOW MANY was told, in the app's own voice, that the count
/// was nought. These pin the four cases apart, using the SAME resolver
/// मजूर-दिवस uses so the two figures can never disagree about one crew.
/// </summary>
public sealed class BuildAttendanceDraftTests
{
    private static readonly Guid FarmId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Actor = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly DateTime CreatedAtUtc = new(2026, 8, 31, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateOnly Today = new(2026, 8, 31);
    private static readonly DateOnly Yesterday = new(2026, 8, 30);
    private static readonly Guid PlotA = Guid.Parse("aaaaaaaa-0000-0000-0000-00000000000a");
    private static readonly Guid PlotB = Guid.Parse("bbbbbbbb-0000-0000-0000-00000000000b");

    private static readonly Dictionary<Guid, string> PlotNames = new()
    {
        [PlotA] = "द्राक्ष-१",
        [PlotB] = "ऊस-२",
    };

    private static DailyLog FarmLog(Guid id, DateOnly date) => DailyLog.CreateForFarm(
        id, FarmId, Actor, date, idempotencyKey: null, location: null, createdAtUtc: CreatedAtUtc);

    private static DailyLog PlotLog(Guid id, DateOnly date, Guid plotId) => DailyLog.Create(
        id, FarmId, plotId, Guid.Parse("cccccccc-0000-0000-0000-00000000000c"), Actor, date,
        idempotencyKey: null, location: null, createdAtUtc: CreatedAtUtc);

    private static LabourAssignment Assignment(Guid logId, int? workerCount) =>
        LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: logId,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: workerCount,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: CreatedAtUtc,
            time: LabourTime.ServerAssumed());

    /// <summary>
    /// Nothing logged today is UNKNOWN, not zero. Nobody has said anything about
    /// today yet, and a 0 would claim they had.
    /// </summary>
    [Fact]
    public void NoLogTodayIsUnknownNotZero()
    {
        var logs = new List<DailyLog> { FarmLog(Guid.NewGuid(), Yesterday) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, [], PlotNames, Today);

        Assert.Null(draft.Headcount);
        Assert.Equal(string.Empty, draft.Plot);
    }

    /// <summary>
    /// A day that WAS logged with no labour on it is a genuine zero — he recorded
    /// the day and no hired hands were part of it.
    /// </summary>
    [Fact]
    public void ADayLoggedWithNoLabourIsARealZero()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { FarmLog(logId, Today) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, [], PlotNames, Today);

        Assert.Equal(0, draft.Headcount);
    }

    /// <summary>
    /// THE CASE THE OLD HARDCODED ZERO GOT WRONG. Labour happened today and
    /// nobody said how many — that is unknown, and rendering it as 0 tells the
    /// farmer the app believes nobody came.
    /// </summary>
    [Fact]
    public void LabourWithNoStatedCountIsUnknownNeverZero()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { FarmLog(logId, Today) };
        var assignments = new List<LabourAssignment> { Assignment(logId, workerCount: null) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, assignments, PlotNames, Today);

        Assert.Null(draft.Headcount);
    }

    /// <summary>
    /// Only the counts actually stated are summed. An unstated one contributes
    /// NOTHING rather than a zero that would quietly shrink the total.
    /// </summary>
    [Fact]
    public void OnlyStatedCountsAreSummed()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { FarmLog(logId, Today) };
        var assignments = new List<LabourAssignment>
        {
            Assignment(logId, workerCount: 4),
            Assignment(logId, workerCount: null),
            Assignment(logId, workerCount: 3),
        };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, assignments, PlotNames, Today);

        Assert.Equal(7, draft.Headcount);
    }

    /// <summary>Yesterday's crew is not today's. The draft is today only.</summary>
    [Fact]
    public void YesterdaysLabourDoesNotCountAsTodays()
    {
        var todayId = Guid.NewGuid();
        var yesterdayId = Guid.NewGuid();
        var logs = new List<DailyLog>
        {
            FarmLog(todayId, Today),
            FarmLog(yesterdayId, Yesterday),
        };
        var assignments = new List<LabourAssignment> { Assignment(yesterdayId, workerCount: 9) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, assignments, PlotNames, Today);

        Assert.Equal(0, draft.Headcount);
    }

    /// <summary>The plot is named only when today speaks with one voice.</summary>
    [Fact]
    public void ASinglePlotTodayIsNamed()
    {
        var logs = new List<DailyLog> { PlotLog(Guid.NewGuid(), Today, PlotA) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, [], PlotNames, Today);

        Assert.Equal("द्राक्ष-१", draft.Plot);
    }

    /// <summary>
    /// Two plots worked today is not one plot to name. Picking the first would put
    /// a plot on the screen the farmer never singled out.
    /// </summary>
    [Fact]
    public void TwoPlotsTodayNamesNeither()
    {
        var logs = new List<DailyLog>
        {
            PlotLog(Guid.NewGuid(), Today, PlotA),
            PlotLog(Guid.NewGuid(), Today, PlotB),
        };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, [], PlotNames, Today);

        Assert.Equal(string.Empty, draft.Plot);
    }

    /// <summary>
    /// Rows carry ONLY deliberate taps, and no save path carries those yet.
    /// Deriving them from spoken names would put marks in the register the farmer
    /// never made — being named present is not the same act as being marked.
    /// </summary>
    [Fact]
    public void RowsStayEmptyEvenWhenLabourExists()
    {
        var logId = Guid.NewGuid();
        var logs = new List<DailyLog> { FarmLog(logId, Today) };
        var assignments = new List<LabourAssignment> { Assignment(logId, workerCount: 4) };

        var draft = GetLabourDataHandler.BuildAttendanceDraft(logs, assignments, PlotNames, Today);

        Assert.Empty(draft.Rows);
    }
}
