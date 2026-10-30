using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.Ports.External;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR go-live register F22 / F23 + spray water + V-1 cut-off (lane AI-1, AgriLogParser v3.7).
///
/// F22 — "5 बायका आणि 2 पुरुष छाटणीला होते" is seven people, five women and two men; it was read as workers NAMED
/// बायका and पुरुष, and those names become worker identities in the ledger. F23 — a labour count of 0 is the
/// model's "not understood", shown to the farmer as "0 जण". Both are fixed at the source (prompt + few-shot) AND by
/// a deterministic guard after the model (<see cref="LabourRowGuard"/>), which these tests pin. The spray's tank
/// water is the spray's (<see cref="SprayCarrierWaterGuard"/>). A Sarvam answer cut off at the token limit is a
/// failure, never a silent empty parse.
/// </summary>
public sealed class PlrAi1LabourAndCarrierTests
{
    private readonly AiResponseNormalizer _sut = new();

    private JsonObject Normalize(string json) => JsonNode.Parse(_sut.NormalizeVoiceJson(json))!.AsObject();

    private static JsonObject Row(JsonObject root, int index = 0) => root["labour"]!.AsArray()[index]!.AsObject();

    // ---------------------------------------------------------------- F22: a crowd word is not a name

    [Theory]
    [InlineData("बायका", true)]
    [InlineData("पुरुष", true)]
    [InlineData("5 बायका", true)]
    [InlineData("पाच बायका", true)]
    [InlineData("बायका आणि पुरुष", true)]
    [InlineData("बायकांनी", true)]
    [InlineData("मजूर", true)]
    [InlineData("लोक", true)]
    [InlineData("जण", true)]
    [InlineData("गडी", true)]
    [InlineData("माणसं", true)]
    [InlineData("महिला", true)]
    [InlineData("स्त्रिया", true)]
    [InlineData("बाया", true)]
    [InlineData("Women", true)]
    [InlineData("workers", true)]
    [InlineData("संतू", false)]
    [InlineData("संतु रोकडे", false)]
    [InlineData("काका", false)]
    [InlineData("सुमन बाई", false)]
    [InlineData("", false)]
    public void IsCrowdLabel_TellsACrowdFromAName(string name, bool crowd) =>
        Assert.Equal(crowd, LabourRowGuard.IsCrowdLabel(name));

    [Fact]
    public void TheLiveShape_TwoRowsNamedBaykaAndPurush_BecomeWomen5AndMen2_WithNoNames()
    {
        // What the live parse produced for the founder's sentence: two rows, the crowd words as names.
        const string json = """
            {"fullTranscript":"5 बायका आणि 2 पुरुष छाटणीला होते","labour":[
              {"type":"HIRED","count":5,"workerNames":["बायका"],"notes":"बायका","activity":"pruning","sourceText":"5 बायका"},
              {"type":"HIRED","count":2,"workerNames":["पुरुष"],"notes":"पुरुष","activity":"pruning","sourceText":"2 पुरुष"}]}
            """;

        var root = Normalize(json);
        var women = Row(root, 0);
        var men = Row(root, 1);

        Assert.False(women.ContainsKey("workerNames"));
        Assert.False(women.ContainsKey("notes"));
        Assert.Equal(5, women["femaleCount"]!.GetValue<int>());
        Assert.Equal(5, women["count"]!.GetValue<int>());
        Assert.Equal("female", women["gender"]!.GetValue<string>());

        Assert.False(men.ContainsKey("workerNames"));
        Assert.Equal(2, men["maleCount"]!.GetValue<int>());
        Assert.Equal("male", men["gender"]!.GetValue<string>());
    }

    [Fact]
    public void OneRowListingBothCrowds_TakesTheSpokenSplit_AndNeverInventsATotal()
    {
        // The model counted the two crowd words as two people.
        const string json = """
            {"labour":[{"type":"HIRED","count":2,"workerNames":["बायका","पुरुष"],"activity":"pruning",
              "sourceText":"5 बायका आणि 2 पुरुष छाटणीला होते"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("workerNames"));
        Assert.Equal(5, row["femaleCount"]!.GetValue<int>());
        Assert.Equal(2, row["maleCount"]!.GetValue<int>());
        Assert.Equal("mixed", row["gender"]!.GetValue<string>());
        Assert.False(row.ContainsKey("count")); // 7 was never said; the app's rule reads the split
    }

    [Fact]
    public void AModelTotalOfBothCrowds_IsSplitBack_WhenTheTotalWasNotSaid()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":7,"activity":"pruning","sourceText":"5 बायका आणि 2 पुरुष छाटणीला होते"}]}
            """;

        var row = Row(Normalize(json));

        Assert.Equal(5, row["femaleCount"]!.GetValue<int>());
        Assert.Equal(2, row["maleCount"]!.GetValue<int>());
        Assert.False(row.ContainsKey("count"));
    }

    [Fact]
    public void ATotalHeSaidHimself_IsKept()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":7,"activity":"pruning","sourceText":"7 जण होते, 5 बायका आणि 2 पुरुष"}]}
            """;

        var row = Row(Normalize(json));

        Assert.Equal(7, row["count"]!.GetValue<int>());
        Assert.Equal(5, row["femaleCount"]!.GetValue<int>());
        Assert.Equal(2, row["maleCount"]!.GetValue<int>());
    }

    [Fact]
    public void ACrowdWithNoNumber_GivesGender_AndDropsTheNameTally()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":1,"workerNames":["बायका"],"activity":"weeding","sourceText":"बायका आल्या होत्या"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("workerNames"));
        Assert.False(row.ContainsKey("count"));
        Assert.False(row.ContainsKey("femaleCount"));
        Assert.Equal("female", row["gender"]!.GetValue<string>());
    }

    [Fact]
    public void ANumberSaidWithANeutralCrowd_IsKept()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":1,"workerNames":["मजूर"],"sourceText":"1 मजूर आला होता"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("workerNames"));
        Assert.Equal(1, row["count"]!.GetValue<int>());
    }

    [Fact]
    public void RealNamesStay_OnlyTheCrowdWordGoes()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":3,"workerNames":["संतू","काका","बायका"],"notes":"संतू, काका, बायका",
              "sourceText":"संतू, काका आणि 1 बायका आल्या"}]}
            """;

        var row = Row(Normalize(json));

        Assert.Equal(new[] { "संतू", "काका" }, row["workerNames"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
        Assert.Equal("संतू, काका", row["notes"]!.GetValue<string>());
        Assert.Equal(3, row["count"]!.GetValue<int>()); // he said "1 बायका": the count is not a name tally
        // The crowd is only part of this row: its gender is not the row's.
        Assert.False(row.ContainsKey("gender"));
        Assert.False(row.ContainsKey("femaleCount"));
    }

    [Fact]
    public void ANameTallyThatCountedACrowdAsOnePerson_IsNotACount()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":2,"workerNames":["संतू","बायका"],"sourceText":"संतू आणि बायका आल्या"}]}
            """;

        var row = Row(Normalize(json));

        Assert.Equal(new[] { "संतू" }, row["workerNames"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
        Assert.False(row.ContainsKey("count"));
    }

    [Fact]
    public void ANamedAttendanceRow_IsUntouched()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":3,"workerNames":["विलास जाधव","संतू रोकडे","काका"],"notes":"विलास जाधव, संतू रोकडे, काका","sourceText":"विलास जाधव, संतू रोकडे आणि काका आले होते"}]}
            """;

        var row = Row(Normalize(json));

        Assert.Equal(3, row["workerNames"]!.AsArray().Count);
        Assert.Equal(3, row["count"]!.GetValue<int>());
        Assert.False(row.ContainsKey("gender"));
    }

    [Fact]
    public void TwoRowsSharingOneLongPhrase_EachGetsOnlyItsOwnGender()
    {
        const string json = """
            {"labour":[
              {"type":"HIRED","count":5,"sourceText":"5 बायका आणि 2 पुरुष छाटणीला होते"},
              {"type":"HIRED","count":2,"sourceText":"5 बायका आणि 2 पुरुष छाटणीला होते"}]}
            """;

        var root = Normalize(json);

        Assert.Equal(5, Row(root, 0)["femaleCount"]!.GetValue<int>());
        Assert.False(Row(root, 0).ContainsKey("maleCount"));
        Assert.Equal(2, Row(root, 1)["maleCount"]!.GetValue<int>());
        Assert.False(Row(root, 1).ContainsKey("femaleCount"));
    }

    // ---------------------------------------------------------------- F23: 0 is not a count

    [Fact]
    public void ACountOfZero_IsRemoved_NotShownAsZero()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":0,"activity":"pruning","sourceText":"मजुरांनी छाटणी केली"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("count"));
        Assert.Equal("pruning", row["activity"]!.GetValue<string>());
    }

    [Fact]
    public void ZeroSplitCounts_AreRemovedToo_SoTheHeadcountRuleSeesUnknown()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":0,"maleCount":0,"femaleCount":0,"activity":"weeding","sourceText":"खुरपणी केली"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("count"));
        Assert.False(row.ContainsKey("maleCount"));
        Assert.False(row.ContainsKey("femaleCount"));
    }

    [Fact]
    public void AZeroBesideARealSplit_LeavesTheSplit()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":0,"maleCount":4,"femaleCount":2,"sourceText":"4 भाऊ आणि 2 बायका होत्या"}]}
            """;

        var row = Row(Normalize(json));

        Assert.False(row.ContainsKey("count"));
        Assert.Equal(4, row["maleCount"]!.GetValue<int>());
        Assert.Equal(2, row["femaleCount"]!.GetValue<int>());
    }

    [Fact]
    public void NobodyCame_AsAZeroRow_BecomesTheObservationThePromptAsksFor()
    {
        const string json = """
            {"fullTranscript":"आज कामाला कोणी आलं नाही","labour":[{"type":"HIRED","count":0,"sourceText":"आज कामाला कोणी आलं नाही"}],"observations":[]}
            """;

        var root = Normalize(json);

        Assert.Empty(root["labour"]!.AsArray());
        var note = root["observations"]!.AsArray().Single()!.AsObject();
        Assert.Equal("observation", note["noteType"]!.GetValue<string>());
        Assert.Equal("आज कामाला कोणी आलं नाही", note["textRaw"]!.GetValue<string>());
        Assert.True(note["provenanceVerified"]!.GetValue<bool>());
    }

    [Fact]
    public void AZeroWithHoursOrMoney_IsRealLabour_NeverTurnedIntoANote()
    {
        const string json = """
            {"labour":[{"type":"HIRED","count":0,"hours":4,"sourceText":"काम झालं नाही पूर्ण, 4 तास"}]}
            """;

        var root = Normalize(json);

        var row = Row(root);
        Assert.False(row.ContainsKey("count"));
        Assert.Equal(4, row["hours"]!.GetValue<int>());
    }

    [Fact]
    public void APositiveCount_IsNeverTouched()
    {
        const string json = """{"labour":[{"type":"HIRED","count":4,"activity":"tillage","sourceText":"चार जणांनी नांगरून घेतले"}]}""";

        var row = Row(Normalize(json));

        Assert.Equal(4, row["count"]!.GetValue<int>());
        Assert.False(row.ContainsKey("gender"));
    }

    // ---------------------------------------------------------------- spray water is the spray's

    [Fact]
    public void TheSameLitresAsTheSpraysTankWater_IsTaggedSprayCarrier_NotWatering()
    {
        const string json = """
            {"inputs":[{"productName":"Ethrel","method":"Spray","carrierVolume":400,"carrierUnit":"L","sourceText":"इथरेल 300 मिली फवारणी केली, पाणी 400 लिटर वापरलं"}],
             "irrigation":[{"waterVolumeLitres":400,"sourceText":"पाणी 400 लिटर वापरलं"}]}
            """;

        var water = Normalize(json)["irrigation"]!.AsArray().Single()!.AsObject();

        Assert.Equal("spray-carrier", water["role"]!.GetValue<string>());
    }

    [Theory]
    [InlineData("""{"waterVolumeLitres":400,"durationHours":2}""")] // real watering, with hours
    [InlineData("""{"waterVolumeLitres":1000}""")] // a different volume
    [InlineData("""{"waterVolumeLitres":400,"role":"irrigation"}""")] // a role already said
    public void OtherWater_IsLeftAlone(string irrigationRow)
    {
        var json = """{"inputs":[{"productName":"Ethrel","method":"Spray","carrierVolume":400,"carrierUnit":"लिटर"}],"irrigation":[""" +
                   irrigationRow + "]}";

        var water = Normalize(json)["irrigation"]!.AsArray().Single()!.AsObject();

        Assert.NotEqual("spray-carrier", water["role"]?.GetValue<string>());
    }

    // ---------------------------------------------------------------- prompt + few-shot (v3.7)

    private static IEnumerable<JsonElement> FewShotOutputs()
    {
        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            var idx = example.IndexOf("Output: ", StringComparison.Ordinal);
            using var doc = JsonDocument.Parse(example[(idx + "Output: ".Length)..].Trim());
            yield return doc.RootElement.Clone();
        }
    }

    private static string? InputOf(string example)
    {
        var start = example.IndexOf("Input: \"", StringComparison.Ordinal);
        if (start < 0)
        {
            return null;
        }

        start += "Input: \"".Length;
        return example[start..example.IndexOf('"', start)];
    }

    private static JsonElement OutputFor(string input)
    {
        var example = MarathiPromptData.FewShotExamples.Single(e => InputOf(e) == input);
        var idx = example.IndexOf("Output: ", StringComparison.Ordinal);
        using var doc = JsonDocument.Parse(example[(idx + "Output: ".Length)..].Trim());
        return doc.RootElement.Clone();
    }

    [Fact]
    public void NoFewShot_TeachesALabourCountOfZero_OrACrowdWordAsAName()
    {
        foreach (var output in FewShotOutputs())
        {
            if (!output.TryGetProperty("labour", out var labour))
            {
                continue;
            }

            foreach (var row in labour.EnumerateArray())
            {
                foreach (var key in new[] { "count", "maleCount", "femaleCount" })
                {
                    if (row.TryGetProperty(key, out var n))
                    {
                        Assert.True(n.GetInt32() > 0, $"A few-shot teaches {key} 0: {row}");
                    }
                }

                if (row.TryGetProperty("workerNames", out var names))
                {
                    Assert.DoesNotContain(names.EnumerateArray(), n => LabourRowGuard.IsCrowdLabel(n.GetString()));
                }
            }
        }
    }

    [Fact]
    public void FewShot_WomenAndMen_IsOneRowWithTheSplitAndNoTotal()
    {
        var row = OutputFor("5 बायका आणि 2 पुरुष छाटणीला होते.").GetProperty("labour").EnumerateArray().Single();

        Assert.Equal(5, row.GetProperty("femaleCount").GetInt32());
        Assert.Equal(2, row.GetProperty("maleCount").GetInt32());
        Assert.Equal("mixed", row.GetProperty("gender").GetString());
        Assert.False(row.TryGetProperty("count", out _));
        Assert.False(row.TryGetProperty("workerNames", out _));
    }

    [Fact]
    public void FewShot_NobodyCame_IsAnObservation_NotALabourRow()
    {
        var output = OutputFor("आज कामाला कोणी आलं नाही.");

        Assert.Equal(0, output.GetProperty("labour").GetArrayLength());
        Assert.Equal("observation", output.GetProperty("observations")[0].GetProperty("noteType").GetString());
    }

    [Fact]
    public void FewShot_SprayTankWater_RidesOnTheInput_AndIsNotIrrigation()
    {
        var output = OutputFor("आज इथरेल 300 मिली फवारणी केली, पाणी 400 लिटर वापरलं.");
        var input = output.GetProperty("inputs").EnumerateArray().Single();

        Assert.Equal(400, input.GetProperty("carrierVolume").GetInt32());
        Assert.Equal("L", input.GetProperty("carrierUnit").GetString());
        Assert.Equal("Spray", input.GetProperty("method").GetString());
        Assert.Equal(0, output.GetProperty("irrigation").GetArrayLength());
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void BothPromptPaths_CarryTheCrowdWordAndZeroRules(bool modular)
    {
        var builder = new AiPromptBuilder(
            new AiPromptTemplateRegistry(),
            Options.Create(new AiPromptOptions { UseModularPrompt = modular }));

        var prompt = builder.BuildVoiceParsingPrompt(new VoiceParseContext(
            AvailableCrops: [new CropInfo("crop-1", "Grapes", [])],
            Profile: new FarmerProfileInfo(
                Motors: [],
                WaterResources: [],
                Machineries: [],
                LedgerDefaults: new LedgerDefaultsInfo(new IrrigationDefaultInfo("drip", 45), new LabourDefaultInfo(450m))),
            FarmContext: null,
            FocusCategory: null,
            VocabDb: null));

        Assert.Contains(modular ? "CROWD_AS_NAME" : "A CROWD WORD IS NOT A NAME", prompt, StringComparison.Ordinal);
        Assert.Contains(modular ? "ZERO_AS_UNKNOWN" : "NEVER write 0 for \"not said\"", prompt, StringComparison.Ordinal);
        Assert.Contains("carrierVolume", prompt, StringComparison.Ordinal);
        Assert.Contains("5 बायका आणि 2 पुरुष छाटणीला होते", prompt, StringComparison.Ordinal);
    }

    // ---------------------------------------------------------------- V-1: a cut-off answer is a failure

    [Fact]
    public async Task SarvamChat_AnswerCutOffAtTheTokenLimit_IsAFailure_NotAnEmptyParse()
    {
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"choices\":[{\"finish_reason\":\"length\",\"message\":{\"content\":\"{\\\"labour\\\":[{\\\"count\\\":5\"}}]}",
                Encoding.UTF8,
                "application/json")
        });
        var chat = new SarvamChatClient(Options.Create(ChatOptions()), new StaticHttpClientFactory(new HttpClient(handler)), NullLogger<SarvamChatClient>.Instance);

        var result = await chat.CompleteAsync("system", "user", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SarvamChatClient.CutOffError, result.Error);
    }

    [Fact]
    public async Task SarvamChat_AFinishedAnswer_StillSucceeds()
    {
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"{\\\"summary\\\":\\\"ok\\\"}\"}}]}",
                Encoding.UTF8,
                "application/json")
        });
        var chat = new SarvamChatClient(Options.Create(ChatOptions()), new StaticHttpClientFactory(new HttpClient(handler)), NullLogger<SarvamChatClient>.Instance);

        var result = await chat.CompleteAsync("system", "user", CancellationToken.None);

        Assert.True(result.IsSuccess);
    }

    private static SarvamOptions ChatOptions() => new()
    {
        ApiSubscriptionKey = "k-test",
        ChatEndpoint = "https://unit.test/chat",
        ChatModel = "sarvam-test",
        TimeoutSeconds = 5
    };
}
