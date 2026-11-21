// spec: trusted-control-room-2026-11-20 (CR-3 fix wave S-A5, AU-M5)
using System.Globalization;
using FluentAssertions;
using User.Application.UseCases.Auth.StartOtp;
using Xunit;

namespace UserDomainTests.Auth;

/// <summary>
/// Codes are drawn uniformly, with the same length and format as before: six digits by default, the first never 0.
/// Before, <c>% 10</c> on a random byte favoured 0-5 and a leading 0 became 1, so 1 was about twice as likely a first
/// digit as any other.
/// </summary>
public sealed class OtpCodeGenerationTests
{
    [Fact]
    public void A_code_is_six_digits_never_starting_with_zero_and_always_in_range()
    {
        for (var i = 0; i < 5000; i++)
        {
            var code = StartOtpHandler.GenerateOtp(6);

            code.Should().MatchRegex("^[1-9][0-9]{5}$");
            int.Parse(code, CultureInfo.InvariantCulture).Should().BeInRange(100000, 999999);
        }
    }

    [Theory]
    [InlineData(4, "^[1-9][0-9]{3}$")]
    [InlineData(9, "^[1-9][0-9]{8}$")]
    [InlineData(3, "^[1-9][0-9]{5}$")]
    [InlineData(10, "^[1-9][0-9]{5}$")]
    public void The_length_rule_is_unchanged(int length, string pattern)
    {
        for (var i = 0; i < 200; i++)
        {
            StartOtpHandler.GenerateOtp(length).Should().MatchRegex(pattern, $"length {length}: 4 to 9 digits, anything else is 6");
        }
    }

    [Fact]
    public void No_first_digit_is_favoured()
    {
        // 9000 draws: each first digit is expected about 1000 times (a standard deviation of about 30). The old draw
        // gave "1" about 1800. The bounds are more than 13 standard deviations out, so this never fails by chance.
        var counts = new int[10];
        for (var i = 0; i < 9000; i++)
        {
            counts[StartOtpHandler.GenerateOtp(6)[0] - '0']++;
        }

        counts[0].Should().Be(0, "a code never starts with 0");
        for (var digit = 1; digit <= 9; digit++)
        {
            counts[digit].Should().BeInRange(600, 1400, $"first digit {digit}");
        }
    }
}
