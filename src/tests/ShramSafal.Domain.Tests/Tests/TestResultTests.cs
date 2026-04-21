using FluentAssertions;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class TestResultTests
{
    [Fact]
    public void TestResult_InRange_DetectsBelow_Above_And_Within()
    {
        // Within range
        var within = new TestResult("pH", "6.5", "pH", ReferenceRangeLow: 6.0m, ReferenceRangeHigh: 7.5m);
        within.IsWithinRange().Should().BeTrue();

        // Below range
        var below = new TestResult("pH", "5.0", "pH", ReferenceRangeLow: 6.0m, ReferenceRangeHigh: 7.5m);
        below.IsWithinRange().Should().BeFalse();

        // Above range
        var above = new TestResult("pH", "8.5", "pH", ReferenceRangeLow: 6.0m, ReferenceRangeHigh: 7.5m);
        above.IsWithinRange().Should().BeFalse();

        // No bounds — always true
        var noBounds = new TestResult("pH", "6.5", "pH", ReferenceRangeLow: null, ReferenceRangeHigh: null);
        noBounds.IsWithinRange().Should().BeTrue();

        // Only lower bound set — within
        var lowerOnlyIn = new TestResult("N", "300", "ppm", ReferenceRangeLow: 250m, ReferenceRangeHigh: null);
        lowerOnlyIn.IsWithinRange().Should().BeTrue();

        // Only lower bound set — below
        var lowerOnlyBelow = new TestResult("N", "200", "ppm", ReferenceRangeLow: 250m, ReferenceRangeHigh: null);
        lowerOnlyBelow.IsWithinRange().Should().BeFalse();

        // Only upper bound set — within
        var upperOnlyIn = new TestResult("residue", "1.0", "ppm", ReferenceRangeLow: null, ReferenceRangeHigh: 2.0m);
        upperOnlyIn.IsWithinRange().Should().BeTrue();

        // Only upper bound set — above
        var upperOnlyAbove = new TestResult("residue", "3.0", "ppm", ReferenceRangeLow: null, ReferenceRangeHigh: 2.0m);
        upperOnlyAbove.IsWithinRange().Should().BeFalse();

        // Unparseable value with bounds — false (unknown)
        var unparseable = new TestResult("residue.level", "high", "category", ReferenceRangeLow: 0m, ReferenceRangeHigh: 1m);
        unparseable.IsWithinRange().Should().BeFalse();

        // Unparseable value with no bounds — true (no reference)
        var unparseableNoBounds = new TestResult("residue.level", "high", "category", ReferenceRangeLow: null, ReferenceRangeHigh: null);
        unparseableNoBounds.IsWithinRange().Should().BeTrue();
    }
}
