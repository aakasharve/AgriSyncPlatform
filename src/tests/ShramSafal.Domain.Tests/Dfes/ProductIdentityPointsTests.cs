// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 3; founder D-94)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The Shram points for product answers (D-94): +2 for a yes (हो) only when the library FOUND the product; +3 for a packet photo
/// kept for a found product (the photo's attachment row must exist); +2 for either given on a LATER day than the record's work
/// day, earned on the day it is given while the work day's points never change; one award per product, on the day of its first
/// counting answer; the daily cap stays 15. Points are worked out from the append-only answers only, at the one recompute every
/// path goes through.
/// </summary>
public sealed class ProductIdentityPointsTests
{
    private static readonly DateOnly NextDay = Day.AddDays(1);
    private static readonly Guid Photo = Guid.Parse("33000000-0000-4000-8000-0000000000b1");
    private static readonly int BasicDay = DfesTuning.Points.Basic;

    // ── through the real recompute ───────────────────────────────────────────

    [Fact]
    public async Task Points_ProductConfirmed_OnlyWhenFound()
    {
        // D-94: a yes on a product the library FOUND earns +2; a yes on an unknown or ambiguous name earns nothing.
        var found = await PointsOf(FoundName, log => Answer(log, IdentityVerdict.Confirmed, Speaker));
        var checkerYes = await PointsOf(FoundName, log => Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true));
        var unknown = await PointsOf(UnknownName, log => Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, productId: FoundId, spoken: UnknownName));
        var ambiguous = await PointsOf(AmbiguousName, log => Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, productId: "p-gibberellic-acid-40-wsg", spoken: AmbiguousName));
        var no = await PointsOf(FoundName, log => Answer(log, IdentityVerdict.Rejected, Checker, isCheck: true));
        var nothing = await PointsOf(FoundName, _ => null);

        found.Should().Be(BasicDay + DfesTuning.Points.ProductConfirmed);
        checkerYes.Should().Be(BasicDay + DfesTuning.Points.ProductConfirmed, "the speaker's yes and the checker's yes earn the same +2");
        unknown.Should().Be(BasicDay, "a yes on an unknown name earns nothing");
        ambiguous.Should().Be(BasicDay, "a yes on an ambiguous name earns nothing");
        no.Should().Be(BasicDay);
        nothing.Should().Be(BasicDay);
        DfesTuning.Points.ProductConfirmed.Should().Be(2);
    }

    [Fact]
    public async Task Points_PhotoMatch_Plus3()
    {
        var withRow = await PointsOf(FoundName, log => Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo), photoRow: true);
        var withNoRow = await PointsOf(FoundName, log => Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo), photoRow: false);
        var onUnknownName = await PointsOf(UnknownName, log => Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo, spoken: UnknownName), photoRow: true);

        withRow.Should().Be(BasicDay + DfesTuning.Points.EvidenceMatch);
        DfesTuning.Points.EvidenceMatch.Should().Be(3);
        withNoRow.Should().Be(BasicDay, "an attachment id with no row is a pointer, not a photo");
        onUnknownName.Should().Be(BasicDay, "only a product the library found earns points");
    }

    [Fact]
    public async Task Points_GapFilledLater_GoesToFillDay_OldDayUnchanged()
    {
        // A record of the work day; the day after, he fills the gap. The fill day (which has its own record) earns +2;
        // the work day's points are exactly what they were.
        var repo = new ProductRepo();
        var work = repo.AddLog(SprayLog(Day), Document(FoundName));
        repo.AddLog(SprayLog(NextDay), null);
        var service = Service(repo);

        await service.RecomputeAsync(TheFarm, Day);
        await service.RecomputeAsync(TheFarm, NextDay);
        var workBefore = RowOf(repo, Day).ShramPointsEarned;
        var fillBefore = RowOf(repo, NextDay).ShramPointsEarned;

        repo.Answers.Add(Answer(work, IdentityVerdict.Confirmed, Speaker, at: NoonOn(NextDay)));
        await service.RecomputeAsync(TheFarm, Day);
        await service.RecomputeAsync(TheFarm, NextDay);

        RowOf(repo, Day).ShramPointsEarned.Should().Be(workBefore, "old days' points never change");
        RowOf(repo, Day).RewardReasonsJson.Should().NotContain("gapFilledLater").And.NotContain("productConfirmed");
        RowOf(repo, NextDay).ShramPointsEarned.Should().Be(fillBefore + DfesTuning.Points.GapFilledLater, "the day he fills it earns +2");
        RowOf(repo, NextDay).RewardReasonsJson.Should().Contain("gapFilledLater:2");
        DfesTuning.Points.GapFilledLater.Should().Be(2);

        // Recomputing again changes nothing (the points are a pure function of the stored answers).
        await service.RecomputeAsync(TheFarm, Day);
        await service.RecomputeAsync(TheFarm, NextDay);
        RowOf(repo, Day).ShramPointsEarned.Should().Be(workBefore);
        RowOf(repo, NextDay).ShramPointsEarned.Should().Be(fillBefore + 2);
    }

    [Fact]
    public async Task Points_GapFilledLater_OnADayWithNoRecord_HasNoRowToCarryThem()
    {
        // The fill day has no record, so it has no farm-day row (an empty day keeps none): nothing is invented to hold points.
        var repo = new ProductRepo();
        var work = repo.AddLog(SprayLog(Day), Document(FoundName));
        var service = Service(repo);
        await service.RecomputeAsync(TheFarm, Day);
        repo.Answers.Add(Answer(work, IdentityVerdict.Confirmed, Speaker, at: NoonOn(NextDay)));

        await service.RecomputeAsync(TheFarm, Day);
        await service.RecomputeAsync(TheFarm, NextDay);

        repo.Aggregates.Should().ContainSingle(a => a.LocalDate == Day);
        RowOf(repo, Day).ShramPointsEarned.Should().Be(BasicDay);
    }

    [Fact]
    public async Task Points_CapStays15()
    {
        // Seven found products, each with a photo (+3): 5 + 21 would be 26.
        var names = new[] { "calcium nitrate", "Progibb", "Contof Plus", "magnesium sulphate", "dhaman bio 303", "score", "Karate" };
        var repo = new ProductRepo();
        var log = repo.AddLog(SprayLog(Day), Document(names));
        for (var i = 0; i < names.Length; i++)
        {
            var id = Guid.NewGuid();
            repo.Attachments[id] = PhotoRow(id);
            repo.Answers.Add(Answer(log, IdentityVerdict.Photo, Speaker, attachment: id, slot: i, spoken: names[i]));
        }

        await Service(repo).RecomputeAsync(TheFarm, Day);

        RowOf(repo, Day).ShramPointsEarned.Should().Be(DfesTuning.DailyPointCap);
        DfesTuning.DailyPointCap.Should().Be(15);
    }

    [Fact]
    public async Task Points_EachProductEarnsOnce_OnTheDayOfItsFirstCountingAnswer()
    {
        var repo = new ProductRepo();
        var log = repo.AddLog(SprayLog(Day), Document(FoundName));
        repo.AddLog(SprayLog(NextDay), null);
        // The speaker's yes on the work day, then the checker's yes the next day: one award, on the work day.
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Speaker, at: NoonOn(Day)));
        repo.Answers.Add(Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, at: NoonOn(NextDay)));
        var service = Service(repo);

        await service.RecomputeAsync(TheFarm, Day);
        await service.RecomputeAsync(TheFarm, NextDay);

        RowOf(repo, Day).ShramPointsEarned.Should().Be(BasicDay + 2);
        RowOf(repo, NextDay).ShramPointsEarned.Should().Be(BasicDay, "the product already earned on the work day");
    }

    [Fact]
    public async Task Points_AnAnswerNeverMovesTheStreakOrTheClassification()
    {
        var without = await Row(null);
        var with = await Row(log => Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true));

        with.AdvancesStreak.Should().Be(without.AdvancesStreak);
        with.AdvancesBar.Should().Be(without.AdvancesBar);
        with.DayClassification.Should().Be(without.DayClassification);

        static async Task<DailyRichnessAggregate> Row(Func<DailyLog, InputIdentityAssertion?>? answer)
        {
            var repo = new ProductRepo();
            var log = repo.AddLog(SprayLog(Day), Document(FoundName));
            if (answer?.Invoke(log) is { } row)
            {
                repo.Answers.Add(row);
            }

            await Service(repo).RecomputeAsync(TheFarm, Day);
            return RowOf(repo, Day);
        }
    }

    // ── the pure rule ────────────────────────────────────────────────────────

    [Fact]
    public void Points_AnAnswerOfAnotherFarm_IsNeverCounted()
    {
        var log = SprayLog(Day);
        var foreign = InputIdentityAssertion.Record(
            Guid.NewGuid(), new FarmId(OtherFarm), log.PlotId, log.Id, "e1", 0, FoundName, FoundId,
            IdentityVerdict.Confirmed, null, InputCatalog.Version, new UserId(Speaker), NoonOn(Day), "foreign-1");
        var record = new ProductRecord(log.Id, TheFarm, Day, ProductIdentity.ItemsOf(Document(FoundName)));

        ProductIdentityPoints.For(Day, [record], [foreign], _ => false).IsNone.Should().BeTrue();
    }

    [Fact]
    public void Points_Stamper_AddsTheReasonsAndNeverPassesTheCap()
    {
        var plain = Signals(structured: false, learning: false);
        var all = Signals(structured: true, learning: true, followup: true);

        var rich = RichnessStamper.Stamp(DayClassification.RichWorkDay, all, true, new IdentityPoints(1, 1, 1));
        var basic = RichnessStamper.Stamp(DayClassification.BasicWorkDay, plain, true, new IdentityPoints(1, 1, 1));
        var pending = RichnessStamper.Stamp(DayClassification.PendingReconciliation, plain, true, new IdentityPoints(3, 0, 0));
        var unchanged = RichnessStamper.Stamp(DayClassification.BasicWorkDay, plain, true, IdentityPoints.None);

        rich.ShramPointsEarned.Should().Be(15);
        basic.ShramPointsEarned.Should().Be(5 + 2 + 3 + 2);
        basic.RewardReasonsJson.Should().Contain("productConfirmed:2").And.Contain("evidenceMatch:3").And.Contain("gapFilledLater:2");
        pending.ShramPointsEarned.Should().Be(0, "a day whose date cannot be trusted earns nothing");
        unchanged.RewardReasonsJson.Should().NotContain("productConfirmed");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static ClassifierSignals Signals(bool structured, bool learning, bool followup = false) =>
        new(ClientDatePlausible: true, HasWork: true, IsSilent: false, HasMeaningfulObservation: structured, HasLearning: learning,
            HasExperimentOutcome: false, HasDisturbance: false, HasDeclaredNoWorkReason: false, NoWorkReasonCode: null,
            ExecutionScore: 100, InsightScore: 100, LearningScore: 100, HasStructuredObservation: structured, HasFollowup: followup);

    private static async Task<int> PointsOf(string spoken, Func<DailyLog, InputIdentityAssertion?> answer, bool photoRow = false)
    {
        var repo = new ProductRepo();
        var log = repo.AddLog(SprayLog(Day), Document(spoken));
        if (answer(log) is { } row)
        {
            repo.Answers.Add(row);
            if (photoRow && row.AttachmentId is { } photo)
            {
                repo.Attachments[photo] = PhotoRow(photo);
            }
        }

        await Service(repo).RecomputeAsync(TheFarm, Day);
        return RowOf(repo, Day).ShramPointsEarned;
    }

    private static DailyRichnessDerivationService Service(ProductRepo repo) =>
        new(repo, new NoJobs(), new SeqIds(), new ClockAt(NoonOn(Day).AddDays(2)));

    private static DailyRichnessAggregate RowOf(ProductRepo repo, DateOnly day) => repo.Aggregates.Single(a => a.LocalDate == day);
}
