using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work;

public sealed class JobCardTests
{
    // ─── Shared test fixtures ────────────────────────────────────────────────

    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotId = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly UserId CreatorId = UserId.New();
    private static readonly UserId WorkerId = new(Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc"));
    private static readonly UserId AssignerId = new(Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd"));
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);

    private static JobCard BuildDraftJobCard()
    {
        var items = new[]
        {
            new JobCardLineItem("spray",   4m, new Money(50m, Currency.Inr), null),
            new JobCardLineItem("pruning", 2m, new Money(30m, Currency.Inr), null),
        };

        return JobCard.CreateDraft(
            Guid.NewGuid(),
            FarmId,
            PlotId,
            cropCycleId: null,
            CreatorId,
            new DateOnly(2026, 4, 21),
            items,
            Now);
    }

    // ─── Test 1 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_CreateDraft_StartsInDraft_WithEstimatedTotal()
    {
        var job = BuildDraftJobCard();

        job.Status.Should().Be(JobCardStatus.Draft);
        // 4×50 + 2×30 = 200 + 60 = 260
        job.EstimatedTotal.Amount.Should().Be(260m);
        job.EstimatedTotal.Currency.Should().Be(Currency.Inr);
    }

    // ─── Test 2 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_Assign_Worker_FromDraft_MovesToAssigned_AndRaisesEvent()
    {
        var job = BuildDraftJobCard();

        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);

        job.Status.Should().Be(JobCardStatus.Assigned);
        job.AssignedWorkerUserId.Should().Be(WorkerId);
        job.DomainEvents.Should().ContainSingle(e => e is JobCardAssignedEvent);
    }

    // ─── Test 3 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_Start_ByNonAssignedWorker_Throws()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);

        var otherWorker = UserId.New();
        var act = () => job.Start(otherWorker, Now.AddMinutes(5));

        act.Should().Throw<InvalidOperationException>();
    }

    // ─── Test 4 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_CompleteWithLog_RequiresDailyLogId()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));

        var dailyLogId = Guid.NewGuid();
        job.CompleteWithLog(dailyLogId, WorkerId, Now.AddHours(4));

        job.Status.Should().Be(JobCardStatus.Completed);
        job.LinkedDailyLogId.Should().Be(dailyLogId);
    }

    // ─── Test 5 ──────────────────────────────────────────────────────────────

    [Fact]
    public void MarkVerifiedForPayout_with_unverified_log_throws_I9()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));
        job.CompleteWithLog(Guid.NewGuid(), WorkerId, Now.AddHours(4));

        var act = () => job.MarkVerifiedForPayout(
            VerificationStatus.Confirmed,   // NOT Verified
            UserId.New(), AppRole.PrimaryOwner, Now.AddHours(5));

        act.Should().Throw<InvalidOperationException>()
           .WithMessage("*Verified*");
    }

    // ─── Test 6 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_MarkVerifiedForPayout_VerifiedLog_PrimaryOwner_Succeeds()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));
        job.CompleteWithLog(Guid.NewGuid(), WorkerId, Now.AddHours(4));

        job.MarkVerifiedForPayout(
            VerificationStatus.Verified,
            UserId.New(), AppRole.PrimaryOwner, Now.AddHours(5));

        job.Status.Should().Be(JobCardStatus.VerifiedForPayout);
    }

    // ─── Test 7 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_MarkPaidOut_RequiresCostEntryId_AndMovesToTerminal()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));
        job.CompleteWithLog(Guid.NewGuid(), WorkerId, Now.AddHours(4));
        job.MarkVerifiedForPayout(VerificationStatus.Verified, UserId.New(), AppRole.PrimaryOwner, Now.AddHours(5));

        var costEntryId = Guid.NewGuid();
        job.MarkPaidOut(costEntryId, Now.AddHours(6));

        job.Status.Should().Be(JobCardStatus.PaidOut);
        job.PayoutCostEntryId.Should().Be(costEntryId);
    }

    // ─── Test 8 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_Cancel_AfterVerifiedForPayout_Throws()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));
        job.CompleteWithLog(Guid.NewGuid(), WorkerId, Now.AddHours(4));
        job.MarkVerifiedForPayout(VerificationStatus.Verified, UserId.New(), AppRole.PrimaryOwner, Now.AddHours(5));

        var act = () => job.Cancel(UserId.New(), AppRole.PrimaryOwner, "test", Now.AddHours(6));

        act.Should().Throw<InvalidOperationException>();
    }

    // ─── Test 9 ──────────────────────────────────────────────────────────────

    [Fact]
    public void JobCard_CheckEligibility_ReturnsIneligibleWithReason_WhenNotVerified()
    {
        var job = BuildDraftJobCard();
        job.Assign(WorkerId, AssignerId, AppRole.Mukadam, Now);
        job.Start(WorkerId, Now.AddMinutes(5));
        job.CompleteWithLog(Guid.NewGuid(), WorkerId, Now.AddHours(4));

        var result = job.CheckEligibility(VerificationStatus.Confirmed);

        result.IsEligible.Should().BeFalse();
        result.ReasonEn.Should().NotBeNull();
    }
}
