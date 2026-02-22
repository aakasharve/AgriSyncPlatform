using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class DuplicateDetectorTests
{
    [Fact]
    public void SameCategoryPlotAmount_Within120Minutes_IsDuplicate()
    {
        var plotId = Guid.NewGuid();
        var baseTime = DateTime.UtcNow;
        var existing = CreateEntry("fertilizer", plotId, 500m, baseTime.AddMinutes(-30));
        var candidate = CreateEntry("fertilizer", plotId, 500m, baseTime);

        var isDuplicate = DuplicateDetector.IsPotentialDuplicate([existing], candidate, 120);

        Assert.True(isDuplicate);
    }

    [Fact]
    public void SameCategoryPlotAmount_After120Minutes_IsNotDuplicate()
    {
        var plotId = Guid.NewGuid();
        var baseTime = DateTime.UtcNow;
        var existing = CreateEntry("fertilizer", plotId, 500m, baseTime.AddMinutes(-121));
        var candidate = CreateEntry("fertilizer", plotId, 500m, baseTime);

        var isDuplicate = DuplicateDetector.IsPotentialDuplicate([existing], candidate, 120);

        Assert.False(isDuplicate);
    }

    [Fact]
    public void DifferentCategory_IsNotDuplicate()
    {
        var plotId = Guid.NewGuid();
        var baseTime = DateTime.UtcNow;
        var existing = CreateEntry("fuel", plotId, 500m, baseTime.AddMinutes(-30));
        var candidate = CreateEntry("fertilizer", plotId, 500m, baseTime);

        var isDuplicate = DuplicateDetector.IsPotentialDuplicate([existing], candidate, 120);

        Assert.False(isDuplicate);
    }

    private static CostEntry CreateEntry(string category, Guid? plotId, decimal amount, DateTime createdAtUtc)
    {
        return CostEntry.Create(
            Guid.NewGuid(),
            Guid.NewGuid(),
            plotId,
            Guid.NewGuid(),
            category,
            "test",
            amount,
            "INR",
            DateOnly.FromDateTime(createdAtUtc),
            Guid.NewGuid(),
            createdAtUtc);
    }
}
