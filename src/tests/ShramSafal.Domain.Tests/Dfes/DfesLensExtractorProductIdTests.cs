// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3, Task 1; founders D-93, D-94, D-95)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The roster part PRODUCT_ID (weight 10, engine <c>dfes-5</c>): did the app understand WHICH product he used. Coverage comes from
/// the products of the day's LATEST stored content, the library's match and the newest answers (never the parse job, doctrine P4):
/// found and nobody answered is half; his own yes is half (D-95); a photo is half and counts only when its attachment row exists
/// (D-93); only a checker's yes (a holder of the confirm-records authority who is not the record's speaker) is full; a no is
/// nothing; an ambiguous or unknown name with no answer is nothing.
/// </summary>
public sealed class DfesLensExtractorProductIdTests
{
    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    private const string PruningDay = """
    { "summary": "chatai keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "Pruning" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // The parse job names a product the stored content does NOT (and has no answer): it must earn nothing.
    private const string SprayDayWhereTheParseJobNamesAProduct = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [ { "productName": "calcium nitrate", "mix": [ { "productName": "calcium nitrate", "dose": 5 } ] } ],
      "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    private static readonly Guid Photo = Guid.Parse("33000000-0000-4000-8000-0000000000a1");

    private static readonly Func<Guid, bool> NoPhotoRows = _ => false;
    private static readonly Func<Guid, bool> PhotoRowExists = id => id == Photo;

    // ── the six named in the plan ────────────────────────────────────────────

    [Fact]
    public void ProductId_NoInputs_NotApplicable_ScoreUnchangedFromDfes4()
    {
        var newEngine = Build(PruningDay, products: [], scoredUnder: null);
        var dfes4 = Build(PruningDay, products: [], scoredUnder: "dfes-4");

        Part(newEngine).Applicable.Should().BeFalse("a day with no inputs owes no product identity");
        DayUnderstandingScore.From(newEngine).Should().Be(DayUnderstandingScore.From(dfes4),
            "a day with no inputs scores EXACTLY what the previous engine gave it");
        newEngine.Possible!.Where(d => d.Name != "PRODUCT_ID").Select(d => (d.Name, d.Weight, d.Applicable, d.Coverage))
            .Should().Equal(dfes4.Possible!.Select(d => (d.Name, d.Weight, d.Applicable, d.Coverage)),
                "every other part of the roster is untouched");
    }

    [Fact]
    public void ProductId_Found_HalfCredit()
    {
        var found = Judge(FoundName);

        found.Basis.Should().Be(ProductIdentityBasis.Found);
        Part(Build(SprayDay, [found])).Coverage.Should().Be(0.5, "the library found exactly one product and nobody answered");
        Part(Build(SprayDay, [found])).Weight.Should().Be(10);
    }

    [Theory]
    [InlineData(AmbiguousName)]
    [InlineData(UnknownName)]
    public void ProductId_Ambiguous_Zero(string spoken)
    {
        // An ambiguous name is never the first-listed product; an unknown one is never "found with half credit".
        var judged = Judge(spoken);

        judged.Match.State.Should().NotBe(MatchState.Found);
        judged.Coverage.Should().Be(0.0);
        Part(Build(SprayDay, [judged])).Coverage.Should().Be(0.0);
        Part(Build(SprayDay, [judged])).Applicable.Should().BeTrue("the day still owes it: the spray is there");
    }

    [Fact]
    public void ProductId_Confirmed_Full()
    {
        var log = SprayLog();
        var checkedYes = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true));

        checkedYes.Basis.Should().Be(ProductIdentityBasis.CheckedYes);
        Part(Build(SprayDay, [checkedYes])).Coverage.Should().Be(1.0, "a checker's yes is the one thing that counts as checked");
    }

    [Fact]
    public void ProductId_Photo_Half()
    {
        var log = SprayLog();
        var bySpeaker = JudgeWithPhotos(FoundName, log, PhotoRowExists, Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo));
        var byChecker = JudgeWithPhotos(FoundName, log, PhotoRowExists, Answer(log, IdentityVerdict.Photo, Checker, isCheck: true, attachment: Photo));
        var onAnUnknownName = JudgeWithPhotos(UnknownName, log, PhotoRowExists, Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo, spoken: UnknownName));

        bySpeaker.Coverage.Should().Be(0.5, "D-93: a photo is half, not full; nobody has read the label");
        byChecker.Coverage.Should().Be(0.5, "even a checker's photo is half");
        onAnUnknownName.Coverage.Should().Be(0.5, "a photo kept for a name the library does not know is still a photo");
        byChecker.Basis.Should().Be(ProductIdentityBasis.CheckedPhoto);
    }

    [Fact]
    public void ProductId_Rejected_Zero()
    {
        var log = SprayLog();
        var checkerNo = Judge(FoundName, log, Answer(log, IdentityVerdict.Rejected, Checker, isCheck: true));
        var speakerNo = Judge(FoundName, log, Answer(log, IdentityVerdict.Rejected, Speaker));

        checkerNo.Coverage.Should().Be(0.0, "the library found it, but the checker says it is not that product");
        speakerNo.Coverage.Should().Be(0.0, "and so does the speaker, about his own words");
        checkerNo.Basis.Should().Be(ProductIdentityBasis.Rejected);
    }

    // ── the half-credit rules (D-93, D-95) ───────────────────────────────────

    [Fact]
    public void ProductId_PhotoWithNoAttachmentRow_EarnsNothing()
    {
        // An attachment id the server has no row for is a pointer, not a photo.
        var log = SprayLog();
        var photoOnUnknownName = JudgeWithPhotos(UnknownName, log, NoPhotoRows, Answer(log, IdentityVerdict.Photo, Speaker, attachment: Photo, spoken: UnknownName));
        var photoOnFoundName = JudgeWithPhotos(FoundName, log, NoPhotoRows, Answer(log, IdentityVerdict.Photo, Checker, isCheck: true, attachment: Photo));
        var withNoAnswerAtAll = Judge(FoundName);

        photoOnUnknownName.Coverage.Should().Be(0.0);
        photoOnUnknownName.Basis.Should().Be(ProductIdentityBasis.Unknown);
        photoOnFoundName.Coverage.Should().Be(withNoAnswerAtAll.Coverage, "an answer that cannot count changes nothing: the found name keeps its half");
        photoOnFoundName.Basis.Should().Be(ProductIdentityBasis.Found);
    }

    [Fact]
    public void ProductId_SpeakersOwnCheck_IsNotACheck()
    {
        // The speaker holds the confirm-records authority (an owner who recorded the day himself) and answers: the server
        // stores the row as a check (is_check = true), but the sender IS the record's own speaker (D-95), so it is his answer.
        var log = SprayLog(speaker: Owner);
        var ownersOwnYes = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Owner, isCheck: true));
        var someoneElsesYes = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true));

        ownersOwnYes.Check.Should().BeNull("his own yes is not a check");
        ownersOwnYes.SpeakerAnswer.Should().NotBeNull();
        ownersOwnYes.Basis.Should().Be(ProductIdentityBasis.SpeakerYes);
        ownersOwnYes.Coverage.Should().Be(0.5);
        someoneElsesYes.Coverage.Should().Be(1.0, "another holder's yes on the same record is the check");
    }

    [Fact]
    public void ProductId_SpeakersYes_IsHisAnswerAndCountsLikeFound()
    {
        var log = SprayLog();
        var yes = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Speaker));

        yes.Basis.Should().Be(ProductIdentityBasis.SpeakerYes);
        yes.Coverage.Should().Be(Judge(FoundName).Coverage, "his yes counts exactly like found");
        yes.Check.Should().BeNull();
    }

    [Fact]
    public void ProductId_TheCheckOutranksTheSpeakersAnswer()
    {
        var log = SprayLog();
        var checkerNoAfterSpeakerYes = Judge(FoundName, log,
            Answer(log, IdentityVerdict.Confirmed, Speaker, at: NoonOn(Day)),
            Answer(log, IdentityVerdict.Rejected, Checker, isCheck: true, at: NoonOn(Day).AddHours(1)));
        var checkerYesAfterSpeakerNo = Judge(FoundName, log,
            Answer(log, IdentityVerdict.Rejected, Speaker, at: NoonOn(Day)),
            Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, at: NoonOn(Day).AddHours(1)));

        checkerNoAfterSpeakerYes.Coverage.Should().Be(0.0);
        checkerYesAfterSpeakerNo.Coverage.Should().Be(1.0);
        checkerYesAfterSpeakerNo.SpeakerAnswer!.Verdict.Should().Be(IdentityVerdict.Rejected, "the speaker's answer is kept apart, not overwritten");
    }

    [Fact]
    public void ProductId_AYesThatNamesAnotherProduct_CountsNothingMore()
    {
        // The library found calcium nitrate; the "yes" names a different product. Not the found product: it cannot count,
        // and the found name keeps only its half.
        var log = SprayLog();
        var wrongProduct = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, productId: FoundId2));

        wrongProduct.Coverage.Should().Be(0.5);
        wrongProduct.Basis.Should().Be(ProductIdentityBasis.Found);

        // A yes on an ambiguous name (naming one of the candidates) earns nothing either: D-94.
        var onAmbiguous = Judge(AmbiguousName, log,
            Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true, productId: "p-gibberellic-acid-40-wsg", spoken: AmbiguousName));
        onAmbiguous.Coverage.Should().Be(0.0);
    }

    [Fact]
    public void ProductId_IsTheMeanOverTheProductsOfTheDay()
    {
        var log = SprayLog();
        var full = Judge(FoundName, log, Answer(log, IdentityVerdict.Confirmed, Checker, isCheck: true));
        var half = Judge(FoundName2);
        var zero = Judge(UnknownName);

        Part(Build(SprayDay, [full, half, zero])).Coverage.Should().BeApproximately(0.5, 1e-9);
    }

    // ── owed from the operation: naming a product can only raise the number ──

    [Fact]
    public void ProductId_IsOwedFromTheSprayItself_SoNamingAProductNeverLowersTheNumber()
    {
        var silent = Build(SprayDay, products: []);
        var named = Build(SprayDay, [Judge(UnknownName)]);

        Part(silent).Applicable.Should().BeTrue("a spraying day owes the product part before any product is named");
        Part(silent).Coverage.Should().Be(0.0);
        DayUnderstandingScore.From(named).Should().BeGreaterThanOrEqualTo(DayUnderstandingScore.From(silent)!.Value);

        var found = Build(SprayDay, [Judge(FoundName)]);
        DayUnderstandingScore.From(found).Should().BeGreaterThan(DayUnderstandingScore.From(silent)!.Value,
            "a product the library found raises the number");
    }

    [Fact]
    public void ProductId_NeverComesFromTheParseJob()
    {
        // The parse job says calcium nitrate with a dose; the stored content names nothing. Nothing is credited.
        var fromJobOnly = Build(SprayDayWhereTheParseJobNamesAProduct, products: []);

        Part(fromJobOnly).Coverage.Should().Be(0.0);
    }

    [Fact]
    public void ProductId_IsOnlyInTheRoster_NeverInTheLensesOrTheClassifier()
    {
        using var doc = JsonDocument.Parse(SprayDay);
        LensInput Run(IReadOnlyList<ProductJudgement> products, out ClassifierSignals signals)
        {
            var (input, s) = DfesLensExtractor.Build(
                new DfesLensExtractor.DayData([doc.RootElement], [], Products: products), new DfesLensExtractor.LensScoresProbe(), true);
            signals = s;
            return input;
        }

        var without = Run([], out var signalsWithout);
        var with = Run([Judge(FoundName)], out var signalsWith);

        with.Execution.Concat(with.Insight).Concat(with.Learning).Select(d => d.Name).Should().NotContain("PRODUCT_ID");
        signalsWith.Should().Be(signalsWithout, "the day's classification and the reward economy do not move");
        with.Execution.Should().Equal(without.Execution);
    }

    // ── the version guard: dfes-4 days stay on their own engine ──────────────

    [Fact]
    public void ProductId_AnOldDay_IsNeverGivenThePart()
    {
        foreach (var old in new[] { "dfes-1", "dfes-2", "dfes-3", "dfes-4" })
        {
            var roster = Build(SprayDay, [Judge(FoundName)], scoredUnder: old).Possible!;

            roster.Should().NotContain(d => d.Name == "PRODUCT_ID", "a day scored under {0} keeps the roster it was scored with", old);
        }

        Build(SprayDay, [Judge(FoundName)], scoredUnder: "dfes-5").Possible!.Should().Contain(d => d.Name == "PRODUCT_ID");
        Build(SprayDay, [Judge(FoundName)], scoredUnder: null).Possible!.Should().Contain(d => d.Name == "PRODUCT_ID");
        Build(SprayDay, [Judge(FoundName)], scoredUnder: "dfes-6").Possible!.Should().Contain(d => d.Name == "PRODUCT_ID",
            "the next engine keeps this part");
    }

    [Fact]
    public void ProductId_ADfes4Day_KeepsEveryWave3RuleAndLacksOnlyTheProductPart()
    {
        // A dfes-4 day must not slide back to dfes-3 behaviour when the engine moves to dfes-5: with the app's own weather it
        // still retires WEATHER (a dfes-4 rule), exactly as a day stamped dfes-5 does; a dfes-3 day does not.
        var weather = new[] { WeatherStampFor(PlotA) };
        var dfes3 = Build(SprayDay, [], scoredUnder: "dfes-3", weather: weather);
        var dfes4 = Build(SprayDay, [], scoredUnder: "dfes-4", weather: weather);
        var dfes5 = Build(SprayDay, [], scoredUnder: "dfes-5", weather: weather);

        dfes3.Possible!.Single(d => d.Name == "WEATHER").Applicable.Should().BeTrue("dfes-3: weather still owed");
        dfes4.Possible!.Single(d => d.Name == "WEATHER").Applicable.Should().BeFalse("dfes-4 rule kept");
        dfes5.Possible!.Single(d => d.Name == "WEATHER").Applicable.Should().BeFalse();
        dfes4.Possible!.Select(d => d.Name).Should().NotContain("PRODUCT_ID");
        dfes5.Possible!.Select(d => d.Name).Should().Contain("PRODUCT_ID");
    }

    [Theory]
    [InlineData(null, true, true)]
    [InlineData("dfes-3", false, false)]
    [InlineData("dfes-4", true, false)]
    [InlineData("dfes-5", true, true)]
    [InlineData("dfes-10", true, true)]
    [InlineData("", false, false)]
    [InlineData("dfes-x", false, false)]
    [InlineData("v5", false, false)]
    public void TheGuardReadsTheVersionAsANumber(string? scoredUnder, bool wave3, bool productPart)
    {
        var weather = new[] { WeatherStampFor(PlotA) };
        var roster = Build(SprayDay, [Judge(FoundName)], scoredUnder, weather).Possible!;

        (roster.Single(d => d.Name == "WEATHER").Applicable == false).Should().Be(wave3);
        roster.Any(d => d.Name == "PRODUCT_ID").Should().Be(productPart);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static ProductJudgement Judge(string spoken) => JudgeWithPhotos(spoken, SprayLog(), NoPhotoRows);

    private static ProductJudgement Judge(string spoken, DailyLog log, params InputIdentityAssertion[] answers) =>
        JudgeWithPhotos(spoken, log, NoPhotoRows, answers);

    private static ProductJudgement JudgeWithPhotos(
        string spoken, DailyLog log, Func<Guid, bool> photoExists, params InputIdentityAssertion[] answers) =>
        ProductIdentity.Judge(new ProductItem("e1", 0, spoken, null), answers, log.OperatorUserId.Value, photoExists);

    private static ScoredDimension Part(LensInput input) => input.Possible!.Single(d => d.Name == "PRODUCT_ID");

    private static LensInput Build(
        string json, IReadOnlyList<ProductJudgement> products, string? scoredUnder = null, IReadOnlyList<WeatherStamp>? weather = null)
    {
        using var doc = JsonDocument.Parse(json);
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement], [], null, null, weather, PlotA, Day, scoredUnder, products),
            new DfesLensExtractor.LensScoresProbe(),
            clientDatePlausible: true);
        return input;
    }

    private static WeatherStamp WeatherStampFor(Guid plot) =>
        WeatherStamp.Create(
            Guid.NewGuid(), Guid.NewGuid(), plot,
            timestampLocal: NoonOn(Day), timestampProvider: NoonOn(Day), provider: WeatherProvider.TomorrowIo,
            tempC: 29.5m, humidity: 62m, windKph: 7.4m, precipMm: 0m, cloudCoverPct: 20m,
            conditionText: "Clear", iconCode: "1000", rainProbNext6h: 5m,
            windGustKph: null, soilMoisture0To10: null, uvIndex: null, alertsJson: null,
            createdAtUtc: NoonOn(Day));
}
