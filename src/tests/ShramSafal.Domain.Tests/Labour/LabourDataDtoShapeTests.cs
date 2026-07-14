using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

public sealed class LabourDataDtoShapeTests
{
    [Fact]
    public void LabourPersonDto_exposes_access_and_wage_book_fields()
    {
        // Option-3 wage-book (spec: 2026-07-13-labour-attendance-approval-design):
        // RecordedWages (काम झालं) = 4200, Paid (दिलं) = 2000, Advance (उचल) = 500.
        // Owed/बाकी is DERIVED (RecordedWages - Paid - Advance), never stored.
        var p = new LabourPersonDto("id", "रमेश", "र", "or", "worker", true, false, null, null,
            4200m, 2000m, 500m, "present", 6, null, 82, "review", 27, true);

        Assert.Equal("review", p.Access);
        Assert.Equal(4200m, p.RecordedWages);
        Assert.Equal(2000m, p.Paid);
        Assert.Equal(500m, p.Advance);
        Assert.Equal(1700m, p.RecordedWages - p.Paid - p.Advance);
    }

    [Fact]
    public void LabourMoneyDto_exposes_recorded_alongside_paid_advance_owed()
    {
        var money = new LabourMoneyDto(Recorded: 4200m, Paid: 2000m, Advance: 500m, Owed: 1700m);

        Assert.Equal(4200m, money.Recorded);
        Assert.Equal(2000m, money.Paid);
        Assert.Equal(500m, money.Advance);
        Assert.Equal(1700m, money.Owed);
        Assert.Equal(money.Owed, money.Recorded - money.Paid - money.Advance);
    }
}
