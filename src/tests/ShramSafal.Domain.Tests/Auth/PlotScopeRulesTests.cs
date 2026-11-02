// spec: plr-d10 lane MU-4 (MU design §2 "Scope", §3 G2, §11.6, §11.7) — the pure halves of "which plots one person
// covers": the seat's choice and its refusals, the read scope it gives, the farm-setup rule, the ONE place rule beside the
// audience rule (a record reaches a person only when both allow it), a split bill as his share lines, a bill photo that no
// money of his names, and a record spanning plots narrowed to his. Enumerated without a database.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class PlotScopeRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("4d000000-0000-4000-8000-0000000000f1");
    private static readonly Guid Reader = Guid.Parse("4d000000-0000-4000-8000-000000000001");
    private static readonly Guid Owner = Guid.Parse("4d000000-0000-4000-8000-000000000002");
    private static readonly Guid P1 = Guid.Parse("4d000000-0000-4000-8000-0000000000a1");
    private static readonly Guid P2 = Guid.Parse("4d000000-0000-4000-8000-0000000000a2");
    private static readonly Guid P4 = Guid.Parse("4d000000-0000-4000-8000-0000000000a4");

    private static FarmMembership Seat(AppRole role = AppRole.Mukadam) =>
        FarmMembership.Create(Guid.NewGuid(), new FarmId(Farm), new UserId(Reader), role, Now.AddDays(-30), JoinedVia.OwnerManualAdd);

    private static FarmAccess Access(MembershipPlotScope scope, params Guid[] plots) =>
        new(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.SeeMoney | FarmPermission.EditFarmSetup,
            PlotScope: scope, ScopePlotIds: plots);

    private static FarmReadScope Scope(MembershipPlotScope scope, params Guid[] plots) =>
        FarmReadScope.Of(Farm, Access(scope, plots), Now)!;

    // ── The seat's choice ────────────────────────────────────────────────────────────────

    [Fact]
    public void Every_seat_covers_every_plot_until_the_holder_chooses()
    {
        var seat = Seat();
        seat.PlotScope.Should().Be(MembershipPlotScope.AllPlots);
        seat.ScopePlotIds.Should().BeEmpty();
    }

    [Fact]
    public void Choosing_plots_stores_them_once_and_moves_the_access_stamp_a_resend_is_not_a_decision()
    {
        var seat = Seat();
        seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [P4, P2], Now).Should().BeTrue();
        seat.PlotScope.Should().Be(MembershipPlotScope.ChosenPlots);
        seat.ScopePlotIds.Should().BeEquivalentTo([P2, P4]);
        seat.AccessChangedAtUtc.Should().Be(Now, "the phone purges on a narrowing, the pull re-sends on a widening");

        seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [P2, P4], Now.AddMinutes(1)).Should().BeFalse("the same choice again");
        seat.AccessChangedAtUtc.Should().Be(Now);

        seat.SetPlotScope(MembershipPlotScope.OwnWork, null, Now.AddMinutes(2)).Should().BeTrue();
        seat.ScopePlotIds.Should().BeEmpty("only chosen plots name plots");
        seat.SetPlotScope(MembershipPlotScope.AllPlots, [], Now.AddMinutes(3)).Should().BeTrue();
        seat.AccessChangedAtUtc.Should().Be(Now.AddMinutes(3));
    }

    [Fact]
    public void A_choice_that_cannot_be_honoured_is_refused_never_trimmed()
    {
        var seat = Seat();
        FluentActions.Invoking(() => seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [], Now))
            .Should().Throw<ArgumentException>("chosen plots need one or more");
        FluentActions.Invoking(() => seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [Guid.Empty], Now))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => seat.SetPlotScope(MembershipPlotScope.AllPlots, [P1], Now))
            .Should().Throw<ArgumentException>("plots named for another scope");
        FluentActions.Invoking(() => seat.SetPlotScope((MembershipPlotScope)7, null, Now))
            .Should().Throw<ArgumentException>();
        FluentActions.Invoking(() => Seat(AppRole.PrimaryOwner).SetPlotScope(MembershipPlotScope.ChosenPlots, [P1], Now))
            .Should().Throw<InvalidOperationException>("the primary owner covers every plot");

        var ended = Seat();
        ended.Revoke(Now);
        FluentActions.Invoking(() => ended.SetPlotScope(MembershipPlotScope.OwnWork, null, Now))
            .Should().Throw<InvalidOperationException>();
        seat.PlotScope.Should().Be(MembershipPlotScope.AllPlots, "nothing half-applied");
    }

    // ── The read scope and the farm-setup rule ───────────────────────────────────────────

    [Fact]
    public void A_chosen_plots_seat_reads_his_plots_an_own_work_seat_reads_his_own_records_and_the_owner_reads_all()
    {
        var chosen = Scope(MembershipPlotScope.ChosenPlots, P2, P4);
        chosen.PlotIds.Should().BeEquivalentTo([P2, P4]);
        chosen.OwnRecordsOnly.Should().BeFalse();
        chosen.CoversPlot(P2).Should().BeTrue();
        chosen.CoversPlot(P1).Should().BeFalse();
        chosen.SeeMoney.Should().BeTrue("the scope narrows WHERE, never what his authorities allow");

        var ownWork = Scope(MembershipPlotScope.OwnWork);
        ownWork.OwnRecordsOnly.Should().BeTrue("one own-records rule with the कामगार label");
        ownWork.PlotIds.Should().BeNull("he logs on any plot; he reads by maker");
        ownWork.SeeFarmOverview.Should().BeFalse();

        Scope(MembershipPlotScope.AllPlots).PlotIds.Should().BeNull();
        var registrant = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null,
            PlotScope: MembershipPlotScope.ChosenPlots, ScopePlotIds: [P1]);
        FarmReadScope.Of(Farm, registrant, Now)!.PlotIds.Should().BeNull("the registrant covers every plot, whatever a row says");
    }

    [Fact]
    public void Editing_the_farm_setup_needs_the_authority_and_every_plot()
    {
        FarmAccessPolicy.Holds(Access(MembershipPlotScope.AllPlots), FarmAuthority.EditFarmSetup, Now).Should().BeTrue();
        FarmAccessPolicy.Holds(Access(MembershipPlotScope.ChosenPlots, P2), FarmAuthority.EditFarmSetup, Now).Should().BeFalse();
        FarmAccessPolicy.Holds(Access(MembershipPlotScope.OwnWork), FarmAuthority.EditFarmSetup, Now).Should().BeFalse();
        FarmAccessPolicy.Holds(Access(MembershipPlotScope.ChosenPlots, P2), FarmAuthority.SeeMoney, Now).Should().BeTrue("only setup editing");
    }

    // ── The place rule ───────────────────────────────────────────────────────────────────

    private static RecordPlace LogOn(Guid maker, params Guid[] plots) =>
        RecordPlace.OfLog(Guid.NewGuid(), Farm, maker, new DateOnly(2026, 10, 30), Now,
            plots.Length == 0 ? DailyLogScope.Farm : plots.Length == 1 ? DailyLogScope.Plot : DailyLogScope.MultiPlot,
            plots.Length == 1 ? plots[0] : null, plots, null);

    private static RecordPlace CostOn(Guid maker, Guid? plot, params Guid[] bills) =>
        RecordPlace.OfCost(Guid.NewGuid(), Farm, maker, new DateOnly(2026, 10, 30), Now, plot, null,
            bills.Length == 0 ? null : "[" + string.Join(",", bills.Select(b => $"\"{b}\"")) + "]");

    [Fact]
    public void A_chosen_plots_seat_sees_a_record_on_his_plots_and_a_whole_farm_one_only_if_he_made_it()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2, P4);
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Owner, P2)).Should().BeTrue();
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Owner, P1, P2)).Should().BeTrue("one of its plots is his (sent narrowed)");
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Owner, P1)).Should().BeFalse();
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Reader, P1)).Should().BeFalse("outside his plots, even his own: neither sent");
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Owner)).Should().BeFalse("the whole farm's, made by someone else");
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Reader)).Should().BeTrue("the whole farm's, made by him");

        RecordPlaceRule.MaySee(mine, Reader, CostOn(Owner, P2)).Should().BeTrue();
        RecordPlaceRule.MaySee(mine, Reader, CostOn(Owner, P1)).Should().BeFalse();
        RecordPlaceRule.MaySee(mine, Reader, CostOn(Owner, null)).Should().BeFalse("shared, split or unallocated");
        RecordPlaceRule.MaySee(mine, Reader, CostOn(Reader, null)).Should().BeTrue("his own submission and its status (D-28)");
    }

    [Fact]
    public void An_own_work_seat_sees_only_his_own_and_every_plot_seat_sees_everything()
    {
        var own = Scope(MembershipPlotScope.OwnWork);
        RecordPlaceRule.MaySee(own, Reader, CostOn(Reader, null)).Should().BeTrue("his own money");
        RecordPlaceRule.MaySee(own, Reader, CostOn(Owner, P1)).Should().BeFalse("nothing of other people's money");
        RecordPlaceRule.MaySee(own, Reader, LogOn(Owner, P1)).Should().BeTrue(
            "other people's work records keep MU-3's own-records rule at each door (the pull sends him his own only)");
        own.MayReadRecordOf(Reader, Owner).Should().BeFalse("MU-3's rule, now also the स्वतःचं काम scope's");
        own.MayReadRecordOf(Reader, Reader).Should().BeTrue();

        var all = Scope(MembershipPlotScope.AllPlots);
        RecordPlaceRule.Narrows(all).Should().BeFalse();
        RecordPlaceRule.MaySee(all, Reader, LogOn(Owner)).Should().BeTrue();
        RecordPlaceRule.MaySee(null, Reader, LogOn(Owner)).Should().BeFalse("no seat, nothing");
    }

    [Fact]
    public void Out_of_place_records_are_hidden_from_every_door_but_are_never_counted_as_left_out_by_rule()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        var onP1 = LogOn(Owner, P1);
        var onP2 = LogOn(Owner, P2);
        var bill = Guid.NewGuid();
        var otherBill = Guid.NewGuid();
        var costP2 = CostOn(Owner, P2, bill);
        var visibility = RecordVisibility.For(
            Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = mine }, [], [onP1, onP2, costP2]);

        visibility.MaySeeLog(onP1.Id).Should().BeFalse();
        visibility.MaySeeLog(onP2.Id).Should().BeTrue();
        visibility.MentionsHidden($"{{\"dailyLogId\":\"{onP1.Id}\"}}").Should().BeTrue("its id is found nowhere");
        visibility.Hidden.Should().BeEmpty("not the audience's: no W4 'not counted' line");
        visibility.AnyHiddenOn(Farm).Should().BeFalse();
        visibility.HiddenByAudience(RecordKinds.DailyLog, onP1.Id).Should().BeFalse();
        visibility.OutOfPlace.Select(r => r.Id).Should().Equal([onP1.Id]);

        Attachment Bill(Guid id) => Attachment.Create(id, new FarmId(Farm), Farm, "Bill", "b.jpg", "image/jpeg", new UserId(Owner), Now);
        visibility.MaySeeAttachment(Bill(bill)).Should().BeTrue("named by money he sees");
        visibility.MaySeeAttachment(Bill(otherBill)).Should().BeFalse("a bill no money of his names: fail closed");
        visibility.MaySeeAttachment(Attachment.Create(otherBill, new FarmId(Farm), Farm, "Bill", "b.jpg", "image/jpeg", new UserId(Reader), Now))
            .Should().BeTrue("a bill he took himself");
        visibility.MaySeeAttachment(Attachment.Create(Guid.NewGuid(), new FarmId(Farm), onP1.Id, "DailyLog", "a.jpg", "image/jpeg", new UserId(Owner), Now))
            .Should().BeFalse("a photo follows its record");
    }

    [Fact]
    public void A_split_bill_reaches_a_chosen_plots_seat_as_his_share_lines_only()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        var split = CostOn(Owner, null);
        var visibility = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = mine }, [], [split]);
        var ledger = new DayLedgerDto(Guid.NewGuid(), Farm, split.Id, new DateOnly(2026, 10, 30), "equal", Owner, Now, Now,
            [
                new DayLedgerAllocationDto(Guid.NewGuid(), P1, 3500.51m, "INR", Now),
                new DayLedgerAllocationDto(Guid.NewGuid(), P2, 2500.33m, "INR", Now),
            ]);

        visibility.MaySeeCost(split.Id).Should().BeFalse("never the whole bill");
        var share = visibility.Ledger(ledger);
        share!.Allocations.Select(a => a.PlotId).Should().Equal([P2]);
        visibility.Ledger(ledger with { Allocations = [ledger.Allocations[0]] }).Should().BeNull("no share of his");

        var every = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope(MembershipPlotScope.AllPlots) }, []);
        every.Ledger(ledger).Should().BeSameAs(ledger);
    }

    [Fact]
    public void A_record_spanning_plots_is_narrowed_to_his_plots_and_sent_without_its_money()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        using var doc = System.Text.Json.JsonDocument.Parse("""{"schema":1,"inputs":[{"id":"in-1","productName":"औषध","cost":1717.17}]}""");
        var dto = new DailyLogDto(
            Guid.NewGuid(), Farm, null, null, Owner, new DateOnly(2026, 10, 30), null, Now, Now, null, null, [], [],
            "MultiPlot", [P1, P2], Labour: [], Content: new LogContentDto(1, 1, doc.RootElement.Clone()));

        var seen = ReadScopeProjection.Record(dto, mine, Reader);
        seen.PlotIds.Should().Equal([P2]);
        seen.Content!.Document.GetRawText().Should().NotContain("1717.17", "the whole record's amount, across a plot not his");
        seen.Content.AmountsWithheld.Should().BeTrue();

        ReadScopeProjection.Record(dto, mine, Owner).Should().BeSameAs(dto, "the maker's own record comes back whole");
        ReadScopeProjection.Record(dto, Scope(MembershipPlotScope.AllPlots), Reader).PlotIds.Should().Equal([P1, P2]);
    }
}
