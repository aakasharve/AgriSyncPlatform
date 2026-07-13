using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

public sealed class LabourDataDtoShapeTests
{
    [Fact]
    public void LabourPersonDto_exposes_access_and_balance_fields()
    {
        var p = new LabourPersonDto("id", "रमेश", "र", "or", "worker", true, false, null, null,
            2000m, 4200m, "present", 6, null, 82, "review", 27, true);

        Assert.Equal("review", p.Access);
        Assert.Equal(4200m - 2000m, p.Earned - p.Advance);
    }
}
