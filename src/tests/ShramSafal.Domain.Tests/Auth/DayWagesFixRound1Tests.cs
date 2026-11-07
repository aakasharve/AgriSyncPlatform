// spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 fix round 1 (founder D-70 option 2, register F124; review
// HIGH-1 and MEDIUM-2) - the roads a day wage still took to a seat on chosen plots, enumerated without a database:
//   HIGH-1   a crew's total stored as a `labour_misc` money entry (DayWageMoney / FarmReadScope.DayWagesRuledOut);
//   MEDIUM-2 the voice parse behind GET /ai/jobs/{id}: a labour row's stated rate or wage per person counts as money.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.AI.GetAiJobStatus;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Tests.Common;
using System.Text.Json;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class DayWagesFixRound1Tests
{
    private static readonly DateTime Now = new(2026, 11, 7, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("4d200000-0000-4000-8000-0000000000f1");
    private static readonly Guid Reader = Guid.Parse("4d200000-0000-4000-8000-000000000001");
    private static readonly Guid Maker = Guid.Parse("4d200000-0000-4000-8000-000000000002");
    private static readonly Guid P2 = Guid.Parse("4d200000-0000-4000-8000-0000000000a2");

    private const FarmPermission MoneyAndWages = FarmPermission.SeeMoney | FarmPermission.SeeWages;

    private static FarmAccess Access(MembershipPlotScope scope, FarmPermission bits) =>
        new(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, bits,
            PlotScope: scope, ScopePlotIds: scope == MembershipPlotScope.ChosenPlots ? [P2] : null);

    private static FarmReadScope Scope(MembershipPlotScope scope, FarmPermission bits = MoneyAndWages) =>
        FarmReadScope.Of(Farm, Access(scope, bits), Now)!;

    private static FarmReadScope Owner() =>
        FarmReadScope.Of(Farm, new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null), Now)!;

    private static CostEntry Entry(string category, Guid by) =>
        category == "labour_payout"
            ? CostEntry.CreateLabourPayout(Guid.NewGuid(), Guid.NewGuid(), new FarmId(Farm), P2, null, 2000m, "INR",
                new DateOnly(2026, 11, 6), new UserId(by), Now)
            : CostEntry.Create(Guid.NewGuid(), new FarmId(Farm), P2, null, category, "x", 2000m, "INR",
                new DateOnly(2026, 11, 6), new UserId(by), null, Now);

    // ── HIGH-1 ───────────────────────────────────────────────────────────────────────────

    [Fact]
    public void Only_the_chosen_plots_seat_that_holds_see_wages_has_its_day_wages_ruled_out()
    {
        Assert.True(Scope(MembershipPlotScope.ChosenPlots).DayWagesRuledOut);
        Assert.False(Scope(MembershipPlotScope.AllPlots).DayWagesRuledOut);
        Assert.False(Scope(MembershipPlotScope.OwnWork).DayWagesRuledOut);
        Assert.False(Owner().DayWagesRuledOut);
        Assert.False(Scope(MembershipPlotScope.ChosenPlots, FarmPermission.SeeMoney).DayWagesRuledOut,
            "without see wages his crew totals follow MU-3's rule (a crew's total is money)");
    }

    [Fact]
    public void A_crews_labour_misc_money_entry_is_kept_from_the_chosen_plots_seat_and_nothing_else_is()
    {
        var chosen = Scope(MembershipPlotScope.ChosenPlots);
        var misc = Entry("labour_misc", Maker);

        Assert.True(DayWageMoney.HiddenFrom(chosen, misc, Reader), "the day wage as money");
        Assert.False(DayWageMoney.HiddenFrom(chosen, Entry("labour_payout", Maker), Reader), "job-card money stays");
        Assert.False(DayWageMoney.HiddenFrom(chosen, Entry("fertilizer", Maker), Reader), "other money of his plots stays");
        Assert.False(DayWageMoney.HiddenFrom(chosen, Entry("labour_misc", Reader), Reader), "his own submission is his own statement");

        foreach (var whole in new[] { Scope(MembershipPlotScope.AllPlots), Scope(MembershipPlotScope.OwnWork), Owner() })
        {
            Assert.False(DayWageMoney.HiddenFrom(whole, misc, Reader), "every other seat is unchanged");
        }

        Assert.False(DayWageMoney.HiddenFrom(null, misc, Reader));
    }

    // ── MEDIUM-2 ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("""{"labour":[{"count":5,"rate":400}]}""", true)]
    [InlineData("""{"labour":[{"count":5,"wagePerPerson":400}]}""", true)]
    [InlineData("""{"labour":[{"count":5,"totalCost":2000}]}""", true)]
    [InlineData("""{"labour":[{"count":5,"rate":null}]}""", false)]
    [InlineData("""{"labour":[{"count":5}]}""", false)]
    [InlineData("""{"irrigation":[{"rate":4}]}""", false)]
    [InlineData("""{"fullTranscript":"आज ५ मजूर"}""", false)]
    public void A_voice_parse_that_states_a_labour_wage_mentions_money_even_without_a_rupee_word(string json, bool expected)
    {
        using var doc = JsonDocument.Parse(json);
        Assert.Equal(expected, MoneyMention.InParse(doc.RootElement));
    }

    [Fact]
    public async Task A_wage_only_parse_is_withheld_from_a_chosen_plots_seat_that_confirms_records_but_not_from_an_every_plot_seat()
    {
        var job = AiJob.Create(Guid.NewGuid(), "key-d70", AiOperationType.VoiceToStructuredLog, Maker, Farm, null, null);
        typeof(AiJob).GetProperty(nameof(AiJob.NormalizedResultJson))!.SetValue(job, """{"labour":[{"count":5,"rate":400}]}""");
        var noWage = AiJob.Create(Guid.NewGuid(), "key-d70-b", AiOperationType.VoiceToStructuredLog, Maker, Farm, null, null);
        typeof(AiJob).GetProperty(nameof(AiJob.NormalizedResultJson))!.SetValue(noWage, """{"labour":[{"count":5}]}""");

        async Task<(object? Result, string? Withheld)> Read(AiJob which, FarmAccess access)
        {
            var handler = new GetAiJobStatusHandler(new Seats(access), new Jobs(which), new Clock());
            var result = await handler.HandleAsync(new GetAiJobStatusQuery(which.Id, Reader, IsAdmin: false));
            Assert.True(result.IsSuccess);
            return (result.Value!.Result, result.Value.ResultWithheld);
        }

        const FarmPermission Confirms = FarmPermission.ConfirmRecords | MoneyAndWages;
        var chosen = await Read(job, Access(MembershipPlotScope.ChosenPlots, Confirms));
        Assert.Null(chosen.Result);
        Assert.Equal(GetAiJobStatusHandler.ResultWithheldMoney, chosen.Withheld);

        var everyPlot = await Read(job, Access(MembershipPlotScope.AllPlots, Confirms));
        Assert.NotNull(everyPlot.Result);
        Assert.Null(everyPlot.Withheld);

        var plain = await Read(noWage, Access(MembershipPlotScope.ChosenPlots, Confirms));
        Assert.NotNull(plain.Result);
        Assert.Null(plain.Withheld);
    }

    private sealed class Clock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    private sealed class Jobs(AiJob job) : NullAiJobRepository
    {
        public override Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) =>
            Task.FromResult<AiJob?>(jobId == job.Id ? job : null);
    }

    private sealed class Seats(FarmAccess access) : Work.Handlers.StubShramSafalRepository
    {
        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(farmId == Farm ? access : null);
    }
}
