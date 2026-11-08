// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 2)
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Dfes.GetPlotDayUnderstanding;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The per-plot understanding read (<c>GET /shramsafal/day-understanding/plots</c>): each plot's /10, what was understood and the
/// one thing still missing, derived on read from that plot's OWN records with the same engine rules as the farm day. A plot with no
/// record that day has no score (null, never 0); a farm-level record counts for no plot; another farm is forbidden.
/// </summary>
public sealed class GetPlotDayUnderstandingHandlerTests
{
    // ── the five named in the plan ───────────────────────────────────────────

    [Fact]
    public async Task PlotWithNoLogThatDay_ScoreNull_NoHint()
    {
        var repo = Repo();
        repo.AddLog(SprayLog(Day, PlotA), Document(FoundName)); // plot A has a record; plot B has none

        var rows = await Read(repo);

        var b = rows.Single(r => r.PlotId == PlotB);
        b.Score0To10.Should().BeNull("a plot with no record that day has no score - never a zero");
        b.NextHint.Should().BeNull();
        b.Understood.Should().BeEmpty();
        rows.Single(r => r.PlotId == PlotA).Score0To10.Should().NotBeNull();
    }

    [Fact]
    public async Task PlotWithSprayConfirmed_ScoreFromItsOwnLogsOnly()
    {
        // Plot A: a spray whose product the checker confirmed. Plot B: a bare spray. Neither reads the other's records.
        var repo = Repo();
        var a = repo.AddLog(SprayLog(Day, PlotA), Document(FoundName));
        repo.Answers.Add(Answer(a, IdentityVerdict.Confirmed, Checker, isCheck: true));
        repo.AddLog(SprayLog(Day, PlotB), Document(UnknownName));

        var both = await Read(repo);

        // Alone, plot A's record scores exactly what it scores next to plot B's.
        var aloneRepo = Repo();
        var aloneLog = aloneRepo.AddLog(SprayLog(Day, PlotA), Document(FoundName));
        aloneRepo.Answers.Add(Answer(aloneLog, IdentityVerdict.Confirmed, Checker, isCheck: true));
        var alone = await Read(aloneRepo);

        both.Single(r => r.PlotId == PlotA).Score0To10.Should().Be(alone.Single(r => r.PlotId == PlotA).Score0To10);
        both.Single(r => r.PlotId == PlotA).Score0To10.Should().BeGreaterThan(both.Single(r => r.PlotId == PlotB).Score0To10!.Value,
            "the confirmed product is plot A's alone");
        both.Single(r => r.PlotId == PlotA).Understood.Should().Contain(PlotUnderstandingWords.Understood("PRODUCT_ID")!,
            "a product the checker confirmed is fully understood");
        both.Single(r => r.PlotId == PlotB).Understood.Should().NotContain(PlotUnderstandingWords.Understood("PRODUCT_ID")!);
    }

    [Fact]
    public async Task FarmLevelLog_CountsForNoPlot()
    {
        // A farm-wide record names no plot: it is not split across plots (no invented split), so it scores for none.
        var repo = Repo();
        var farmLevel = DailyLog.CreateForFarm(
            Guid.NewGuid(), new FarmId(TheFarm), new UserId(Speaker), Day, null, null, NoonOn(Day));
        farmLevel.AddTask(Guid.NewGuid(), "Spraying", null, NoonOn(Day), executionStatus: ExecutionStatus.Completed);
        repo.AddLog(farmLevel, Document(FoundName));

        var rows = await Read(repo);

        rows.Should().OnlyContain(r => r.Score0To10 == null && r.NextHint == null && r.Understood.Count == 0,
            "a farm-level record counts for no plot");
        rows.Select(r => r.PlotId).Should().BeEquivalentTo(new[] { PlotA, PlotB });
    }

    [Fact]
    public async Task Hint_IsTheHighestWeightUnearnedPart()
    {
        // A bare spraying day: the unearned parts are dose (20), the observation (15), cost (12), carrier (10), the product (10),
        // weather (8). The hint is the heaviest: how much was used.
        var spray = Repo();
        spray.AddLog(SprayLog(Day, PlotA), null);
        var sprayHint = (await Read(spray)).Single(r => r.PlotId == PlotA).NextHint;

        sprayHint.Should().Be(PlotUnderstandingWords.Hint("DOSE"));

        // A day of pruning owes no dose or carrier; the heaviest unearned part is the observation (15) before the cost (12).
        var pruning = Repo();
        var log = DailyLog.Create(Guid.NewGuid(), new FarmId(TheFarm), PlotA, Cycle, new UserId(Speaker), Day, null, null, NoonOn(Day));
        log.AddTask(Guid.NewGuid(), "Pruning", null, NoonOn(Day), executionStatus: ExecutionStatus.Completed);
        pruning.AddLog(log, null);
        var pruningRow = (await Read(pruning)).Single(r => r.PlotId == PlotA);

        pruningRow.NextHint.Should().Be(PlotUnderstandingWords.Hint("OBS_FACET"));
        pruningRow.Understood.Should().Contain(PlotUnderstandingWords.Understood("WHAT")!);
    }

    [Fact]
    public async Task OtherFarm_Forbidden()
    {
        var repo = Repo();
        var handler = Handler(repo);

        var stranger = await handler.HandleAsync(new GetPlotDayUnderstandingQuery(TheFarm, Day, Stranger));
        var otherFarm = await handler.HandleAsync(new GetPlotDayUnderstandingQuery(OtherFarm, Day, Owner));
        var empty = await handler.HandleAsync(new GetPlotDayUnderstandingQuery(Guid.Empty, Day, Owner));

        stranger.IsFailure.Should().BeTrue();
        stranger.Error.Should().Be(ShramSafalErrors.Forbidden);
        otherFarm.Error.Should().Be(ShramSafalErrors.Forbidden, "a member of farm A cannot read farm B");
        empty.Error.Should().Be(ShramSafalErrors.InvalidCommand);
    }

    // ── the rest of the contract ─────────────────────────────────────────────

    [Fact]
    public async Task AnotherPlotsAnswer_NeverReachesThisPlot()
    {
        var repo = Repo();
        var a = repo.AddLog(SprayLog(Day, PlotA), Document(FoundName));
        var b = repo.AddLog(SprayLog(Day, PlotB), Document(FoundName));
        repo.Answers.Add(Answer(b, IdentityVerdict.Confirmed, Checker, isCheck: true));

        var rows = await Read(repo);

        a.Should().NotBeNull();
        rows.Single(r => r.PlotId == PlotA).Understood.Should().NotContain(PlotUnderstandingWords.Understood("PRODUCT_ID")!);
        rows.Single(r => r.PlotId == PlotB).Understood.Should().Contain(PlotUnderstandingWords.Understood("PRODUCT_ID")!);
    }

    [Fact]
    public async Task AFrozenDay_IsReadOnItsOwnEnginesRules()
    {
        // The farm day was scored under dfes-4: no product part. The plot read follows the day's stored engine, so it matches.
        var repo = Repo();
        repo.AddLog(SprayLog(Day, PlotA), Document(FoundName));
        var frozen = DailyRichnessAggregate.Create(Guid.NewGuid(), TheFarm, Day, "Asia/Kolkata", NoonOn(Day));
        frozen.ApplyDerivation(null, null, null, DayClassification.BasicWorkDay, default, false, false, 0, "{}", null, "dfes-4", "{}");
        repo.Aggregates.Add(frozen);

        var row = (await Read(repo)).Single(r => r.PlotId == PlotA);

        row.Understood.Should().NotContain(PlotUnderstandingWords.Understood("PRODUCT_ID")!);
        row.NextHint.Should().NotBe(PlotUnderstandingWords.Hint("PRODUCT_ID"));
    }

    [Fact]
    public async Task TheWire_CarriesTheScoreUnderItsPlannedName_AndNothingInternal()
    {
        var repo = Repo();
        repo.AddLog(SprayLog(Day, PlotA), Document(FoundName));
        var row = (await Read(repo)).Single(r => r.PlotId == PlotA);

        var json = JsonSerializer.Serialize(row, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        using var doc = JsonDocument.Parse(json);
        var names = doc.RootElement.EnumerateObject().Select(p => p.Name).ToList();

        names.Should().BeEquivalentTo("plotId", "score0to10", "understood", "nextHint");
        doc.RootElement.GetProperty("understood")[0].EnumerateObject().Select(p => p.Name).Should().BeEquivalentTo("mr", "en");
    }

    [Fact]
    public void TheWords_AreFixedAndPlain()
    {
        foreach (var part in PlotUnderstandingWords.Dimensions)
        {
            foreach (var line in new[] { PlotUnderstandingWords.Understood(part)!, PlotUnderstandingWords.Hint(part)! })
            {
                line.Mr.Should().NotMatchRegex("[A-Za-z]", "Marathi mode shows Marathi only");
                line.En.Should().NotMatchRegex("[ऀ-ॿ]", "English mode shows English only");
                (line.Mr + line.En).Should().NotMatchRegex("[0-9०-९]", "no number crosses");
                (line.Mr + line.En).Should().NotContain("AI").And.NotContain("एआय");
                (line.Mr + line.En).Should().NotContain("तुम्ही").And.NotContain("मार्गदर्शिका");
                (line.Mr + line.En).ToCharArray().Should().OnlyContain(c => !char.IsSurrogate(c) && c < 0x2190 || c >= 0x2200);
            }
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static ProductRepo Repo()
    {
        var repo = new ProductRepo();
        repo.Roles[Owner] = AppRole.PrimaryOwner;
        repo.Plots.Add(Plot.Create(PlotA, new FarmId(TheFarm), "A", 1m, NoonOn(Day)));
        repo.Plots.Add(Plot.Create(PlotB, new FarmId(TheFarm), "B", 1m, NoonOn(Day)));
        return repo;
    }

    private static GetPlotDayUnderstandingHandler Handler(ProductRepo repo) => new(repo, new NoJobs(), new ClockAt(NoonOn(Day).AddDays(1)));

    private static async Task<IReadOnlyList<PlotDayUnderstandingDto>> Read(ProductRepo repo)
    {
        var result = await Handler(repo).HandleAsync(new GetPlotDayUnderstandingQuery(TheFarm, Day, Owner));
        result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : "");
        return result.Value!;
    }
}
