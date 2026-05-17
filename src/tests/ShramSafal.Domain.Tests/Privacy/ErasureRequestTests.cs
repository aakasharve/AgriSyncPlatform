// spec: data-principle-spine-2026-05-05/08.1
using FluentAssertions;
using ShramSafal.Domain.Privacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy;

public sealed class ErasureRequestTests
{
    private static readonly DateTime FixedNow = new(2026, 5, 17, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void Submit_self_serve_carries_requested_status()
    {
        var userId = Guid.NewGuid();
        var req = ErasureRequest.Submit(userId, null, FixedNow);

        req.Id.Should().NotBe(Guid.Empty);
        req.RequestedByUserId.Should().Be(userId);
        req.OnBehalfOfUserId.Should().BeNull();
        req.TargetUserId.Should().Be(userId);
        req.Status.Should().Be(ErasureStatus.Requested);
        req.RequestedAtUtc.Should().Be(FixedNow);
    }

    [Fact]
    public void Submit_admin_on_behalf_of_carries_targetUserId_from_behalf_field()
    {
        var admin = Guid.NewGuid();
        var target = Guid.NewGuid();
        var req = ErasureRequest.Submit(admin, target, FixedNow);

        req.RequestedByUserId.Should().Be(admin);
        req.OnBehalfOfUserId.Should().Be(target);
        req.TargetUserId.Should().Be(target,
            "TargetUserId resolves to OnBehalfOf when non-null");
    }

    [Fact]
    public void Submit_rejects_empty_requestedBy()
    {
        Action act = () => ErasureRequest.Submit(Guid.Empty, null, FixedNow);
        act.Should().Throw<ArgumentException>().WithMessage("*requestedByUserId*");
    }

    [Fact]
    public void Submit_rejects_empty_onBehalfOf_when_set()
    {
        Action act = () => ErasureRequest.Submit(Guid.NewGuid(), Guid.Empty, FixedNow);
        act.Should().Throw<ArgumentException>().WithMessage("*onBehalfOfUserId*");
    }

    [Fact]
    public void FSM_Requested_to_InProgress_to_Completed()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();
        req.Status.Should().Be(ErasureStatus.InProgress);
        req.MarkCompleted(42, FixedNow.AddHours(1));
        req.Status.Should().Be(ErasureStatus.Completed);
        req.RowsAnonymizedCount.Should().Be(42);
        req.CompletedAtUtc.Should().Be(FixedNow.AddHours(1));
    }

    [Fact]
    public void FSM_skipping_InProgress_throws()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        Action act = () => req.MarkCompleted(1, FixedNow);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void Failed_terminates_with_reason()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();
        req.MarkFailed("S3 timeout", FixedNow.AddHours(1));
        req.Status.Should().Be(ErasureStatus.Failed);
        req.FailureReason.Should().Be("S3 timeout");
    }
}
