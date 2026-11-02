// spec: plr-d10 lane MU-4 fix pass 1 (FIX-1.md) — the pure halves of the fix pass, without a database:
//   M5  his own money submission reaches him on any plot; his own WORK record on another plot still does not (§3 G2);
//   M2  a move to another place remembers where the record stood and is stamped past every cursor (a day-only move is not
//       a new place); "left his plots" is said only to a person whose plots it stood on, or who made it;
//   M4  a day-ledger row counts as "left out by rule" only when he would receive it by its place;
//   M7  the owner's card says what each seat EFFECTIVELY reads, which plot choices change something, and which held
//       responsibilities do nothing on that seat.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.RecordPrivacy;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class PlotScopeFixPass1RulesTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("4d100000-0000-4000-8000-0000000000f1");
    private static readonly Guid Reader = Guid.Parse("4d100000-0000-4000-8000-000000000001");
    private static readonly Guid Owner = Guid.Parse("4d100000-0000-4000-8000-000000000002");
    private static readonly Guid P1 = Guid.Parse("4d100000-0000-4000-8000-0000000000a1");
    private static readonly Guid P2 = Guid.Parse("4d100000-0000-4000-8000-0000000000a2");
    private static readonly Guid P3 = Guid.Parse("4d100000-0000-4000-8000-0000000000a3");
    private static readonly Guid CycleP2 = Guid.Parse("4d100000-0000-4000-8000-0000000000c2");

    private static FarmReadScope Scope(MembershipPlotScope scope, params Guid[] plots) =>
        FarmReadScope.Of(Farm, new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, FarmPermission.SeeMoney,
            PlotScope: scope, ScopePlotIds: plots), Now)!;

    private static RecordPlace LogOn(Guid maker, params Guid[] plots) =>
        RecordPlace.OfLog(Guid.NewGuid(), Farm, maker, new DateOnly(2026, 10, 30), Now,
            plots.Length == 0 ? DailyLogScope.Farm : plots.Length == 1 ? DailyLogScope.Plot : DailyLogScope.MultiPlot,
            plots.Length == 1 ? plots[0] : null, plots, null);

    private static RecordPlace CostOn(Guid maker, Guid? plot) =>
        RecordPlace.OfCost(Guid.NewGuid(), Farm, maker, new DateOnly(2026, 10, 30), Now, plot, null, null);

    // ── M5 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void M5_his_own_money_reaches_him_on_any_plot_but_his_own_work_record_on_another_plot_does_not()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        RecordPlaceRule.MaySee(mine, Reader, CostOn(Reader, P1)).Should().BeTrue("his own submission and its status, whatever its plot (D-28)");
        RecordPlaceRule.MaySee(mine, Reader, LogOn(Reader, P1)).Should().BeFalse("his own work on another plot is neither sent nor accepted (§3 G2)");
        RecordPlaceRule.MaySee(mine, Reader, CostOn(Owner, P1)).Should().BeFalse("other people's money on another plot");
    }

    // ── M2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void M2_a_record_left_his_plots_only_for_a_person_whose_plots_it_stood_on_or_who_made_it()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        var nowOnP1 = LogOn(Owner, P1);
        var hisOwnNowOnP1 = LogOn(Reader, P1);
        var onP2 = LogOn(Owner, P2);
        var visibility = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = mine }, [], [nowOnP1, hisOwnNowOnP1, onP2]);

        visibility.LeftHisPlaces(RecordKinds.DailyLog, nowOnP1.Id, Farm, Owner, [P2]).Should().BeTrue("it stood on his P2");
        visibility.LeftHisPlaces(RecordKinds.DailyLog, nowOnP1.Id, Farm, Owner, [P3]).Should().BeFalse("never on his plots: never hinted at");
        visibility.LeftHisPlaces(RecordKinds.DailyLog, nowOnP1.Id, Farm, Owner, []).Should().BeFalse("a whole-farm record not his");
        visibility.LeftHisPlaces(RecordKinds.DailyLog, hisOwnNowOnP1.Id, Farm, Reader, []).Should().BeTrue("his own, which he held");
        visibility.LeftHisPlaces(RecordKinds.DailyLog, onP2.Id, Farm, Owner, [P1]).Should().BeFalse("it is on his plots now");

        var every = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = Scope(MembershipPlotScope.AllPlots) }, []);
        every.LeftHisPlaces(RecordKinds.DailyLog, nowOnP1.Id, Farm, Owner, [P2]).Should().BeFalse("a seat on every plot loses nothing by place");
    }

    [Fact]
    public void M2_a_move_to_another_place_remembers_where_it_stood_and_is_stamped_past_every_cursor_a_day_move_is_not()
    {
        var created = new DateTime(2026, 10, 30, 5, 0, 0, DateTimeKind.Utc);
        var log = DailyLog.Create(Guid.NewGuid(), new FarmId(Farm), P1, Guid.NewGuid(), new UserId(Owner),
            new DateOnly(2026, 10, 30), null, null, created);

        log.MoveTo(DailyLogScope.Plot, [P1], P1, log.CropCycleId, new DateOnly(2026, 10, 29), created.AddHours(1));
        log.PlaceChangedAtUtc.Should().BeNull("a day-only move is not a new place");
        log.FormerPlotIds.Should().BeEmpty();

        var whole = new DateTime(2026, 10, 30, 7, 0, 0, DateTimeKind.Utc);
        log.MoveTo(DailyLogScope.Plot, [P2], P2, CycleP2, log.LogDate, whole);
        log.FormerPlotIds.Should().Equal([P1]);
        log.PlaceChangedAtUtc.Should().Be(log.ModifiedAtUtc);
        log.ModifiedAtUtc.Should().BeAfter(whole, "never exactly on a whole second (a cursor equal to it would pass it)");
        log.ModifiedAtUtc.Ticks.Should().NotBe(whole.Ticks);

        var before = log.ModifiedAtUtc;
        log.MoveTo(DailyLogScope.Farm, [], null, null, log.LogDate, created);
        log.ModifiedAtUtc.Should().BeAfter(before, "a move to another place always moves the clock forward");
        log.FormerPlotIds.Should().Equal([P1, P2], "every plot it stood on, a set that only grows");

        log.MoveTo(DailyLogScope.Plot, [P1], P1, Guid.NewGuid(), log.LogDate, created);
        log.FormerPlotIds.Should().Equal([P1, P2], "the whole farm names no plot; P1 is already there");
    }

    [Fact]
    public void M2_money_that_follows_its_record_to_another_plot_remembers_where_it_stood()
    {
        var entry = CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), P2, CycleP2, "fertilizer", "खत", 2222.41m, "INR",
            new DateOnly(2026, 10, 30), new UserId(Owner), null, Now);
        entry.FollowRecord(P2, CycleP2, new DateOnly(2026, 10, 29), Now.AddMinutes(1));
        entry.PlaceChangedAtUtc.Should().BeNull("the same plot, another day");

        entry.FollowRecord(P1, null, new DateOnly(2026, 10, 29), Now.AddMinutes(2));
        entry.FormerPlotIds.Should().Equal([P2]);
        entry.PlaceChangedAtUtc.Should().Be(entry.ModifiedAtUtc);
        entry.ModifiedAtUtc.Should().BeAfter(Now.AddMinutes(2));

        entry.FollowRecord(null, null, new DateOnly(2026, 10, 29), Now.AddMinutes(3));
        entry.FormerPlotIds.Should().Equal([P2, P1]);
    }

    // ── M4 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public void M4_a_day_ledger_row_is_in_his_place_only_when_it_has_a_share_on_his_plots_or_is_his()
    {
        var mine = Scope(MembershipPlotScope.ChosenPlots, P2);
        var visibility = RecordVisibility.For(Reader, new Dictionary<Guid, FarmReadScope> { [Farm] = mine }, [], []);
        DayLedgerDto Ledger(Guid maker, params Guid[] plots) => new(Guid.NewGuid(), Farm, Guid.NewGuid(), new DateOnly(2026, 10, 30), "equal",
            maker, Now, Now, plots.Select(p => new DayLedgerAllocationDto(Guid.NewGuid(), p, 10m, "INR", Now)).ToList());

        visibility.LedgerInPlace(Ledger(Owner, P1, P2)).Should().BeTrue("his share on P2");
        visibility.LedgerInPlace(Ledger(Owner, P1)).Should().BeFalse("another plot's bill: never counted, never hinted at");
        visibility.LedgerInPlace(Ledger(Reader, P1)).Should().BeTrue("his own bill");
    }

    // ── M7 ───────────────────────────────────────────────────────────────────────────────

    private static FarmMembership Seat(AppRole role, params FarmAuthority[] held)
    {
        var seat = FarmMembership.Create(Guid.NewGuid(), new FarmId(Farm), new UserId(Reader), role, Now.AddDays(-30), JoinedVia.OwnerManualAdd);
        seat.SetAuthorities(held.ToDictionary(a => a, _ => (DateTime?)null), Now.AddDays(-1));
        return seat;
    }

    [Fact]
    public void M7_the_card_says_farm_setup_is_not_in_force_without_every_plot()
    {
        var seat = Seat(AppRole.Mukadam, FarmAuthority.EditFarmSetup, FarmAuthority.SeeMoney);
        LabourPermissionProjection.From(seat, Now).AuthoritiesNotInForce.Should().BeEmpty("every plot: in force");

        seat.SetPlotScope(MembershipPlotScope.ChosenPlots, [P2], Now);
        var card = LabourPermissionProjection.From(seat, Now);
        card.AuthoritiesNotInForce.Should().Equal(["EditFarmSetup"]);
        card.Authorities!.Select(a => a.Name).Should().Contain("EditFarmSetup", "still stored: it travels back unchanged in the whole set");
        card.EffectivePlotScope.Should().Be("ChosenPlots");
        card.PlotScopeChoices.Should().Equal(["AllPlots", "ChosenPlots", "OwnWork"]);
    }

    [Fact]
    public void M7_a_kaamgar_reads_his_own_work_whatever_the_stored_scope_and_money_switches_are_not_in_force()
    {
        var card = LabourPermissionProjection.From(Seat(AppRole.Worker, FarmAuthority.SeeMoney, FarmAuthority.SeeWages), Now);
        card.PlotScope.Should().Be("AllPlots", "what is stored");
        card.EffectivePlotScope.Should().Be("OwnWork", "the label narrows to his own work");
        card.PlotScopeChoices.Should().Equal(["OwnWork", "ChosenPlots"], "every plot would read exactly as his own work");
        card.AuthoritiesNotInForce.Should().BeEquivalentTo(["SeeMoney", "SeeWages"], "only his own money, whatever he holds");

        var ownWork = Seat(AppRole.Mukadam, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        ownWork.SetPlotScope(MembershipPlotScope.OwnWork, null, Now);
        var ownCard = LabourPermissionProjection.From(ownWork, Now);
        ownCard.EffectivePlotScope.Should().Be("OwnWork");
        ownCard.AuthoritiesNotInForce.Should().BeEquivalentTo(["EditFarmSetup", "SeeMoney", "SeeWages"]);
        ownCard.PlotScopeChoices.Should().Equal(["AllPlots", "ChosenPlots", "OwnWork"], "a मुकादम label: every choice changes something");

        var owner = FarmMembership.Create(Guid.NewGuid(), new FarmId(Farm), new UserId(Owner), AppRole.PrimaryOwner, Now.AddDays(-30), JoinedVia.OwnerManualAdd);
        var ownerCard = LabourPermissionProjection.From(owner, Now, isRegistrant: true);
        ownerCard.AuthoritiesNotInForce.Should().BeEmpty();
        ownerCard.EffectivePlotScope.Should().Be("AllPlots");
    }
}
