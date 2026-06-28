using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class FarmOperationSupersessionTests
{
    private static readonly FarmId Farm = new(Guid.Parse("00000000-0000-0000-0000-0000000000c2"));
    private static readonly UserId Actor = new(Guid.Parse("82afbe27-0000-0000-0000-000000000001"));
    private static readonly Guid Log = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static FarmOperation NewOp(Guid id, DerivedEventKey key) => FarmOperation.Create(
        id, Farm, plotId: null, operationType: "input", operationDate: new DateOnly(2025, 10, 28),
        sourceDailyLogId: Log, derivedEventKey: key, createdByUserId: Actor,
        provenance: Provenance.Manual("unknown"), createdAtUtc: new DateTime(2025, 10, 28, 0, 0, 0, DateTimeKind.Utc));

    [Fact]
    public void Create_starts_current_and_unsuperseded()
    {
        var op = NewOp(Guid.NewGuid(), DerivedEventKey.Compute(Log, "19-19-19", "input"));
        Assert.True(op.IsCurrentVersion);
        Assert.Null(op.SupersededByOperationId);
    }

    [Fact]
    public void MarkSuperseded_flips_current_and_stamps_successor()
    {
        var key = DerivedEventKey.Compute(Log, "19-19-19", "input");
        var oldOp = NewOp(Guid.NewGuid(), key);
        var newOp = NewOp(Guid.NewGuid(), key); // correction: SAME key, new row, current

        oldOp.MarkSuperseded(newOp.Id, new DateTime(2025, 10, 29, 0, 0, 0, DateTimeKind.Utc));

        Assert.False(oldOp.IsCurrentVersion);
        Assert.Equal(newOp.Id, oldOp.SupersededByOperationId);
        Assert.True(newOp.IsCurrentVersion);
        Assert.Equal(key, newOp.DerivedEventKey);
    }

    [Fact]
    public void MarkSuperseded_twice_throws()
    {
        var op = NewOp(Guid.NewGuid(), DerivedEventKey.Compute(Log, "19-19-19", "input"));
        op.MarkSuperseded(Guid.NewGuid(), DateTime.UtcNow);
        Assert.Throws<InvalidOperationException>(() => op.MarkSuperseded(Guid.NewGuid(), DateTime.UtcNow));
    }

    [Fact]
    public void Create_rejects_blank_operationType()
    {
        Assert.Throws<ArgumentException>(() => FarmOperation.Create(
            Guid.NewGuid(), Farm, null, " ", new DateOnly(2025, 10, 28), Log,
            DerivedEventKey.Compute(Log, "x", "input"), Actor, Provenance.Manual("unknown"), DateTime.UtcNow));
    }
}
