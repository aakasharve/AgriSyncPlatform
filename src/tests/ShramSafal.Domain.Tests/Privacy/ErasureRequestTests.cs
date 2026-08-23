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

    // ── erasure-honesty (spec: dfes-companion-2026-07-11) ────────────────
    // Founder ruling 2026-08-23 ITEM 4: the system must never tell a farmer
    // something is deleted while ARVE knowingly retains the active copy.

    [Fact]
    public void AwaitingManualCompletion_records_counts_but_never_stamps_a_completion_time()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();

        req.MarkAwaitingManualCompletion(42);

        req.Status.Should().Be(ErasureStatus.AwaitingManualCompletion);
        req.Status.Should().NotBe(ErasureStatus.Completed,
            "a request with outstanding manual steps is not completed");
        req.RowsAnonymizedCount.Should().Be(42);
        req.CompletedAtUtc.Should().BeNull(
            "nothing is complete yet — a completion timestamp here would be the same lie in another column");
    }

    [Fact]
    public void AwaitingManualCompletion_requires_InProgress()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        Action act = () => req.MarkAwaitingManualCompletion(1);
        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void FSM_InProgress_to_AwaitingManualCompletion_to_Completed()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();
        req.MarkAwaitingManualCompletion(7);

        req.MarkManuallyCompleted(FixedNow.AddHours(30));

        req.Status.Should().Be(ErasureStatus.Completed);
        req.CompletedAtUtc.Should().Be(FixedNow.AddHours(30),
            "the completion time is when the person at ARVE finished, not when the worker ran");
        req.RowsAnonymizedCount.Should().Be(7,
            "the manual close must not overwrite what the worker recorded");
    }

    [Fact]
    public void ManualCompletion_cannot_shortcut_a_request_still_InProgress()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();

        Action act = () => req.MarkManuallyCompleted(FixedNow.AddHours(1));

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void ManualCompletion_cannot_reopen_a_Failed_request()
    {
        var req = ErasureRequest.Submit(Guid.NewGuid(), null, FixedNow);
        req.MarkInProgress();
        req.MarkFailed("S3 timeout", FixedNow.AddHours(1));

        Action act = () => req.MarkManuallyCompleted(FixedNow.AddHours(2));

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
