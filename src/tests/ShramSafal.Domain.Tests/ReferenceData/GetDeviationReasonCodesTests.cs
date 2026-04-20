using FluentAssertions;
using ShramSafal.Application.UseCases.ReferenceData.GetDeviationReasonCodes;
using Xunit;

namespace ShramSafal.Domain.Tests.ReferenceData;

public sealed class GetDeviationReasonCodesTests
{
    [Fact]
    public async Task GetDeviationReasonCodes_Returns_SevenSeedRows()
    {
        var handler = new GetDeviationReasonCodesHandler();
        var result = await handler.HandleAsync();
        result.IsSuccess.Should().BeTrue();
        result.Value.Should().HaveCount(7);
    }

    [Fact]
    public void IsValidCode_KnownCode_ReturnsTrue()
    {
        GetDeviationReasonCodesHandler.IsValidCode("weather.rain").Should().BeTrue();
        GetDeviationReasonCodesHandler.IsValidCode("WEATHER.RAIN").Should().BeTrue();
        GetDeviationReasonCodesHandler.IsValidCode("operator.other").Should().BeTrue();
    }

    [Fact]
    public void IsValidCode_UnknownCode_ReturnsFalse()
    {
        GetDeviationReasonCodesHandler.IsValidCode("bogus.code").Should().BeFalse();
        GetDeviationReasonCodesHandler.IsValidCode("").Should().BeFalse();
    }
}
