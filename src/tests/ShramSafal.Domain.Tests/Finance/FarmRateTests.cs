// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
// The farm's own rate list without a database: a version states a whole rate (an input names its unit, work its basis),
// the server numbers versions, a stop is a version, money is kept as the repo keeps it, and the ONE gate (FarmRateGate):
// write = the primary account holder; read = input prices with see money, work rates with see wages too.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using Xunit;

namespace ShramSafal.Domain.Tests.Finance;

public sealed class FarmRateTests
{
    private static readonly FarmId Farm = new(Guid.Parse("10000000-0000-0000-0000-0000000000f1"));
    private static readonly UserId Owner = new(Guid.Parse("20000000-0000-0000-0000-0000000000a1"));
    private static readonly Guid Line = Guid.Parse("30000000-0000-0000-0000-000000000001");
    private static readonly DateTime Now = new(2026, 11, 6, 6, 0, 0, 500, DateTimeKind.Utc);

    private static AgriSync.BuildingBlocks.Results.Result<FarmRate> Make(
        FarmRateKind kind = FarmRateKind.Input,
        FarmRateBasis basis = FarmRateBasis.PerUnit,
        string? unit = "पोते",
        string? category = null,
        decimal amount = 1350.555m,
        string? item = " युरिया ",
        DateOnly? endsOn = null,
        int version = 1,
        DateTime? at = null) =>
        FarmRate.Create(Guid.NewGuid(), Farm, Line, version, kind, item, unit, basis, category, amount, "inr",
            new DateOnly(2026, 11, 1), "खरीप", endsOn, retired: false, suggestionId: null, Owner, at ?? Now, "req-1", "1.0.18");

    [Fact]
    public void An_input_price_is_kept_whole_with_money_as_the_repo_keeps_it()
    {
        var rate = Make().Value;
        Assert.Equal("युरिया", rate.ItemName);
        Assert.Equal(1350.56m, rate.Amount); // two places, away from zero — the CostEntry / PriceConfig convention
        Assert.Equal("INR", rate.CurrencyCode);
        Assert.Equal("पोते", rate.Unit);
        Assert.Equal(FarmRateBasis.PerUnit, rate.Basis);
        Assert.False(rate.Retired);
    }

    [Fact]
    public void An_input_names_its_unit_and_work_names_a_basis_and_no_unit()
    {
        Assert.False(Make(unit: null).IsSuccess);
        Assert.False(Make(basis: FarmRateBasis.PerDay).IsSuccess);
        Assert.False(Make(category: "टोळी").IsSuccess);
        Assert.True(Make(FarmRateKind.Work, FarmRateBasis.PerAcre, unit: null, category: "टोळी").IsSuccess);
        Assert.False(Make(FarmRateKind.Work, FarmRateBasis.PerUnit, unit: null).IsSuccess);
        Assert.False(Make(FarmRateKind.Work, FarmRateBasis.PerDay, unit: "दिवस").IsSuccess);
    }

    [Fact]
    public void A_rate_without_what_it_is_for_a_positive_amount_or_sane_dates_is_refused_never_stored_as_zero()
    {
        foreach (var refused in new[]
                 {
                     Make(item: "  "), Make(amount: 0m), Make(amount: -1m), Make(amount: FarmRate.MaxAmount + 1m),
                     Make(endsOn: new DateOnly(2026, 10, 31)), Make(version: 0),
                 })
        {
            Assert.False(refused.IsSuccess);
            Assert.Equal(FarmRateErrors.Invalid.Code, refused.Error.Code);
        }
    }

    [Fact]
    public void A_stop_is_the_next_version_of_the_same_rate_who_and_when_its_own()
    {
        var first = Make().Value;
        var by = new UserId(Guid.Parse("20000000-0000-0000-0000-0000000000a2"));
        var stopped = first.RetiredVersion(Guid.NewGuid(), by, Now.AddDays(1), "req-2", "1.0.18").Value;
        Assert.Equal(2, stopped.Version);
        Assert.Equal(first.RateLineId, stopped.RateLineId);
        Assert.True(stopped.Retired);
        Assert.Equal(first.Amount, stopped.Amount);
        Assert.Equal(by, stopped.CreatedByUserId);
        Assert.False(stopped.StatesTheSameAs(first));
        Assert.True(Make().Value.StatesTheSameAs(first), "the same rate again states nothing new");
    }

    [Fact]
    public void Its_time_is_kept_to_the_microsecond_and_never_exactly_on_a_whole_second()
    {
        var onTheSecond = Make(at: new DateTime(2026, 11, 6, 6, 0, 0, DateTimeKind.Utc)).Value;
        Assert.NotEqual(0, onTheSecond.CreatedAtUtc.Ticks % TimeSpan.TicksPerSecond);
        Assert.Equal(0, onTheSecond.CreatedAtUtc.Ticks % 10);
    }

    // ── FarmRateGate.MayReadRate — the pull's and REST's one read rule ──────────────────────────────────

    private static FarmReadScope Scope(FarmAccess access) => FarmReadScope.Of(Farm.Value, access, Now)!;

    private static FarmAccess Seat(AppRole role, FarmPermission? bits) =>
        new(role, MembershipStatus.Active, IsRegistrant: false, bits);

    [Fact]
    public void Input_prices_need_see_money_and_work_rates_also_need_see_wages()
    {
        var registrant = Scope(new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null));
        var money = Scope(Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney));
        var wages = Scope(Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney | FarmPermission.SeeWages));
        var neither = Scope(Seat(AppRole.Mukadam, FarmPermission.None));

        Assert.True(FarmRateGate.MayReadRate(registrant, FarmRateKind.Input));
        Assert.True(FarmRateGate.MayReadRate(registrant, FarmRateKind.Work));
        Assert.True(FarmRateGate.MayReadRate(money, FarmRateKind.Input));
        Assert.False(FarmRateGate.MayReadRate(money, FarmRateKind.Work));
        Assert.True(FarmRateGate.MayReadRate(wages, FarmRateKind.Work));
        Assert.False(FarmRateGate.MayReadRate(neither, FarmRateKind.Input));
        Assert.False(FarmRateGate.MayReadRate(neither, FarmRateKind.Work));
        Assert.False(FarmRateGate.MayReadRate(null, FarmRateKind.Input));
        Assert.False(FarmRateGate.MayReadAnyRate(neither));
    }

    [Fact]
    public void A_chosen_plots_seat_reads_the_farms_rates_by_its_money_rights_alone()
    {
        // Orchestrator ruling (reversible): a rate belongs to the farm, not a plot — MU-4 plots do not narrow it.
        var plotted = Scope(new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false,
            FarmPermission.SeeMoney, PlotScope: MembershipPlotScope.ChosenPlots, ScopePlotIds: [Guid.NewGuid()]));
        Assert.True(FarmRateGate.MayReadRate(plotted, FarmRateKind.Input));
        Assert.False(FarmRateGate.MayReadRate(plotted, FarmRateKind.Work));
    }

    [Fact]
    public void An_own_records_seat_reads_no_rate_even_with_see_money_and_see_wages()
    {
        // Fix round 1 (review F1; CTO ruling): a कामगार by label, or any seat on स्वतःचं काम, reads only its own records;
        // the permission card says see money / see wages are "लागू नाही" for it, so the farm's rates are not its to read.
        var both = FarmPermission.SeeMoney | FarmPermission.SeeWages;
        var worker = Scope(Seat(AppRole.Worker, both));
        var ownWork = Scope(new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false, both,
            PlotScope: MembershipPlotScope.OwnWork));
        foreach (var scope in new[] { worker, ownWork })
        {
            Assert.True(scope.OwnRecordsOnly);
            Assert.False(FarmRateGate.MayReadRate(scope, FarmRateKind.Input));
            Assert.False(FarmRateGate.MayReadRate(scope, FarmRateKind.Work));
            Assert.False(FarmRateGate.MayReadAnyRate(scope));
        }
    }
}
