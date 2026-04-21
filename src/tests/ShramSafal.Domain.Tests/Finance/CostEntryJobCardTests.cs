using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class CostEntryJobCardTests
{
    private static readonly FarmId TestFarmId = new(Guid.NewGuid());
    private static readonly DateOnly TestDate = new(2026, 4, 21);

    [Fact]
    public void CreateLabourPayout_SetsCategoryAndJobCardId()
    {
        var jobCardId = Guid.NewGuid();

        var entry = CostEntry.CreateLabourPayout(
            id: Guid.NewGuid(),
            jobCardId: jobCardId,
            farmId: TestFarmId,
            plotId: Guid.NewGuid(),
            cropCycleId: null,
            amount: 200m,
            currencyCode: "INR",
            entryDate: TestDate,
            createdByUserId: UserId.New(),
            createdAtUtc: DateTime.UtcNow);

        entry.Category.Should().Be("labour_payout");
        entry.JobCardId.Should().Be(jobCardId);
    }

    [Fact]
    public void GenericCreate_WithLabourPayoutCategory_Throws()
    {
        var act = () => CostEntry.Create(
            Guid.NewGuid(),
            TestFarmId,
            plotId: null,
            cropCycleId: null,
            category: "labour_payout",
            description: "test",
            amount: 200m,
            currencyCode: "INR",
            entryDate: TestDate,
            createdByUserId: UserId.New(),
            location: null,
            createdAtUtc: DateTime.UtcNow);

        act.Should().Throw<InvalidOperationException>()
           .WithMessage("*labour_payout*");
    }
}
