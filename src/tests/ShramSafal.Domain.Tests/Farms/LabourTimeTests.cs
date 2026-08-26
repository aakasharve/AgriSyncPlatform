using ShramSafal.Application.UseCases.Labour;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 4) — Time
/// truth. <see cref="LabourTime"/> pairs an hour count with WHO said so
/// (<see cref="LabourTimeBasis"/>); alone, <c>DurationHours</c> is a fabricated
/// number, so these tests prove both halves of the atomicity guard: the struct's
/// own factories reject non-positive hours, and
/// <see cref="LabourAssignment.Create"/> rejects the struct's unavoidable
/// <c>default</c> value (see the type-level remarks on <see cref="LabourTimeBasis"/>
/// for why a <c>readonly record struct</c> cannot be prevented from having one).
/// </summary>
public sealed class LabourTimeTests
{
    private static readonly Guid Log = Guid.Parse("77777777-7777-7777-7777-777777777777");

    [Fact]
    public void Explicit_sets_hours_and_basis()
    {
        var time = LabourTime.Explicit(4m);

        Assert.Equal(4m, time.Hours);
        Assert.Equal(LabourTimeBasis.Explicit, time.Basis);
    }

    [Fact]
    public void ServerAssumed_is_eight_hours_assumed()
    {
        var time = LabourTime.ServerAssumed();

        Assert.Equal(8m, time.Hours);
        Assert.Equal(LabourTimeBasis.Assumed, time.Basis);
    }

    [Fact]
    public void Explicit_zero_hours_throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => LabourTime.Explicit(0m));
    }

    [Fact]
    public void Assumed_negative_hours_throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => LabourTime.Assumed(-1m));
    }

    // THE atomicity guard (load-bearing): a readonly record struct always has an
    // implicit public parameterless constructor, so default(LabourTime) — Hours=0,
    // Basis=Unspecified — is reachable no matter how LabourTime's own named
    // factories are locked down. LabourAssignment.Create is what actually closes
    // that hole.
    [Fact]
    public void Create_with_default_LabourTime_throws()
    {
        Assert.Throws<ArgumentException>(() => LabourAssignment.Create(
            Guid.NewGuid(), Log, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: null, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null, linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow, time: default));
    }

    [Fact]
    public void Factory_built_assignment_carries_both_hours_and_basis()
    {
        var la = LabourAssignmentFactory.FromParsed(
            id: Guid.NewGuid(),
            dailyLogId: Log,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: 2,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: DateTime.UtcNow,
            time: LabourTime.Explicit(6m));

        Assert.Equal(6m, la.DurationHours);
        Assert.Equal(LabourTimeBasis.Explicit, la.TimeBasis);
    }
}
