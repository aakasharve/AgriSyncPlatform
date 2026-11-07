// spec: plr-d10-redesign-real-integration-2026-10-25, lane MU-1 (founder D-70 option 2, register F124) — a person who covers
// only SOME plots sees NO day wages at all: not a labour line's wage per person, not its crew total, not the words that
// name them, not the labour page's day-wage figure, not a worker's earnings. He still sees job-card (उक्ते काम) money and
// the other money of his plots. This reverses MU-4's D-70 CTO call (day wages of the whole farm, labelled as such). The
// owner and a seat that covers every plot (or only his own work) are unchanged. Enumerated without a database.
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class DayWagesChosenPlotsTests
{
    private static readonly DateTime Now = new(2026, 11, 7, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("4d100000-0000-4000-8000-0000000000f1");
    private static readonly Guid Reader = Guid.Parse("4d100000-0000-4000-8000-000000000001");
    private static readonly Guid Maker = Guid.Parse("4d100000-0000-4000-8000-000000000002");
    private static readonly Guid P2 = Guid.Parse("4d100000-0000-4000-8000-0000000000a2");

    private const FarmPermission MoneyAndWages = FarmPermission.SeeMoney | FarmPermission.SeeWages;

    private static FarmReadScope Scope(MembershipPlotScope scope, FarmPermission bits = MoneyAndWages) =>
        FarmReadScope.Of(
            Farm,
            new FarmAccess(AppRole.Mukadam, MembershipStatus.Active, IsRegistrant: false, bits,
                PlotScope: scope, ScopePlotIds: scope == MembershipPlotScope.ChosenPlots ? [P2] : null),
            Now)!;

    private static FarmReadScope Owner() =>
        FarmReadScope.Of(Farm, new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null), Now)!;

    [Fact]
    public void Day_wages_are_seen_with_see_wages_unless_the_seat_covers_only_chosen_plots()
    {
        Assert.True(Owner().SeeDayWages);
        Assert.True(Scope(MembershipPlotScope.AllPlots).SeeDayWages);
        Assert.True(Scope(MembershipPlotScope.OwnWork).SeeDayWages, "his own work: only his own wages show, as before");

        var chosen = Scope(MembershipPlotScope.ChosenPlots);
        Assert.False(chosen.SeeDayWages);
        Assert.True(chosen.SeeWages, "job-card money (a worker's pay on his plots) still follows see wages");
        Assert.True(chosen.SeeMoney);

        Assert.False(Scope(MembershipPlotScope.AllPlots, FarmPermission.SeeMoney).SeeDayWages, "without see wages there are none either");
    }

    [Fact]
    public void A_labour_line_loses_its_wage_and_its_total_for_chosen_plots_and_says_it_was_held_back()
    {
        var dto = Record("""{"schema":1}""", wage: 400m, total: 3200m);

        var chosen = ReadScopeProjection.Record(dto, Scope(MembershipPlotScope.ChosenPlots), Reader).Labour![0];
        Assert.Null(chosen.WagePerPerson);
        Assert.True(chosen.WageWithheld);
        Assert.Null(chosen.TotalCost);
        Assert.True(chosen.TotalCostWithheld);

        foreach (var whole in new[] { Scope(MembershipPlotScope.AllPlots), Scope(MembershipPlotScope.OwnWork), Owner() })
        {
            var line = ReadScopeProjection.Record(dto, whole, Reader).Labour![0];
            Assert.Equal(400m, line.WagePerPerson);
            Assert.Equal(3200m, line.TotalCost);
            Assert.Null(line.WageWithheld);
        }
    }

    [Fact]
    public void The_words_of_a_record_that_names_money_are_not_heard_by_chosen_plots_because_a_day_wage_can_be_in_them()
    {
        var dto = Record("""{"schema":1,"fullTranscript":"आज ५ मजूर, प्रत्येकी ४०० रुपये"}""", wage: 400m, total: 2000m);

        var chosen = ReadScopeProjection.Record(dto, Scope(MembershipPlotScope.ChosenPlots), Reader);
        Assert.False(chosen.Content!.Document.TryGetProperty("fullTranscript", out _));
        Assert.True(chosen.WordsWithheldForMoney);

        var whole = ReadScopeProjection.Record(dto, Scope(MembershipPlotScope.AllPlots), Reader);
        Assert.True(whole.Content!.Document.TryGetProperty("fullTranscript", out _));
    }

    [Fact]
    public void His_own_record_always_comes_back_whole()
    {
        var dto = Record("""{"schema":1}""", wage: 400m, total: 3200m);
        var own = ReadScopeProjection.Record(dto, Scope(MembershipPlotScope.ChosenPlots), Maker).Labour![0];
        Assert.Equal(400m, own.WagePerPerson);
        Assert.Equal(3200m, own.TotalCost);
    }

    [Fact]
    public void A_job_cards_pay_stays_for_chosen_plots_who_see_wages_it_is_plot_work_not_a_day_wage()
    {
        var card = new JobCardDto(
            Guid.NewGuid(), Farm, Guid.NewGuid(), null, Maker, Guid.NewGuid(), "Ravi", new DateOnly(2026, 11, 6), "Completed",
            [new JobCardLineItemViewDto("Pruning", 2m, 150m, "INR", null)],
            300m, "INR", null, Guid.NewGuid(), null, Now, Now);

        var kept = ReadScopeProjection.JobCard(card, Scope(MembershipPlotScope.ChosenPlots), Reader);
        Assert.Equal(300m, kept.EstimatedTotalAmount);
        Assert.Equal(150m, kept.LineItems[0].RatePerHourAmount);
    }

    private static DailyLogDto Record(string content, decimal wage, decimal total)
    {
        using var doc = JsonDocument.Parse(content);
        var labour = new List<LabourEngagementDto>
        {
            new(Guid.NewGuid(), Guid.NewGuid(), "Hired", 8, null, null, wage, null, null, total, 8m, "Assumed",
                null, null, null, [], DateTime.UtcNow, null, []),
        };
        return new DailyLogDto(
            Guid.NewGuid(), Farm, null, null, Maker, new DateOnly(2026, 11, 6), null, DateTime.UtcNow, DateTime.UtcNow, null, null,
            [new LogTaskDto(Guid.NewGuid(), "Pruning", null, DateTime.UtcNow, "Completed", null, null)],
            [],
            "Farm", [],
            Labour: labour,
            Content: new LogContentDto(1, 1, doc.RootElement.Clone()));
    }
}
