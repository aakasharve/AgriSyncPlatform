// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (part 03, B4: Sathi asks what a product was for)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Inputs;
using Xunit;
using static ShramSafal.Domain.Tests.Dfes.ProductDay;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The product-purpose rule (<see cref="ProductPurpose"/>) and the roster part it feeds, PURPOSE (weight 10, engine dfes-6): a
/// product's purpose is known when the record's stored content says it (the input event's <c>reason</c>, Seller Advice excepted)
/// or his answer tells it. The score goes up only on a real answer; silence, a let-go and "माहीत नाही" never move it.
/// </summary>
public sealed class ProductPurposeTests
{
    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── the stored key: the server names the product slot ────────────────────

    [Theory]
    [InlineData("e1", 0, "product.purpose:0:e1")]
    [InlineData("inp-7", 3, "product.purpose:3:inp-7")]
    [InlineData("a:b:c", 12, "product.purpose:12:a:b:c")]
    public void KeyFor_NamesTheSlot_AndReadsBack(string eventId, int slot, string expected)
    {
        ProductPurpose.KeyFor(eventId, slot).Should().Be(expected);

        ProductPurpose.TryParseKey(expected, out var parsedEvent, out var parsedSlot).Should().BeTrue();
        parsedEvent.Should().Be(eventId, "an event id may itself hold a colon: everything after the slot is the id");
        parsedSlot.Should().Be(slot);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("product.purpose")]
    [InlineData("product.purpose:")]
    [InlineData("product.purpose:x:e1")]
    [InlineData("product.purpose:-1:e1")]
    [InlineData("product.purpose:0:")]
    [InlineData("product.purpose:0:   ")]
    [InlineData("gap.dose")]
    [InlineData("product.purposes:0:e1")]
    public void TryParseKey_RefusesWhatIsNotAProductSlot(string? key)
    {
        ProductPurpose.TryParseKey(key, out _, out _).Should().BeFalse();
    }

    [Fact]
    public void TheKind_IsDecidedByTheServer_AndStatesNoAgronomy()
    {
        QuestionKinds.ForKey("product.purpose").Should().Be(QuestionKinds.ProductPurpose);
        QuestionKinds.ForKey("product.purpose:0:e1").Should().Be(QuestionKinds.ProductPurpose);
        QuestionKinds.StatesAgronomy(QuestionKinds.ProductPurpose).Should().BeFalse(
            "it asks him a fact of his own work, so it needs no source");
        QuestionKinds.ForKey("product.other").Should().Be(QuestionKinds.Unknown, "only this question, nothing near it");
    }

    // ── "said": the event's reason, from the stored content ──────────────────

    [Theory]
    [InlineData("Disease", true)]
    [InlineData("Pest", true)]
    [InlineData("Preventive", true)]
    [InlineData("disease_control", true)]
    [InlineData("Other", true)]
    [InlineData("Seller Advice", false)]
    [InlineData("seller advice", false)]
    [InlineData("  ", false)]
    [InlineData(null, false)]
    public void IsStated_ReadsTheEventsReason(string? reason, bool stated)
    {
        ProductPurpose.IsStated(reason).Should().Be(stated);
    }

    [Fact]
    public void ItemsOf_GivesEveryProductItsEventsReason()
    {
        const string document = """
        {"schema":1,"inputs":[
          {"id":"e1","reason":"Disease","mix":[{"id":"m0","productName":"Uthane M-45"},{"id":"m1","productName":"Karate"}]},
          {"id":"e2","productName":"DAP","mix":[]},
          {"id":"e3","reason":7,"mix":[{"id":"m0","productName":"19:19:19"}]}
        ]}
        """;

        var items = ProductPurpose.ItemsOf(document);

        items.Select(i => (i.Item.InputEventId, i.Item.MixIndex, i.Item.SpokenName, i.StatedReason)).Should().Equal(
            ("e1", 0, "Uthane M-45", "Disease"),
            ("e1", 1, "Karate", "Disease"),
            ("e2", 0, "DAP", (string?)null),
            ("e3", 0, "19:19:19", (string?)null));
        ProductPurpose.ItemsOf("not json").Should().BeEmpty();
        ProductPurpose.ItemsOf(null).Should().BeEmpty();
    }

    // ── judging one product ──────────────────────────────────────────────────

    [Fact]
    public void Judge_StatedPurpose_IsKnown_AndNotAsked()
    {
        var item = Item(reason: "Disease");

        var judged = ProductPurpose.Judge(item, []);

        judged.Stated.Should().BeTrue();
        judged.Known.Should().BeTrue();
        judged.Ask.Should().BeFalse("he already said what it was for");
    }

    [Fact]
    public void Judge_UnsaidPurpose_NoAnswer_IsAsked_AndNotKnown()
    {
        var judged = ProductPurpose.Judge(Item(reason: null), []);

        judged.Known.Should().BeFalse();
        judged.Ask.Should().BeTrue();
    }

    [Fact]
    public void Judge_ARealAnswer_MakesItKnown()
    {
        var log = SprayLog();
        var judged = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(log, "करपा", ProductPurposeAnswerModes.Chip, "downy")));

        judged.Known.Should().BeTrue();
        judged.Ask.Should().BeFalse();
        judged.Answer!.Response.Should().Be("करपा");
    }

    [Fact]
    public void Judge_AVoiceAnswer_MakesItKnown()
    {
        var log = SprayLog();
        var judged = ProductPurpose.Judge(
            Item(reason: null), Answers(PurposeAnswer(log, "डावणी साठी मारलं", ProductPurposeAnswerModes.Voice, code: null)));

        judged.Known.Should().BeTrue();
    }

    [Fact]
    public void Judge_DoesNotKnow_IsAnswered_ButNotKnown()
    {
        var log = SprayLog();
        var judged = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(log, "माहीत नाही", code: ProductPurpose.UnknownCode)));

        judged.Known.Should().BeFalse("\"he does not know\" is his honest answer, not a purpose (P4)");
        judged.Ask.Should().BeFalse("and he is not asked again");
    }

    [Fact]
    public void Judge_AnAnswerAboutAnotherSlot_IsNotThisProducts()
    {
        var log = SprayLog();
        var judged = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(log, slot: 1)));

        judged.Answer.Should().BeNull();
        judged.Ask.Should().BeTrue();
    }

    [Fact]
    public void Judge_WhenTheSlotNowHoldsAnotherProduct_TheOldAnswerCountsForNothing()
    {
        // He answered about Uthane in slot 0; a later edit put another product there. The answer is not about it.
        var log = SprayLog();
        var judged = ProductPurpose.Judge(Item(reason: null, name: "Karate"), Answers(PurposeAnswer(log, productName: "Uthane M-45")));

        judged.Answer.Should().BeNull();
        judged.Known.Should().BeFalse();
        judged.Ask.Should().BeTrue();
    }

    [Fact]
    public void Judge_TheFirstAnswerStands()
    {
        var log = SprayLog();
        var first = PurposeAnswer(log, "करपा", at: NoonOn(Day));
        var later = PurposeAnswer(log, "भुरी", at: NoonOn(Day).AddHours(1));

        ProductPurpose.Judge(Item(reason: null), Answers(later, first)).Answer!.Response.Should().Be("करपा");
    }

    [Theory]
    [InlineData("", "chip", null, false)]
    [InlineData("   ", "voice", null, false)]
    [InlineData("करपा", "chip", "unknown", false)]
    [InlineData("करपा", "typed", null, false)]
    [InlineData("करपा", null, null, false)]
    [InlineData("करपा", "chip", "downy", true)]
    [InlineData("करपा", "chip", null, true)]
    [InlineData("करपा", "voice", null, true)]
    public void Counts_OnlyARealAnswer(string response, string? mode, string? code, bool counts)
    {
        var answer = new ProductPurposeAnswer(Guid.NewGuid(), TheFarm, Guid.NewGuid(), "e1", 0, FoundName, response, mode, code, Speaker, NoonOn(Day));

        ProductPurpose.Counts(answer).Should().Be(counts);
    }

    [Theory]
    [InlineData("downy", true)]
    [InlineData("leaf_spot_2", true)]
    [InlineData("Downy", false)]
    [InlineData("downy mildew", false)]
    [InlineData("", false)]
    [InlineData("करपा", false)]
    public void ChipCodes_AreFixedCodes(string code, bool wellFormed)
    {
        ProductPurpose.IsWellFormedCode(code).Should().Be(wellFormed);
        ProductPurpose.IsWellFormedCode(new string('a', ProductPurpose.MaxAnswerCodeLength + 1)).Should().BeFalse();
    }

    // ── the roster part PURPOSE (dfes-6) ─────────────────────────────────────

    [Fact]
    public void Purpose_NoProducts_NotApplicable()
    {
        var day = Build(SprayDay, purposes: [], scoredUnder: null);

        Part(day).Applicable.Should().BeFalse("a product nobody named cannot be asked about");
        Part(day).Weight.Should().Be(10);
    }

    [Fact]
    public void Purpose_OnAnOlderEnginesDay_IsAbsent_AndTheNumberDoesNotMove()
    {
        // A day stamped dfes-5 is frozen on dfes-5 rules: no PURPOSE part, so its number is exactly what it was, answer or not.
        var unsaid = ProductPurpose.Judge(Item(reason: null), []);
        var answered = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(SprayLog())));

        var dfes5Unsaid = Build(SprayDay, [unsaid], scoredUnder: "dfes-5");
        var dfes5Answered = Build(SprayDay, [answered], scoredUnder: "dfes-5");
        var dfes5NoPurposes = Build(SprayDay, [], scoredUnder: "dfes-5");

        dfes5Unsaid.Possible!.Should().NotContain(d => d.Name == "PURPOSE");
        DayUnderstandingScore.From(dfes5Unsaid).Should().Be(DayUnderstandingScore.From(dfes5NoPurposes));
        DayUnderstandingScore.From(dfes5Answered).Should().Be(DayUnderstandingScore.From(dfes5NoPurposes));
        Roster(Build(SprayDay, [unsaid], scoredUnder: null)).Should().NotEqual(Roster(dfes5Unsaid),
            "and the new engine really is different on this day, or the freeze above proves nothing");
    }

    [Fact]
    public void Purpose_Unsaid_IsOwedAtZero_AndARealAnswerRaisesTheNumber()
    {
        var unsaid = ProductPurpose.Judge(Item(reason: null), []);
        var answered = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(SprayLog())));

        var before = Build(SprayDay, [unsaid]);
        var after = Build(SprayDay, [answered]);

        Part(before).Applicable.Should().BeTrue();
        Part(before).Coverage.Should().Be(0.0);
        Part(after).Coverage.Should().Be(1.0);
        DayUnderstandingScore.From(after).Should().BeGreaterThan(DayUnderstandingScore.From(before)!.Value,
            "founder's design: the score goes up on a real answer");
    }

    [Fact]
    public void Purpose_DoesNotKnow_LeavesTheNumberWhereItWas()
    {
        var unsaid = ProductPurpose.Judge(Item(reason: null), []);
        var dontKnow = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(SprayLog(), "माहीत नाही", code: ProductPurpose.UnknownCode)));

        DayUnderstandingScore.From(Build(SprayDay, [dontKnow])).Should().Be(DayUnderstandingScore.From(Build(SprayDay, [unsaid])));
        Part(Build(SprayDay, [dontKnow])).Coverage.Should().Be(0.0);
    }

    [Fact]
    public void Purpose_SaidInTheRecord_IsFullWithoutAnyQuestion()
    {
        var said = ProductPurpose.Judge(Item(reason: "Disease"), []);

        Part(Build(SprayDay, [said])).Coverage.Should().Be(1.0);
    }

    [Fact]
    public void Purpose_IsTheShareOfProductsWhosePurposeIsKnown()
    {
        var log = SprayLog();
        var first = ProductPurpose.Judge(Item(reason: null, name: FoundName, slot: 0), Answers(PurposeAnswer(log, slot: 0)));
        var second = ProductPurpose.Judge(Item(reason: null, name: FoundName2, slot: 1), []);

        Part(Build(SprayDay, [first, second])).Coverage.Should().Be(0.5);
    }

    [Fact]
    public void Purpose_AnsweringOneProductAfterAnother_NeverLowersTheNumber()
    {
        var log = SprayLog();
        var none = new[] { Judged(log, 0, answered: false), Judged(log, 1, answered: false), Judged(log, 2, answered: false) };
        var one = new[] { Judged(log, 0, answered: true), Judged(log, 1, answered: false), Judged(log, 2, answered: false) };
        var all = new[] { Judged(log, 0, answered: true), Judged(log, 1, answered: true), Judged(log, 2, answered: true) };

        var s0 = DayUnderstandingScore.From(Build(SprayDay, none))!.Value;
        var s1 = DayUnderstandingScore.From(Build(SprayDay, one))!.Value;
        var s3 = DayUnderstandingScore.From(Build(SprayDay, all))!.Value;

        s1.Should().BeGreaterThanOrEqualTo(s0);
        s3.Should().BeGreaterThan(s0);
        s3.Should().BeGreaterThanOrEqualTo(s1);
    }

    [Fact]
    public void Purpose_IsRosterOnly_TheLensesDoNotMove()
    {
        var unsaid = ProductPurpose.Judge(Item(reason: null), []);
        var answered = ProductPurpose.Judge(Item(reason: null), Answers(PurposeAnswer(SprayLog())));

        var before = Build(SprayDay, [unsaid]);
        var after = Build(SprayDay, [answered]);

        Lenses(after).Should().Equal(Lenses(before), "the classifier and the reward economy are founder-gated and untouched");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static ProductPurposeItem Item(string? reason, string name = FoundName, int slot = 0, string eventId = "e1") =>
        new(new ProductItem(eventId, slot, name, null), reason);

    private static ProductPurposeJudgement Judged(Domain.Logs.DailyLog log, int slot, bool answered) =>
        ProductPurpose.Judge(
            Item(reason: null, name: $"product {slot}", slot: slot),
            answered ? Answers(PurposeAnswer(log, slot: slot, productName: $"product {slot}")) : []);

    private static List<ProductPurposeAnswer> Answers(params QuestionEvent[] rows) =>
        ShramSafal.Application.Services.ProductPurposeReader.ToAnswers(rows);

    private static ScoredDimension Part(LensInput input) => input.Possible!.Single(d => d.Name == "PURPOSE");

    private static IEnumerable<(string, int, bool, double)> Roster(LensInput input) =>
        input.Possible!.Select(d => (d.Name, d.Weight, d.Applicable, d.Coverage)).ToList();

    private static IEnumerable<(string, double)> Lenses(LensInput input) =>
        input.Execution.Concat(input.Insight).Concat(input.Learning).Select(d => (d.Name, d.Coverage)).ToList();

    private static LensInput Build(string json, IReadOnlyList<ProductPurposeJudgement> purposes, string? scoredUnder = null)
    {
        using var doc = JsonDocument.Parse(json);
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement], [], null, null, null, PlotA, Day, scoredUnder, Products: [], Purposes: purposes),
            new DfesLensExtractor.LensScoresProbe(),
            clientDatePlausible: true);
        return input;
    }
}
