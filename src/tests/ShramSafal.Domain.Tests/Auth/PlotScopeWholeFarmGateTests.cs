// spec: plr-d10 SEC-1 server fixes (D-184), finding F03 (server half) - a seat limited to chosen plots cannot write a
// record that belongs to the WHOLE farm. The truth table of the one new question the plot gate answers, and the proof that
// the old question (RefuseAsync) still answers exactly what its ~20 callers rely on.
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

/// <summary>
/// SEC-1 F03 (server half). <c>PlotScopeGate.RefuseWholeFarmAsync</c> asks "may this seat write something that belongs to the
/// whole farm?": a seat on CHOSEN plots may not (<c>ShramSafal.PlotScope.Forbidden</c>, the code the phone already parks
/// visibly); the primary owner, the registrant, a seat on every plot, an own-work seat and a person with no seat are not
/// refused by it (the handler's own membership rule still answers the last).
///
/// <para>The old question, <c>PlotScopeGate.RefuseAsync</c>, is deliberately NOT changed: a record that names no plot is
/// answered <c>null</c> (not refused) for about 20 callers - a shared or unallocated bill, a "plot not fixed" reminder, a
/// farm-level warning legitimately have no plot. The second half of this class pins that.</para>
///
/// <para>Written from the SEC-1 test spec (F03) alone; the gate's source was not read, only the shape of its two public
/// questions.</para>
/// </summary>
public sealed class PlotScopeWholeFarmGateTests
{
    private const string ForbiddenCode = "ShramSafal.PlotScope.Forbidden";

    private static readonly Guid Farm = Guid.Parse("5ec10003-0000-4000-8000-0000000000f1");
    private static readonly Guid Person = Guid.Parse("5ec10003-0000-4000-8000-000000000011");
    private static readonly Guid HisPlot = Guid.Parse("5ec10003-0000-4000-8000-0000000000a1");
    private static readonly Guid HisOtherPlot = Guid.Parse("5ec10003-0000-4000-8000-0000000000a2");
    private static readonly Guid NotHisPlot = Guid.Parse("5ec10003-0000-4000-8000-0000000000a3");
    private static readonly DateTime Now = new(2026, 11, 22, 6, 0, 0, DateTimeKind.Utc);

    private static FarmAccess Seat(
        AppRole role,
        MembershipPlotScope scope = MembershipPlotScope.AllPlots,
        IReadOnlyCollection<Guid>? chosen = null,
        MembershipStatus status = MembershipStatus.Active,
        bool registrant = false) =>
        new(role, status, registrant, StoredPermissions: null, PlotScope: scope, ScopePlotIds: chosen);

    // ── The new question: the whole farm ─────────────────────────────────────────────────

    [Fact]
    public async Task A_seat_on_chosen_plots_is_refused_the_whole_farm_with_the_plot_scope_code()
    {
        var repo = new GateRepo(Seat(AppRole.Mukadam, MembershipPlotScope.ChosenPlots, [HisPlot]));

        var refusal = await PlotScopeGate.RefuseWholeFarmAsync(repo, Farm, Person, Now);

        refusal.Should().NotBeNull();
        refusal!.Code.Should().Be(ForbiddenCode, "the phone already parks this code visibly; a new code would strand old phones");
        refusal.Should().Be(ShramSafalErrors.PlotScopeForbidden);
    }

    [Fact]
    public async Task A_seat_on_several_chosen_plots_is_refused_the_whole_farm_too()
    {
        var repo = new GateRepo(Seat(AppRole.Worker, MembershipPlotScope.ChosenPlots, [HisPlot, HisOtherPlot]));

        (await PlotScopeGate.RefuseWholeFarmAsync(repo, Farm, Person, Now))!.Code.Should().Be(ForbiddenCode);
    }

    [Fact]
    public async Task A_seat_on_chosen_plots_is_refused_the_whole_farm_whatever_his_label()
    {
        foreach (var role in new[] { AppRole.Mukadam, AppRole.Worker, AppRole.SecondaryOwner })
        {
            var repo = new GateRepo(Seat(role, MembershipPlotScope.ChosenPlots, [HisPlot]));

            (await PlotScopeGate.RefuseWholeFarmAsync(repo, Farm, Person, Now))
                .Should().NotBeNull($"a {role} on chosen plots is limited to those plots, not the whole farm");
        }
    }

    public static TheoryData<string, FarmAccess?> NotRefusedRows() => new()
    {
        { "the primary owner (label PrimaryOwner)", Seat(AppRole.PrimaryOwner) },
        { "the farm's registrant, whatever his seat says", Seat(AppRole.Worker, registrant: true) },
        { "a seat on every plot (a सहमालक)", Seat(AppRole.SecondaryOwner) },
        { "a seat on every plot (a मुकादम)", Seat(AppRole.Mukadam) },
        { "a seat on every plot (a कामगार)", Seat(AppRole.Worker) },
        { "an own-work seat", Seat(AppRole.Mukadam, MembershipPlotScope.OwnWork) },
        { "an own-work seat (a कामगार)", Seat(AppRole.Worker, MembershipPlotScope.OwnWork) },
        { "no seat at all (the handler's own membership rule answers him)", null },
    };

    [Theory]
    [MemberData(nameof(NotRefusedRows))]
    public async Task Every_other_seat_is_not_refused_the_whole_farm(string who, FarmAccess? access)
    {
        var repo = new GateRepo(access);

        (await PlotScopeGate.RefuseWholeFarmAsync(repo, Farm, Person, Now)).Should().BeNull(who);
    }

    [Fact]
    public async Task The_whole_farm_question_for_a_chosen_plots_seat_is_about_the_person_and_the_farm_not_a_plot()
    {
        // A different farm, or a different person, is not the seat this repo knows: no seat there, so no refusal here.
        var repo = new GateRepo(Seat(AppRole.Mukadam, MembershipPlotScope.ChosenPlots, [HisPlot]));

        (await PlotScopeGate.RefuseWholeFarmAsync(repo, Guid.NewGuid(), Person, Now)).Should().BeNull("not his farm");
        (await PlotScopeGate.RefuseWholeFarmAsync(repo, Farm, Guid.NewGuid(), Now)).Should().BeNull("not him");
    }

    // ── The old question is unchanged: RefuseAsync ───────────────────────────────────────

    [Fact]
    public async Task RefuseAsync_with_no_plot_named_is_still_null_even_for_a_chosen_plots_seat()
    {
        // The ~20 callers (shared bills, "plot not fixed" reminders, farm-level signals) rely on this. It must not turn into
        // the whole-farm refusal.
        var repo = new GateRepo(Seat(AppRole.Mukadam, MembershipPlotScope.ChosenPlots, [HisPlot]));

        (await PlotScopeGate.RefuseAsync(repo, Farm, Array.Empty<Guid?>(), Person, Now)).Should().BeNull("an empty list names no plot");
        (await PlotScopeGate.RefuseAsync(repo, Farm, new Guid?[] { null }, Person, Now)).Should().BeNull("a null plot names no plot");
        (await PlotScopeGate.RefuseAsync(repo, Farm, new Guid?[] { Guid.Empty }, Person, Now)).Should().BeNull("an empty id names no plot");
        (await PlotScopeGate.RefuseAsync(repo, Farm, (Guid?)null, Person, Now)).Should().BeNull("a single unnamed plot is no plot");
    }

    [Fact]
    public async Task RefuseAsync_still_judges_a_plot_that_is_named()
    {
        var repo = new GateRepo(Seat(AppRole.Mukadam, MembershipPlotScope.ChosenPlots, [HisPlot, HisOtherPlot]));

        (await PlotScopeGate.RefuseAsync(repo, Farm, HisPlot, Person, Now)).Should().BeNull("his own plot");
        (await PlotScopeGate.RefuseAsync(repo, Farm, new Guid?[] { HisPlot, HisOtherPlot }, Person, Now)).Should().BeNull("both his plots");
        (await PlotScopeGate.RefuseAsync(repo, Farm, NotHisPlot, Person, Now))!.Code.Should().Be(ForbiddenCode);
        (await PlotScopeGate.RefuseAsync(repo, Farm, new Guid?[] { HisPlot, NotHisPlot }, Person, Now))!.Code
            .Should().Be(ForbiddenCode, "one plot of his and one that is not: refused");
    }

    [Fact]
    public async Task RefuseAsync_never_refuses_a_seat_that_covers_every_plot()
    {
        var repo = new GateRepo(Seat(AppRole.Mukadam));

        (await PlotScopeGate.RefuseAsync(repo, Farm, NotHisPlot, Person, Now)).Should().BeNull();
        (await PlotScopeGate.RefuseAsync(repo, Farm, Array.Empty<Guid?>(), Person, Now)).Should().BeNull();
    }

    /// <summary>One person's seat on one farm. The by-place pre-filter reports the farm as maybe-read-by-place, so the gate
    /// reads the seat itself - the answer then rests on the seat's own plot scope, never on the pre-filter.</summary>
    private sealed class GateRepo(FarmAccess? access) : Work.Handlers.StubShramSafalRepository, IShramSafalRepository
    {
        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(farmId == Farm && userId == Person ? access : null);

        public Task<IReadOnlyList<Guid>> GetFarmsMaybeReadByPlaceAsync(
            Guid userId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<Guid>>(farmIds.ToList());
    }
}
