// spec: plr-d10-redesign-real-integration-2026-10-25 — lane FIX-1, fix 2 (BILL-1b; founder D-105 (b), 2026-11-08: "Only you, the
// main owner, can change an approved bill's price. The bill then shows 'changed by owner' to everyone, you included.").
// The pure half: who may change an approved price, and when a bill carries the mark "मालकाने बदलला".
using System;
using System.Collections.Generic;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Finance.ApproveCostEntry;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class BillOwnerChangeTests
{
    private static readonly FarmId Farm = new(Guid.Parse("b1b10000-0000-4000-8000-0000000000f1"));
    private static readonly FarmId OtherFarm = new(Guid.Parse("b1b10000-0000-4000-8000-0000000000f9"));
    private static readonly UserId Maker = new(Guid.Parse("b1b10000-0000-4000-8000-0000000000f4"));
    private static readonly UserId Owner = new(Guid.Parse("b1b10000-0000-4000-8000-0000000000f5"));
    private static readonly DateTime Made = new(2026, 11, 8, 4, 0, 0, DateTimeKind.Utc);

    private static CostEntry Bill() => CostEntry.Create(
        Guid.NewGuid(), Farm, Guid.NewGuid(), null, "fertilizer", "खत", 1200m, "INR", new DateOnly(2026, 11, 7), Maker, null, Made);

    private static FinanceCorrection Change(CostEntry bill, decimal to, DateTime at) =>
        FinanceCorrection.Create(Guid.NewGuid(), bill.Id, 1200m, to, "INR", "दर बदलला", Owner, at);

    [Fact]
    public void Only_the_primary_account_holder_may_change_an_approved_price()
    {
        BillApprovalRules.MayChangeApprovedPrice(isPrimaryAccountHolder: true).Should().BeTrue();
        BillApprovalRules.MayChangeApprovedPrice(isPrimaryAccountHolder: false).Should().BeFalse();
    }

    [Fact]
    public void A_change_after_the_first_stamp_carries_the_mark_with_the_day_of_the_latest_change()
    {
        var bill = Bill();
        var stamp = bill.Approve(Guid.NewGuid(), Owner, 1, Made.AddMinutes(1));
        var first = Change(bill, 1300m, Made.AddMinutes(2));
        bill.MarkCorrected(first.Id, 1300m, "INR", first.CorrectedAtUtc);
        var second = Change(bill, 1400m, Made.AddMinutes(9));
        bill.MarkCorrected(second.Id, 1400m, "INR", second.CorrectedAtUtc);

        var marks = BillOwnerChange.Of([bill], [stamp], [first, second]);

        marks.Should().ContainKey(bill.Id);
        marks[bill.Id].Should().Be(Made.AddMinutes(9), "the latest change");
    }

    [Fact]
    public void A_change_before_any_stamp_is_ordinary_and_leaves_no_mark_even_after_the_approval()
    {
        var bill = Bill();
        var early = Change(bill, 1300m, Made.AddMinutes(1));
        bill.MarkCorrected(early.Id, 1300m, "INR", early.CorrectedAtUtc);
        var stamp = bill.Approve(Guid.NewGuid(), Owner, bill.ContentVersion, Made.AddMinutes(5));

        BillOwnerChange.Of([bill], [stamp], [early]).Should().BeEmpty();
        BillOwnerChange.Of([bill], [], [early]).Should().BeEmpty("a bill nobody approved is unchanged by the rule");
    }

    [Fact]
    public void The_mark_stays_after_the_new_version_is_approved_and_is_in_the_projection_for_everyone()
    {
        var bill = Bill();
        var old = bill.Approve(Guid.NewGuid(), Owner, 1, Made.AddMinutes(1));
        var change = Change(bill, 1300m, Made.AddMinutes(2));
        bill.MarkCorrected(change.Id, 1300m, "INR", change.CorrectedAtUtc);
        var again = bill.Approve(Guid.NewGuid(), Owner, 2, Made.AddMinutes(3));
        var marks = BillOwnerChange.Of([bill], [old, again], [change]);

        var dto = BillReviewProjection.WithReview(bill.ToDto(), bill, [old, again], new Dictionary<Guid, string>(), marks);

        dto.ChangedByOwnerAtUtc.Should().Be(Made.AddMinutes(2));
        dto.NeedsReview.Should().BeFalse("the new version is approved");
        dto.Approval!.BillVersion.Should().Be(2);

        // A bill with no such change carries no key at all (older phones' bytes are unchanged).
        var plain = Bill();
        var plainDto = BillReviewProjection.WithReview(plain.ToDto(), plain, [], new Dictionary<Guid, string>(), marks);
        plainDto.ChangedByOwnerAtUtc.Should().BeNull();
        System.Text.Json.JsonSerializer.Serialize(plainDto).Should().NotContain("changedByOwnerAtUtc", "never a key when there is no change");
    }

    [Fact]
    public void Another_bills_rows_and_another_farms_stamps_never_count()
    {
        var bill = Bill();
        var other = Bill();
        var change = Change(bill, 1300m, Made.AddMinutes(5));

        // A stamp of another bill does not make this bill's later correction a mark.
        var otherStamp = other.Approve(Guid.NewGuid(), Owner, 1, Made.AddMinutes(1));
        BillOwnerChange.Of([bill, other], [otherStamp], [change]).Should().BeEmpty();

        // A stamp whose farm is not the bill's farm (E4) is ignored.
        var foreignBill = CostEntry.Create(
            bill.Id, OtherFarm, Guid.NewGuid(), null, "fertilizer", "खत", 1200m, "INR", new DateOnly(2026, 11, 7), Maker, null, Made);
        var foreignStamp = foreignBill.Approve(Guid.NewGuid(), Owner, 1, Made.AddMinutes(1));
        BillOwnerChange.Of([bill], [foreignStamp], [change]).Should().BeEmpty();
    }
}
