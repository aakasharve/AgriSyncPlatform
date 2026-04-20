using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Crops;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class CropCycleTests
{
    [Fact]
    public void Create_EndBeforeStart_Throws()
    {
        Assert.Throws<ArgumentException>(() => CropCycle.Create(
            Guid.NewGuid(),
            new FarmId(Guid.NewGuid()),
            Guid.NewGuid(),
            "Grapes",
            "Growth",
            new DateOnly(2026, 6, 30),
            new DateOnly(2026, 3, 1),
            DateTime.UtcNow));
    }
}
