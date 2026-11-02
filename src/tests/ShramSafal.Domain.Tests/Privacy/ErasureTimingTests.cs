// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 1, item 11 (founder D-71, 2026-11-02).
using FluentAssertions;
using ShramSafal.Application.Privacy;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class ErasureTimingTests
{
    private static readonly DateTime Asked = new(2026, 11, 2, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void The_wait_is_thirty_days_unless_the_one_setting_says_otherwise()
    {
        new ErasureTiming().WaitBeforeErasure.Should().Be(TimeSpan.FromDays(30), "founder D-71");
        ErasureTiming.DefaultWaitDays.Should().Be(30);
        ErasureTiming.ConfigurationKey.Should().Be("Erasure:WaitBeforeErasureDays");
        new ErasureTiming(TimeSpan.FromDays(7)).WaitBeforeErasure.Should().Be(TimeSpan.FromDays(7));
        FluentActions.Invoking(() => new ErasureTiming(TimeSpan.FromDays(-1))).Should().Throw<ArgumentOutOfRangeException>();
    }

    [Fact]
    public void Erasure_starts_thirty_days_after_the_request_and_not_a_moment_before()
    {
        var timing = new ErasureTiming();
        var request = ErasureRequest.Submit(Guid.NewGuid(), null, Asked);

        timing.ErasureStartsAtUtc(request).Should().Be(Asked.AddDays(30));
        request.IsWaiting.Should().BeTrue();

        // The worker's rule: due when asked at or before (now - 30 days).
        (request.RequestedAtUtc <= timing.DueIfRequestedAtOrBefore(Asked.AddDays(30).AddTicks(-1))).Should().BeFalse();
        (request.RequestedAtUtc <= timing.DueIfRequestedAtOrBefore(Asked.AddDays(30))).Should().BeTrue();
    }

    [Fact]
    public void Only_a_waiting_request_is_waiting()
    {
        var request = ErasureRequest.Submit(Guid.NewGuid(), null, Asked);
        request.MarkInProgress();
        request.IsWaiting.Should().BeFalse("once the worker has taken it, it has started");
        ((int)ErasureStatus.Cancelled).Should().Be(5, "stored as an integer with no CHECK constraint: no migration");
    }
}
