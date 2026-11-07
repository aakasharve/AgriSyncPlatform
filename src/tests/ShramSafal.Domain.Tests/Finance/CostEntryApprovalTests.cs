// spec: plr-d10-redesign-real-integration-2026-10-25 — lane BILL-1 (founder D-12: "2 — A separate "मंजूर" stamp with who and
// when"). The domain half: which version a bill is, the stamp an approval makes, and the one "तपासायचे" rule.
using System;
using System.Collections.Generic;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class CostEntryApprovalTests
{
    private static readonly FarmId Farm = new(Guid.Parse("b1110000-0000-4000-8000-0000000000f1"));
    private static readonly Guid Plot = Guid.Parse("b1110000-0000-4000-8000-0000000000f2");
    private static readonly Guid OtherPlot = Guid.Parse("b1110000-0000-4000-8000-0000000000f3");
    private static readonly UserId Maker = new(Guid.Parse("b1110000-0000-4000-8000-0000000000f4"));
    private static readonly UserId Reviewer = new(Guid.Parse("b1110000-0000-4000-8000-0000000000f5"));
    private static readonly DateTime Made = new(2026, 11, 7, 4, 0, 0, DateTimeKind.Utc);

    private static CostEntry Bill(decimal amount = 1200m, bool flagged = false)
    {
        var entry = CostEntry.Create(
            Guid.NewGuid(), Farm, Plot, null, "fertilizer", "खत", amount, "INR", new DateOnly(2026, 11, 6), Maker, null, Made);
        if (flagged)
        {
            entry.Flag(CostEntry.ReviewAmountReason);
        }

        return entry;
    }

    [Fact]
    public void A_bill_as_first_saved_is_version_1_and_each_correction_or_move_makes_a_new_one()
    {
        var bill = Bill();
        bill.ContentVersion.Should().Be(1);

        bill.MarkCorrected(Guid.NewGuid(), 1100m, "INR", Made.AddMinutes(1));
        bill.ContentVersion.Should().Be(2, "a corrected amount is a new version");

        bill.FollowRecord(Plot, null, bill.EntryDate, Made.AddMinutes(2));
        bill.ContentVersion.Should().Be(2, "a move that changes nothing says nothing new");

        bill.FollowRecord(OtherPlot, null, bill.EntryDate, Made.AddMinutes(3));
        bill.ContentVersion.Should().Be(3, "another place is a new version");

        bill.FollowRecord(OtherPlot, null, bill.EntryDate.AddDays(-1), Made.AddMinutes(4));
        bill.ContentVersion.Should().Be(4, "another day is a new version");
    }

    [Fact]
    public void Its_audience_its_flag_and_an_approval_do_not_change_its_version()
    {
        var bill = Bill();
        bill.SetAudience(RecordAudience.OnlyMe, Made.AddMinutes(1));
        bill.FlagForReview(CostEntry.ReviewAmountReason, Made.AddMinutes(2));
        bill.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(3));
        bill.ContentVersion.Should().Be(1);
    }

    [Fact]
    public void An_approval_stamps_who_when_and_which_version_and_moves_the_bill_past_every_cursor()
    {
        var bill = Bill();
        var modifiedBefore = bill.ModifiedAtUtc;
        var at = new DateTime(2026, 11, 7, 5, 0, 0, DateTimeKind.Utc); // exactly on a whole second
        var id = Guid.NewGuid();

        var stamp = bill.Approve(id, Reviewer, 1, at, "approve_cost_entry:req-1", "1.0.18");

        stamp.Id.Should().Be(id);
        stamp.FarmId.Should().Be(Farm);
        stamp.CostEntryId.Should().Be(bill.Id);
        stamp.ApprovedByUserId.Should().Be(Reviewer);
        stamp.ApprovedAtUtc.Should().Be(at);
        stamp.BillVersion.Should().Be(1);
        stamp.ClientRequestId.Should().Be("approve_cost_entry:req-1");
        bill.ModifiedAtUtc.Should().BeAfter(modifiedBefore);
        (bill.ModifiedAtUtc.Ticks % TimeSpan.TicksPerSecond).Should().NotBe(0, "a whole-second cursor could pass a stamp on the second");
        bill.Amount.Should().Be(1200m, "an approval never changes the bill's figures");
    }

    [Fact]
    public void An_approval_of_a_version_that_moved_on_is_never_stamped()
    {
        var bill = Bill();
        bill.MarkCorrected(Guid.NewGuid(), 1100m, "INR", Made.AddMinutes(1));

        var stale = () => bill.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(2));

        stale.Should().Throw<InvalidOperationException>();
        bill.Approve(Guid.NewGuid(), Reviewer, 2, Made.AddMinutes(3)).BillVersion.Should().Be(2);
    }

    [Fact]
    public void An_approval_needs_its_own_id_and_who_gave_it()
    {
        var bill = Bill();
        ((Action)(() => bill.Approve(Guid.Empty, Reviewer, 1, Made))).Should().Throw<ArgumentException>();
        ((Action)(() => bill.Approve(Guid.NewGuid(), new UserId(Guid.Empty), 1, Made))).Should().Throw<ArgumentException>();
    }

    [Fact]
    public void The_flag_clears_only_for_the_approved_version()
    {
        var bill = Bill(31000m, flagged: true);
        var stamps = new List<CostEntryApproval>();
        CostEntryReview.NeedsReview(bill, stamps).Should().BeTrue("set aside, nobody approved it");

        stamps.Add(bill.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(1)));
        CostEntryReview.NeedsReview(bill, stamps).Should().BeFalse("approved at the version it stands at");

        bill.MarkCorrected(Guid.NewGuid(), 32000m, "INR", Made.AddMinutes(2));
        CostEntryReview.NeedsReview(bill, stamps).Should().BeTrue("the stamp was for version 1; the bill is version 2");
        bill.IsFlagged.Should().BeTrue("the flag itself is history (P3)");

        stamps.Add(bill.Approve(Guid.NewGuid(), Reviewer, 2, Made.AddMinutes(3)));
        CostEntryReview.NeedsReview(bill, stamps).Should().BeFalse();
    }

    [Fact]
    public void A_bill_never_set_aside_is_never_waiting_for_review()
    {
        var bill = Bill();
        CostEntryReview.NeedsReview(bill, []).Should().BeFalse();
        bill.MarkCorrected(Guid.NewGuid(), 900m, "INR", Made.AddMinutes(1));
        CostEntryReview.NeedsReview(bill, []).Should().BeFalse();
    }

    [Fact]
    public void Only_this_bills_stamps_count_and_the_latest_is_shown()
    {
        var bill = Bill(31000m, flagged: true);
        var other = Bill(31000m, flagged: true);
        var foreign = other.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(1));
        CostEntryReview.NeedsReview(bill, [foreign]).Should().BeTrue("another bill's stamp is not this bill's");

        var first = bill.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(2));
        var second = bill.Approve(Guid.NewGuid(), Maker, 1, Made.AddMinutes(3));
        CostEntryReview.Latest(bill, [first, second, foreign]).Should().BeSameAs(second);
    }

    [Fact]
    public void The_pull_projection_names_the_version_the_review_state_and_the_latest_stamp()
    {
        var bill = Bill(31000m, flagged: true);
        var stamp = bill.Approve(Guid.NewGuid(), Reviewer, 1, Made.AddMinutes(1));
        bill.MarkCorrected(Guid.NewGuid(), 32000m, "INR", Made.AddMinutes(2));
        var names = new Dictionary<Guid, string> { [Reviewer.Value] = "मुकादम-गणेश" };

        var dto = BillReviewProjection.WithReview(bill.ToDto(), bill, [stamp], names);

        dto.BillVersion.Should().Be(2);
        dto.NeedsReview.Should().BeTrue();
        dto.ReviewReason.Should().Be(CostEntry.ReviewAmountReason);
        dto.Approval!.BillVersion.Should().Be(1, "the stamp reads as for an older version");
        dto.Approval.ApprovedByUserId.Should().Be(Reviewer.Value);
        dto.Approval.ApprovedByName.Should().Be("मुकादम-गणेश");
        dto.Amount.Should().Be(31000m, "the bill's first figure is kept; the correction travels on its own (P3)");

        var unnamed = BillReviewProjection.WithReview(bill.ToDto(), bill, [stamp], new Dictionary<Guid, string>());
        unnamed.Approval!.ApprovedByName.Should().BeNull("a name this reader may not be sent is left out, never guessed");
    }
}
