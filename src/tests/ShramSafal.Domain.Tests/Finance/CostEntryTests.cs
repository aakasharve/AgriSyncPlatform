using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class CostEntryTests
{
    [Fact]
    public void Create_WithZeroAmount_Throws()
    {
        Assert.Throws<ArgumentException>(() => CostEntry.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            plotId: null,
            cropCycleId: null,
            category: "Labour",
            description: "test",
            amount: 0m,
            currencyCode: "INR",
            entryDate: new DateOnly(2026, 4, 18),
            createdByUserId: new UserId(Guid.NewGuid()),
            location: null,
            createdAtUtc: DateTime.UtcNow));
    }

    [Fact]
    public void Create_WithNegativeAmount_Throws()
    {
        Assert.Throws<ArgumentException>(() => CostEntry.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            plotId: null,
            cropCycleId: null,
            category: "Labour",
            description: "test",
            amount: -10m,
            currencyCode: "INR",
            entryDate: new DateOnly(2026, 4, 18),
            createdByUserId: new UserId(Guid.NewGuid()),
            location: null,
            createdAtUtc: DateTime.UtcNow));
    }
}
