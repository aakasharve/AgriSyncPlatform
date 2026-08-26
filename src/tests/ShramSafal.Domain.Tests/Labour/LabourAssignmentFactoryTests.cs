using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 3 fix
/// round 1) — headcount resolution on the WRITE path.
///
/// <para>Nothing was watching this path before: <c>LabourAssignmentTests</c>
/// calls <c>LabourAssignment.Create</c> directly and so bypasses the factory
/// entirely, which is why the whole DOMAIN suite staying at its baseline count
/// was NOT evidence that routing the voice path through the factory preserved
/// behaviour. These tests watch the factory itself.</para>
///
/// <para>The distinction under test is <b>silence vs. zero</b>. NULL means "the
/// farmer never told us"; 0 means "the farmer said zero". Collapsing the first
/// into the second asserts that nobody worked on rows that describe real work
/// (e.g. a lump-sum contract stated with a quantity but no headcount), and from
/// Task 4 onward that surfaces to the farmer as 0 hours. There is no backfill
/// job in this system, so a wrong write is permanent.</para>
/// </summary>
public sealed class LabourAssignmentFactoryTests
{
    private static readonly Guid Log = Guid.NewGuid();

    private static LabourAssignment Build(int? workerCount, int? maleCount, int? femaleCount) =>
        LabourAssignmentFactory.FromParsed(
            id: Guid.NewGuid(),
            dailyLogId: Log,
            engagementType: LabourEngagementType.Hired,
            maleCount: maleCount,
            femaleCount: femaleCount,
            workerCount: workerCount,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow,
            time: LabourTime.ServerAssumed());

    [Fact]
    public void FromParsed_no_headcount_stated_at_all_keeps_WorkerCount_null()
    {
        // "Contract ne 2 acre chhatani keli" — a live shape on the shipping voice
        // path (Prompts/buckets/labour.v1.md): engagement + quantity, no count.
        // NULL must survive as "we were not told", never become "zero people worked".
        var la = Build(workerCount: null, maleCount: null, femaleCount: null);

        Assert.Null(la.WorkerCount);
    }

    [Fact]
    public void FromParsed_split_only_resolves_to_the_sum()
    {
        // The defect Task 2 exists to fix: headcount stated ONLY in the gender
        // split must still yield a real count, with the split retained beside it.
        var la = Build(workerCount: null, maleCount: 4, femaleCount: 2);

        Assert.Equal(6, la.WorkerCount);
        Assert.Equal(4, la.MaleCount);
        Assert.Equal(2, la.FemaleCount);
    }

    [Fact]
    public void FromParsed_explicit_zero_is_stored_as_zero_not_null()
    {
        // The other side of the silence/zero distinction — a stated 0 stays 0 and
        // remains distinguishable from "not stated".
        var la = Build(workerCount: 0, maleCount: null, femaleCount: null);

        Assert.Equal(0, la.WorkerCount);
    }

    [Fact]
    public void FromParsed_count_wins_over_the_split_without_double_counting()
    {
        // The parser emits count=5 AND femaleCount=5 for "५ बायका"; adding them
        // would report 10 workers for 5 women.
        var la = Build(workerCount: 5, maleCount: null, femaleCount: 5);

        Assert.Equal(5, la.WorkerCount);
        Assert.Equal(5, la.FemaleCount);
    }
}
