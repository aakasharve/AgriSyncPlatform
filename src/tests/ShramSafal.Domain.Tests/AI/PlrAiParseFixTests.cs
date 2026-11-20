// spec: plr-d10-redesign-real-integration-2026-10-25 (lane AI-PARSE-FIX)
using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// Lane AI-PARSE-FIX - three deterministic guards after the model, pinned with the founder's REAL log
/// (<c>ssf.ai_jobs</c> 5d82daba-0a6c-4679-9b31-3d2f28153b41, TEST stack, 2026-11-20 23:08 IST: Sarvam 105B, legacy prompt).
/// The stored answer is the model's raw output below (the server's own stamps removed); the transcript is the founder's
/// words exactly as stored. Every guard TAGS and never deletes or rewrites (a mechanical check must not destroy what the model
/// extracted): the model's names, quantities and words are asserted unchanged next to each tag.
/// </summary>
public sealed class PlrAiParseFixTests
{
    private const string Transcript =
        "आज घड बांधायचं काम झालं आणि शेंडा मारला. 8 बायका आणि 2 गडी होते. बायकांना ₹400, गड्यांना ₹500 मजुरी होती. " +
        "कराटे 250 ml आणि कॉर्नफिल्डावर 100 ml 200 L पाण्यात मिसळून मारलं. ते बघ मग 2 19 19 19 5 kg आणि Calcium Nitrate 3 kg सोडलं. " +
        "नेहमीप्रमाणे 2 तास पाणी गेलं. फवाऱ्याला tractor 4 तास चालला. Diesel-ला ₹500 गेले. " +
        "खालच्या पानांवर थोडी भुरी दिसत आहे, त्यासाठी उद्या board तयार करायचा आहे आणि खुरपणी पण करायची आहे.";

    /// <summary>The model's answer for that log, as stored (provenance stamps and _meta left out: the normalizer writes them).</summary>
    private const string FoundersRealAnswer = """
        {
          "inputs": [
            { "type": "pesticide", "unit": "ml", "method": "Spray", "quantity": 250,
              "sourceText": "कराटे 250 ml आणि कॉर्नफिल्डावर 100 ml 200 L पाण्यात मिसळून मारलं", "productName": "कराटे" },
            { "type": "pesticide", "unit": "ml", "method": "Spray", "quantity": 100,
              "sourceText": "कराटे 250 ml आणि कॉर्नफिल्डावर 100 ml 200 L पाण्यात मिसळून मारलं", "productName": "कॉर्नफिल्ड" },
            { "type": "fertilizer", "unit": "kg", "method": "Soil", "quantity": 5,
              "sourceText": "2 19 19 19 5 kg ... सोडलं", "productName": "2-19-19-19" },
            { "type": "fertilizer", "unit": "kg", "method": "Soil", "quantity": 3,
              "sourceText": "Calcium Nitrate 3 kg सोडलं", "productName": "Calcium Nitrate" }
          ],
          "labour": [
            { "type": "HIRED", "count": 8, "gender": "female", "activity": "Trellising", "femaleCount": 8,
              "sourceText": "8 बायका आणि 2 गडी होते" },
            { "type": "HIRED", "count": 2, "gender": "male", "activity": "Topping", "maleCount": 2,
              "sourceText": "8 बायका आणि 2 गडी होते" }
          ],
          "summary": "आज द्राक्ष G1 मध्ये घड बांधणी आणि शेंडा मारणे झाले.",
          "machinery": [ { "hours": 4, "activity": "Spraying", "sourceText": "फवाऱ्याला tractor 4 तास चालला", "machineType": "Tractor" } ],
          "confidence": 0.94,
          "dayOutcome": "WORK_RECORDED",
          "irrigation": [ { "method": "Drip", "sourceText": "नेहमीप्रमाणे 2 तास पाणी गेलं", "durationHours": 2 } ],
          "disturbance": null,
          "observations": [
            { "textRaw": "खालच्या पानांवर थोडी भुरी दिसत आहे", "noteType": "issue", "severity": "important",
              "textCleaned": "खालच्या पानांवर थोडी भुरी दिसत आहे" }
          ],
          "plannedTasks": [
            { "title": "बोर्ड तयार करणे", "dueHint": "उद्या", "category": "maintenance" },
            { "title": "खुरपणी करणे", "dueHint": "उद्या" }
          ],
          "cropActivities": [
            { "title": "घड बांधणी आणि शेंडा मारणे", "workTypes": ["Trellising", "Topping"],
              "sourceText": "आज घड बांधायचं काम झालं आणि शेंडा मारला" },
            { "title": "खुरपणी", "workTypes": ["Weeding"], "sourceText": "खुरपणी पण करायची आहे" }
          ],
          "missingSegments": [],
          "unclearSegments": [],
          "activityExpenses": [ { "unit": "रुपे", "amount": 500, "sourceText": "Diesel-ला ₹500 गेले", "expenseType": "fuel" } ],
          "fieldConfidences": {},
          "questionsForUser": []
        }
        """;

    private readonly AiResponseNormalizer _sut = new();

    private JsonObject Normalize(string json, string? transcript = Transcript) =>
        JsonNode.Parse(_sut.NormalizeVoiceJson(json, serverTranscript: transcript))!.AsObject();

    private static JsonObject Row(JsonObject root, string bucket, int index) => root[bucket]!.AsArray()[index]!.AsObject();

    private static bool IsPlannedOnly(JsonObject row) =>
        row["plannedOnly"] is JsonValue v && v.TryGetValue<bool>(out var planned) && planned;

    // ------------------------------------------------ 1. a future task is not work done

    [Fact]
    public void FoundersLog_WeedingStillToBeDone_IsTaggedPlannedOnly_AndTheDoneWorkIsNot()
    {
        var root = Normalize(FoundersRealAnswer);

        var tying = Row(root, "cropActivities", 0);
        var weeding = Row(root, "cropActivities", 1);

        // "आज घड बांधायचं काम झालं आणि शेंडा मारला": "बांधायचं" looks like a future form but "झालं" and "मारला" say it was done.
        IsPlannedOnly(tying).Should().BeFalse();
        tying["status"].Should().BeNull("a done row is not given a status it did not have");

        // "खुरपणी पण करायची आहे": still to be done.
        IsPlannedOnly(weeding).Should().BeTrue();
        weeding["status"]!.GetValue<string>().Should().Be("pending");
    }

    [Fact]
    public void FoundersLog_TheFutureTaskIsTaggedNeverDeleted_ItsWordsAndItsReminderAreKept()
    {
        var root = Normalize(FoundersRealAnswer);

        root["cropActivities"]!.AsArray().Should().HaveCount(2, "tag, never delete");
        var weeding = Row(root, "cropActivities", 1);
        weeding["title"]!.GetValue<string>().Should().Be("खुरपणी");
        weeding["sourceText"]!.GetValue<string>().Should().Be("खुरपणी पण करायची आहे");
        weeding["workTypes"]!.AsArray().Select(n => n!.GetValue<string>()).Should().Equal("Weeding");
        weeding["provenanceVerified"]!.GetValue<bool>().Should().BeTrue();

        root["plannedTasks"]!.AsArray().Should().HaveCount(2, "the model's own reminders are not moved or duplicated");
        Row(root, "plannedTasks", 1)["title"]!.GetValue<string>().Should().Be("खुरपणी करणे");
    }

    [Fact]
    public void AModelStatusIsNeverOverwritten()
    {
        const string json = """
            { "cropActivities": [ { "title": "खुरपणी", "status": "partial", "sourceText": "उद्या खुरपणी करायची आहे" } ] }
            """;

        var weeding = Row(Normalize(json, "उद्या खुरपणी करायची आहे"), "cropActivities", 0);

        IsPlannedOnly(weeding).Should().BeTrue();
        weeding["status"]!.GetValue<string>().Should().Be("partial");
    }

    [Theory]
    [InlineData("खुरपणी पण करायची आहे", true)]
    [InlineData("उद्या खुरपणी करायची आहे", true)]
    [InlineData("फवारणी करायचं आहे", true)]
    [InlineData("आज फवारणी करायचंय", true)]
    [InlineData("औषध आणायचं आहे", true)]
    [InlineData("खत पाहिजे", true)]
    [InlineData("उद्या खुरपणी", true)]
    [InlineData("tomorrow weeding", true)]
    [InlineData("need to spray", true)]
    // done work: never tagged
    [InlineData("आज खुरपणी केली", false)]
    [InlineData("आज घड बांधायचं काम झालं आणि शेंडा मारला", false)]
    [InlineData("आज फवारणी झाली", false)]
    [InlineData("शेंडा मारला", false)]
    // both a future form and a past word: left alone, the guard will not say it was not done
    [InlineData("आज फवारणी झाली आणि उद्या औषध आणायचं आहे", false)]
    // an intention that is already over is not "still to do"
    [InlineData("फवारणी करायचं होतं", false)]
    // a noun-like infinitive with no "आहे" after it is not intent
    [InlineData("बांधायचं काम", false)]
    [InlineData("", false)]
    public void FutureOnly_ReadsHisOwnWords_AndNeverTagsDoneWork(string words, bool expected) =>
        FutureTenseActivityGuard.IsFutureOnly(words).Should().Be(expected);

    [Fact]
    public void ADayWithOnlyAFutureTask_IsNotAWorkDay_SoADisturbanceStillDecidesTheOutcome()
    {
        const string json = """
            { "dayOutcome": "WORK_RECORDED",
              "cropActivities": [ { "title": "खुरपणी", "sourceText": "खुरपणी पण करायची आहे" } ],
              "disturbance": { "scope": "FULL_DAY", "group": "power", "reason": "वीज नव्हती", "blockedSegments": [] } }
            """;

        Normalize(json, "वीज नव्हती. खुरपणी पण करायची आहे.")["dayOutcome"]!.GetValue<string>().Should().Be("DISTURBANCE_RECORDED");
    }

    // ------------------------------------------------ 2. a stray number before a known grade

    [Fact]
    public void FoundersLog_StrayTwoBeforeNineteenNineteenNineteen_KeepsTheModelsName_AndSuggestsTheGrade()
    {
        var root = Normalize(FoundersRealAnswer);
        var row = Row(root, "inputs", 2);

        // The model's name, quantity, unit and words are exactly as the model gave them.
        row["productName"]!.GetValue<string>().Should().Be("2-19-19-19");
        row["quantity"]!.GetValue<decimal>().Should().Be(5m);
        row["unit"]!.GetValue<string>().Should().Be("kg");
        row["sourceText"]!.GetValue<string>().Should().Be("2 19 19 19 5 kg ... सोडलं");

        var tag = row["didYouMean"]!.AsObject();
        tag["kind"]!.GetValue<string>().Should().Be("stray-leading-number");
        tag["heard"]!.GetValue<string>().Should().Be("2-19-19-19");
        tag["suggested"]!.GetValue<string>().Should().Be("19-19-19");
        tag["strayNumber"]!.GetValue<string>().Should().Be("2");
    }

    [Theory]
    [InlineData("19-19-19")]       // the grade itself
    [InlineData("0-52-34")]        // a three-number grade
    [InlineData("2-10-10-10")]     // four numbers but the last three are not a known grade: nothing is invented
    [InlineData("1-2-3-4")]
    [InlineData("Calcium Nitrate")]
    [InlineData("कराटे")]
    [InlineData("2-19-19")]        // three numbers
    [InlineData("2-19-19-19 plus")]
    public void OnlyFourNumbersEndingInAKnownGrade_AreTagged(string productName)
    {
        var json = $$"""{ "inputs": [ { "type": "fertilizer", "productName": "{{productName}}", "quantity": 5, "unit": "kg" } ] }""";

        var row = Row(Normalize(json, "x"), "inputs", 0);

        row["didYouMean"].Should().BeNull();
        row["productName"]!.GetValue<string>().Should().Be(productName);
    }

    [Theory]
    [InlineData("2 19 19 19")]
    [InlineData("2:19:19:19")]
    [InlineData("२-१९-१९-१९")]    // Devanagari digits
    [InlineData("0-0-52-34")]
    public void TheNumbersMaySitInAnyDigitScriptAndSeparator(string productName)
    {
        var json = $$"""{ "inputs": [ { "type": "fertilizer", "productName": "{{productName}}" } ] }""";

        var row = Row(Normalize(json, "x"), "inputs", 0);

        row["didYouMean"]!["kind"]!.GetValue<string>().Should().Be("stray-leading-number");
        row["productName"]!.GetValue<string>().Should().Be(productName, "the model's name is never rewritten");
    }

    [Fact]
    public void AMixItemWithAStrayNumberIsTaggedOnTheItem()
    {
        const string json = """
            { "inputs": [ { "method": "Drip", "mix": [ { "productName": "2-19-19-19", "unit": "kg", "dose": 5 } ] } ] }
            """;

        var item = Row(Normalize(json, "x"), "inputs", 0)["mix"]!.AsArray()[0]!.AsObject();

        item["didYouMean"]!["suggested"]!.GetValue<string>().Should().Be("19-19-19");
        item["productName"]!.GetValue<string>().Should().Be("2-19-19-19");
    }

    // ------------------------------------------------ 3. "board" is Bordeaux only beside a spray word

    [Fact]
    public void BoardBesideASprayWord_IsSuggestedAsBordeaux_WithTheHeardWordKept()
    {
        // The earlier attempt of the same day (22:56): "board मिश्रण फवारायचं" became the task "बोर्ड तयार करणे".
        const string transcript = "खालच्या पानांवर भुरी आहे. उद्या board मिश्रण फवारायचं आहे.";
        const string json = """
            { "plannedTasks": [ { "title": "बोर्ड तयार करणे", "dueHint": "उद्या", "category": "maintenance" } ] }
            """;

        var task = Row(Normalize(json, transcript), "plannedTasks", 0);

        task["title"]!.GetValue<string>().Should().Be("बोर्ड तयार करणे", "his words and the model's title are never rewritten");
        var tag = task["didYouMean"]!.AsObject();
        tag["kind"]!.GetValue<string>().Should().Be("bordeaux-mixture");
        tag["heard"]!.GetValue<string>().Should().Be("बोर्ड");
        tag["suggested"]!["en"]!.GetValue<string>().Should().Be("Bordeaux mixture");
        tag["suggested"]!["mr"]!.GetValue<string>().Should().Be("बोर्डो मिश्रण");
    }

    [Fact]
    public void FoundersLog_BoardWithOnlyAMildewWord_IsLeftAlone_ADiseaseWordIsNotASprayWord()
    {
        // The 23:08 sentence has "भुरी" (powdery mildew) and "board" but no spray, fungicide or mixture word. It names the trouble, not the
        // spray, so the guard does not say what the board is. (Reading a disease word as enough is a decision for the founder.)
        var root = Normalize(FoundersRealAnswer);

        Row(root, "plannedTasks", 0)["didYouMean"].Should().BeNull();
        Row(root, "plannedTasks", 0)["title"]!.GetValue<string>().Should().Be("बोर्ड तयार करणे");
    }

    [Theory]
    [InlineData("उद्या board तयार करायचा आहे")]
    [InlineData("दुकानावर board लावला")]
    [InlineData("board लावायचा आहे. फवारणी नंतर करू.")] // the spray word is in the NEXT sentence: not this board's
    public void ABareBoard_WithNoSprayWordInItsOwnSentence_IsLeftAlone(string transcript)
    {
        const string json = """{ "plannedTasks": [ { "title": "board लावणे", "category": "maintenance" } ] }""";

        Row(Normalize(json, transcript), "plannedTasks", 0)["didYouMean"].Should().BeNull();
    }

    [Fact]
    public void ABareBoard_WithASprayWordInTheSameSentence_IsSuggested()
    {
        const string json = """{ "plannedTasks": [ { "title": "board लावणे", "category": "maintenance" } ] }""";

        Row(Normalize(json, "board लावायचा आहे, फवारणी नंतर करू"), "plannedTasks", 0)["didYouMean"]!["kind"]!
            .GetValue<string>().Should().Be("bordeaux-mixture");
    }

    [Theory]
    [InlineData("बोर्डो मिश्रण फवारायचं आहे", "बोर्डो मिश्रण तयार करणे")]
    [InlineData("Bordeaux spray करायचा आहे", "Bordeaux spray")]
    [InlineData("bordo मिश्रण तयार करायचं आहे", "bordo मिश्रण")]
    public void TheRealNameIsNotATarget_NoSuggestionForBordoOrBordeaux(string transcript, string title)
    {
        var json = $$"""{ "plannedTasks": [ { "title": "{{title}}", "category": "maintenance" } ] }""";

        Row(Normalize(json, transcript), "plannedTasks", 0)["didYouMean"].Should().BeNull();
    }

    [Fact]
    public void WhenOnlySomeBoardSentencesCarryASprayWord_OnlyARowThatSitsInThatSentenceIsTagged()
    {
        const string transcript = "दुकानाचा board लावला. नंतर board मिश्रण फवारायचं आहे.";
        const string json = """
            { "plannedTasks": [
                { "title": "board लावणे", "sourceText": "दुकानाचा board लावला", "category": "maintenance" },
                { "title": "board मिश्रण फवारणे", "sourceText": "नंतर board मिश्रण फवारायचं आहे", "category": "maintenance" },
                { "title": "board", "category": "maintenance" } ] }
            """;

        var root = Normalize(json, transcript);

        Row(root, "plannedTasks", 0)["didYouMean"].Should().BeNull("a real signboard stays a signboard");
        Row(root, "plannedTasks", 1)["didYouMean"].Should().NotBeNull();
        Row(root, "plannedTasks", 2)["didYouMean"].Should().BeNull("no sourceText: it cannot be placed in the spray sentence");
    }

    // ------------------------------------------------ the whole real log: nothing the model extracted is lost

    [Fact]
    public void FoundersLog_EveryRowTheModelExtractedIsStillThere_AndNoMixIdOrCarrierWaterIsInvented()
    {
        var root = Normalize(FoundersRealAnswer);

        root["inputs"]!.AsArray().Should().HaveCount(4);
        root["labour"]!.AsArray().Should().HaveCount(2);
        root["irrigation"]!.AsArray().Should().HaveCount(1);
        root["machinery"]!.AsArray().Should().HaveCount(1);
        root["activityExpenses"]!.AsArray().Should().HaveCount(1);
        root["observations"]!.AsArray().Should().HaveCount(1);
        root["plannedTasks"]!.AsArray().Should().HaveCount(2);
        root["cropActivities"]!.AsArray().Should().HaveCount(2);

        // These guards are about the three things above. The two sprays in one tank (no mixId, no 200 L carrier water) and the
        // activities given to the 8 women and 2 men are a PROMPT matter (see the proposal); a guard that invented a mixId, a volume or
        // a task here would be guessing, so none is added.
        foreach (var input in root["inputs"]!.AsArray().OfType<JsonObject>())
        {
            input["mixId"].Should().BeNull();
            input["carrierVolume"].Should().BeNull();
        }

        Row(root, "inputs", 0)["productName"]!.GetValue<string>().Should().Be("कराटे");
        Row(root, "inputs", 1)["productName"]!.GetValue<string>().Should().Be("कॉर्नफिल्ड", "the mis-heard Confidor is kept as heard");
    }
}
