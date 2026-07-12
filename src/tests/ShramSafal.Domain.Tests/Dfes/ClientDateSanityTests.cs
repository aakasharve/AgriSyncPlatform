using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class ClientDateSanityTests
{
    private static readonly DateOnly Today = new(2026, 7, 12);

    [Fact]
    public void Today_is_plausible()
        => ClientDateSanity.IsPlausible(Today, Today).Should().BeTrue();

    [Fact]
    public void Yesterday_and_backfill_within_two_years_is_plausible()
    {
        ClientDateSanity.IsPlausible(Today.AddDays(-1), Today).Should().BeTrue();
        ClientDateSanity.IsPlausible(Today.AddYears(-1), Today).Should().BeTrue();
    }

    [Fact]
    public void Tomorrow_within_one_grace_day_is_plausible()
        => ClientDateSanity.IsPlausible(Today.AddDays(1), Today).Should().BeTrue();

    [Fact]
    public void FarFuture_is_implausible()
        => ClientDateSanity.IsPlausible(Today.AddDays(2), Today).Should().BeFalse();

    [Fact]
    public void AncientDate_is_implausible()
        => ClientDateSanity.IsPlausible(Today.AddYears(-3), Today).Should().BeFalse();
}
