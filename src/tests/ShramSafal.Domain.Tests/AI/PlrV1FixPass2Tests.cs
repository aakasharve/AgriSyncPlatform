using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using ShramSafal.Infrastructure.AI;
using ShramSafal.Infrastructure.Integrations.Sarvam;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// PLR lanes V-1 + AI-2 FIX PASS 2 (after the second live run, 2026-10-31). No AI is called here.
///
/// Live: a segment planned at ~547 transcript tokens produced 3721 completion tokens and was CUT OFF — the answer is
/// about 7x its transcript, not 3x. So: (a) a cut-off segment is split in half (depth 3, min ~60 tokens), still all or
/// nothing; (b) the plan uses ratio 8.0; (c) the log carries the API's usage and a census of the answer; (d) a fake
/// chat that cuts off at a token budget proves bisection converges, keeps order, and fails whole when it must.
/// Corrections: the guard is tested against MANY bad-answer shapes per live sentence, not one replay.
/// </summary>
public sealed class PlrV1FixPass2Tests
{
    /// <summary>The live numbers: ~7 answer tokens per estimated transcript token, cut off at 3721.</summary>
    private const double LiveRatio = 7.0;
    private const int LiveCap = 3721;

    // =====================================================================================================
    // (a) + (d) bisection
    // =====================================================================================================

    [Fact]
    public async Task With_the_old_plan_cut_off_segments_are_split_until_they_fit_and_every_sentence_comes_back_in_order()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var chat = new BudgetChat(LiveRatio, LiveCap);

        // 549 transcript tokens a segment: what the live run planned (and was cut off with).
        var result = await ChunkedStructuring.StructureAsync(transcript, 549, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.True(chat.CutOffs > 0, "the old plan should have been cut off at least once");
        Assert.Equal(Sentences(transcript), Notes(result.Content!)); // every sentence, once, in the order he said them
    }

    [Fact]
    public async Task With_the_measured_ratio_nothing_is_cut_off_and_no_call_is_wasted()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var chat = new BudgetChat(LiveRatio, LiveCap);
        var budget = new StructuringBudget(4096).SegmentTokens;

        var result = await ChunkedStructuring.StructureAsync(transcript, budget, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(0, chat.CutOffs);
        Assert.Equal(ChunkedStructuring.Segment(transcript, budget).Count, chat.Calls);
        Assert.Equal(Sentences(transcript), Notes(result.Content!));
    }

    [Fact]
    public async Task Even_a_ratio_much_worse_than_measured_converges_by_splitting()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var chat = new BudgetChat(ratio: 20.0, cap: LiveCap);

        var result = await ChunkedStructuring.StructureAsync(transcript, new StructuringBudget(4096).SegmentTokens, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.True(chat.CutOffs > 0);
        Assert.Equal(Sentences(transcript), Notes(result.Content!));
    }

    [Fact]
    public async Task A_whole_transcript_whose_answer_is_cut_off_is_split_too()
    {
        var transcript = string.Join(" ", PlrV1FixPassTests.TenMinuteTranscript().Split('।').Take(14).Select(s => s.Trim() + "।"));
        var chat = new BudgetChat(LiveRatio, cap: 2500);

        var result = await ChunkedStructuring.StructureAsync(transcript, int.MaxValue / 2, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.True(chat.CutOffs >= 1);
        Assert.Equal(Sentences(transcript), Notes(result.Content!));
    }

    [Fact]
    public async Task A_correction_cut_off_is_never_split_it_fails()
    {
        var chat = new BudgetChat(LiveRatio, cap: 100);

        var result = await ChunkedStructuring.StructureAsync("इथरेल 350 नाही, 400 मिली. पाणी 2 तास नव्हतं, 3 तास दिलं.", int.MaxValue, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None, allowSplit: false);

        Assert.False(result.IsSuccess);
        Assert.Equal(1, chat.Calls);
    }

    [Fact]
    public async Task Splitting_stops_at_depth_three_and_then_the_whole_parse_fails_never_partly()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var segments = ChunkedStructuring.Segment(transcript, new StructuringBudget(4096).SegmentTokens);
        var fourth = segments[3].Trim();
        // A sentence said only once (the fixture repeats its plain sentences every minute): any piece holding it is
        // always cut off, however small.
        var poison = Sentences(fourth).First(s => transcript.Split(s).Length == 2);
        var chat = new BudgetChat(LiveRatio, LiveCap, alwaysCutOff: text => text.Contains(poison, StringComparison.Ordinal));

        var result = await ChunkedStructuring.StructureAsync(transcript, new StructuringBudget(4096).SegmentTokens, chat.AnswerAsync, NullLogger.Instance, CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Content);
        Assert.Contains($"part 4 of {segments.Count}", result.Error, StringComparison.Ordinal);
        Assert.Contains(SarvamChatClient.CutOffError, result.Error, StringComparison.Ordinal);
        Assert.Contains(AiErrorMarkers.NoRetry, result.Error, StringComparison.Ordinal);
        // The piece holding that sentence is tried once at each depth — the segment, then one half per split, three
        // splits at most — and never once more.
        Assert.Equal(ChunkedStructuring.MaxBisectDepth + 1, chat.CallsContaining(poison));
    }

    [Fact]
    public void Marathi_number_words_are_read_as_one_number()
    {
        Assert.Equal(new HashSet<decimal> { 350, 400 }, CorrectionGuard.NumbersIn("इथरेल तीनशे पन्नास नाही, चारशे मिली"));
        Assert.Equal(new HashSet<decimal> { 350 }, CorrectionGuard.NumbersIn("साडेतीनशे मिली"));
        Assert.Equal(new HashSet<decimal> { 150, 6 }, CorrectionGuard.NumbersIn("दीडशे ग्रॅम, सहा बायका"));
        Assert.Equal(new HashSet<decimal> { 2, 3 }, CorrectionGuard.NumbersIn("पाणी २ तास नव्हतं, तीन तास दिलं"));
    }

    [Theory]
    [InlineData(300)]
    [InlineData(120)]
    [InlineData(70)]
    public void A_split_is_two_halves_that_are_the_text_cut_at_a_sentence_end_near_the_middle(int targetTokens)
    {
        var text = string.Concat(PlrV1FixPassTests.TenMinuteTranscript().Split('।').Select(s => s.Trim() + "। ")).Trim();
        while (StructuringBudget.EstimateTokens(text) > targetTokens)
        {
            var shorter = text[..text.LastIndexOf('।', text.Length - 2)].Trim() + "।";
            if (StructuringBudget.EstimateTokens(shorter) <= ChunkedStructuring.MinBisectTokens)
            {
                break; // still big enough to be split
            }

            text = shorter;
        }

        var halves = ChunkedStructuring.SplitInHalf(text);

        Assert.NotNull(halves);
        Assert.Equal(Normalize(text), Normalize(halves!.Value.First + " " + halves.Value.Second));
        Assert.EndsWith("।", halves.Value.First);
    }

    [Fact]
    public void A_piece_of_sixty_tokens_or_less_is_not_split_again()
    {
        Assert.Null(ChunkedStructuring.SplitInHalf("आज पाणी दिलं। छाटणी केली।"));
    }

    [Fact]
    public async Task Through_the_sarvam_provider_a_cut_off_segment_is_recovered_and_the_answer_is_whole()
    {
        var transcript = PlrV1FixPassTests.TenMinuteTranscript();
        var chat = new BudgetChat(ratio: 20.0, cap: LiveCap);
        var provider = SarvamProvider(chat);

        var result = await provider.ParseVoiceAsync(new MemoryStream(Encoding.UTF8.GetBytes(transcript)), "text/plain", "mr-IN", "system", CancellationToken.None);

        Assert.True(result.Success, result.Error);
        Assert.True(chat.CutOffs > 0);
        var root = JsonNode.Parse(result.NormalizedJson!)!;
        Assert.Equal(Sentences(transcript), root["observations"]!.AsArray().Select(n => n!["textRaw"]!.GetValue<string>()).ToList());
        Assert.Equal(transcript.Trim(), root["fullTranscript"]!.GetValue<string>());
    }

    // =====================================================================================================
    // (b) the plan, (c) what the API says and what the answer is made of
    // =====================================================================================================

    [Fact]
    public void The_plan_uses_the_measured_ratio_and_fits_under_the_live_cut_off()
    {
        Assert.Equal(8.0, StructuringBudget.AnswerTokensPerSpokenToken);
        var segment = new StructuringBudget(4096).SegmentTokens;
        Assert.True(StructuringBudget.PredictedAnswerTokens(segment) <= LiveCap);
        // Even at the ratio actually seen live (about 7, itself cut off) a planned segment's answer fits.
        Assert.True(400 + (segment * LiveRatio) < LiveCap);
    }

    [Fact]
    public void The_census_reads_a_cut_off_answer_counts_and_sizes_only()
    {
        const string cut = """{"dayOutcome":"WORK_RECORDED","observations":[{"noteType":"observation","textRaw":"पानांवर डाग","textCleaned":"पानांवर डाग दिसले","sourceText":"पानांवर डाग दिसले","systemInterpretation":"डाग दिसले"},{"noteType":"issue","textRaw":"मोटर बंद","sourceText":"मोटर बं""";

        var census = AnswerCensus.Describe(cut);

        Assert.Contains("observations 2", census, StringComparison.Ordinal);
        Assert.Contains("sourceText 1x", census, StringComparison.Ordinal); // the second was cut mid-word
        Assert.Contains("textRaw 2x", census, StringComparison.Ordinal);
        Assert.Contains("textCleaned 1x", census, StringComparison.Ordinal);
        Assert.Contains("systemInterpretation 1x", census, StringComparison.Ordinal);
        Assert.DoesNotContain("पानांवर", census, StringComparison.Ordinal); // never his words in the log
    }

    [Fact]
    public async Task A_cut_off_chat_answer_carries_the_usage_and_the_cut_answer_for_the_log()
    {
        var handler = new StubHttpMessageHandler(_ => new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new StringContent(
                """{"choices":[{"finish_reason":"length","message":{"content":"{\"observations\":[{\"textRaw\":\"x\"","reasoning_content":"thinking"}}],"usage":{"prompt_tokens":28900,"completion_tokens":3721,"total_tokens":32621}}""",
                Encoding.UTF8,
                "application/json"),
        });
        var chat = new SarvamChatClient(Microsoft.Extensions.Options.Options.Create(TestOptions()), new StaticHttpClientFactory(new HttpClient(handler)), NullLogger<SarvamChatClient>.Instance);

        var result = await chat.CompleteAsync("system", "user", CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(SarvamChatClient.CutOffError, result.Error);
        Assert.Contains("\"prompt_tokens\":28900", result.Usage, StringComparison.Ordinal);
        Assert.Contains("\"completion_tokens\":3721", result.Usage, StringComparison.Ordinal);
        Assert.Contains("textRaw", result.PartialContent, StringComparison.Ordinal);
        Assert.Equal(8, result.ReasoningChars);
    }

    // =====================================================================================================
    // Corrections — many answer shapes per live sentence
    // =====================================================================================================

    private const string EthrelEntry = """{"inputs":[{"productName":"इथरेल","type":"other","method":"Spray","quantity":350,"unit":"ml","carrierMedium":"water","carrierVolume":400,"carrierUnit":"L"}]}""";
    private const string EthrelEntryEnglish = """{"inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","type":"other","method":"Spray","quantity":350,"unit":"ml","carrierMedium":"water","carrierVolume":400,"carrierUnit":"L"}]}""";
    private const string WaterEntry = """{"irrigation":[{"method":"Drip","durationHours":2}],"cropActivities":[{"title":"छाटणी"}]}""";
    private const string LabourEntry = """{"labour":[{"type":"HIRED","gender":"female","femaleCount":5}]}""";
    private const string BavistinEntry = """{"inputs":[{"productName":"बाविस्टीन","type":"fungicide","method":"Spray","quantity":200,"unit":"g"}]}""";
    private const string BavistinEntryEnglish = """{"inputs":[{"productName":"Bavistin","rawProductName":"बाविस्टीन","type":"fungicide","method":"Spray","quantity":200,"unit":"g"}]}""";

    public static TheoryData<string, string, string> EthrelShapes()
    {
        string[] words = ["इथरेल 350 नाही, 400 मिली", "इथ्रेल ३५० नाही, ४०० मिली", "इथरेल तीनशे पन्नास नाही, 400 मिली"];
        string[] answers =
        [
            """{"inputs":[{"productName":"Ethrel","rawProductName":"इथरेल","quantity":400,"unit":"ml"}]}""",
            """{"inputs":[{"productName":"Ethrel","quantity":400,"unit":"मिली","method":"Spray","type":"pgr"}],"observations":[]}""",
            """{"inputs":[{"productName":"इथ्रेल","quantity":400}]}""",
            """{"inputs":[{"productName":"Ethrel","quantity":400,"unit":"ml","notes":"corrected from 350"}],"observations":[{"noteType":"observation","textRaw":"इथरेल 350 नाही, 400 मिली"}]}""",
            """{"inputs":[{"productName":"ethrel","quantity":"400","unit":"ml","carrierVolume":0,"reason":"unknown"}],"unclearSegments":[{"rawText":"इथरेल 350 नाही"}]}""",
            """{"inputs":[{"productName":"Ethrel","quantity":400,"unit":"ml","method":"unknown","carrierMedium":"n/a"}],"observations":[{"noteType":"issue","textRaw":"Ethrel dose was 400 ml, not 350"}]}""",
            """{"inputs":[{"productName":"","rawProductName":"इथरेल","quantity":400,"carrierUnit":"none"}]}""",
        ];
        var data = new TheoryData<string, string, string>();
        foreach (var entry in new[] { EthrelEntry, EthrelEntryEnglish })
        {
            foreach (var said in words)
            {
                foreach (var answer in answers)
                {
                    data.Add(entry, said, answer);
                }
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(EthrelShapes))]
    public void Ethrel_350_not_400_ml_whatever_the_answer_shape(string entry, string words, string answer)
    {
        var guarded = Guard(entry, words, answer);
        var saved = JsonNode.Parse(entry)!["inputs"]![0]!;

        var row = Assert.Single(guarded["inputs"]!.AsArray())!.AsObject();
        Assert.Equal(saved["productName"]!.GetValue<string>(), row["productName"]!.GetValue<string>());
        Assert.Equal(400m, Number(row["quantity"]));
        Assert.Equal("ml", row["unit"]!.GetValue<string>());
        Assert.Equal("Spray", row["method"]!.GetValue<string>());
        Assert.Equal("other", row["type"]!.GetValue<string>());
        Assert.Equal("water", row["carrierMedium"]!.GetValue<string>());
        Assert.Equal(400m, Number(row["carrierVolume"]));
        Assert.Equal("L", row["carrierUnit"]!.GetValue<string>());
        Assert.False(row.ContainsKey("notes"));
        Assert.False(row.ContainsKey("reason"));
        NoNotes(guarded);
    }

    public static TheoryData<string, string> WaterShapes()
    {
        string[] words = ["पाणी 2 तास नव्हतं, 3 तास दिलं", "पाणी दोन तास नव्हतं, तीन तास दिलं", "पाणी 2 तास नाही 3 तास दिलं"];
        string[] answers =
        [
            """{"irrigation":[{"method":"Drip","durationHours":3,"notes":"reduced from 2h"}],"observations":[{"noteType":"observation","textRaw":"पाणी 2 तास नव्हतं, 3 तास दिलं"}]}""",
            """{"irrigation":[{"method":"Flood","durationHours":3,"source":"unknown"}],"observations":[{"noteType":"issue","textRaw":"पाणी 2 तास नव्हतं"}]}""",
            """{"irrigation":[{"durationHours":3,"notes":"Water given 3 hours instead of 2"}],"unclearSegments":[{"rawText":"पाणी 2 तास नव्हतं"}]}""",
            """{"irrigation":[{"method":"Drip","durationHours":"3","waterVolumeLitres":0}],"observations":[{"noteType":"observation","textRaw":"Water was 3 hours, not 2"}]}""",
            """{"irrigation":[{"method":"Sprinkler","durationHours":3,"notes":"n/a"}],"plannedTasks":[{"title":"पाणी 3 तास द्यायचं"}]}""",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"observations":[{"noteType":"observation","textRaw":"पाणी दोन तास नव्हतं, तीन तास दिलं","textCleaned":"पाणी तीन तास दिले"}]}""",
        ];
        var data = new TheoryData<string, string>();
        foreach (var said in words)
        {
            foreach (var answer in answers)
            {
                data.Add(said, answer);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(WaterShapes))]
    public void Water_2_not_3_hours_whatever_the_answer_shape(string words, string answer)
    {
        var guarded = Guard(WaterEntry, words, answer);

        var row = Assert.Single(guarded["irrigation"]!.AsArray())!.AsObject();
        Assert.Equal("Drip", row["method"]!.GetValue<string>());
        Assert.Equal(3m, Number(row["durationHours"]));
        Assert.False(row.ContainsKey("notes"));
        Assert.False(row.ContainsKey("source"));
        Assert.False(row.ContainsKey("waterVolumeLitres"));
        NoNotes(guarded);
    }

    public static TheoryData<string, string> LabourShapes()
    {
        string[] words = ["5 बायका नाही, 6 बायका होत्या", "पाच बायका नाही, सहा बायका होत्या", "5 बायका नव्हत्या 6 बायका होत्या"];
        string[] answers =
        [
            """{"labour":[{"type":"HIRED","femaleCount":6,"gender":"female","activity":"unknown"}]}""",
            """{"labour":[{"femaleCount":6,"activity":"weeding","count":6}]}""",
            """{"labour":[{"type":"HIRED","gender":"female","femaleCount":6,"notes":"n/a","activity":"none"}],"observations":[{"textRaw":"5 बायका नाही, 6 बायका होत्या"}]}""",
            """{"labour":[{"type":"HIRED","gender":"unknown","femaleCount":6,"maleCount":0}]}""",
            """{"labour":[{"type":"HIRED","gender":"female","femaleCount":6,"activity":"","whoWorked":"UNKNOWN"}]}""",
        ];
        var data = new TheoryData<string, string>();
        foreach (var said in words)
        {
            foreach (var answer in answers)
            {
                data.Add(said, answer);
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(LabourShapes))]
    public void Five_women_not_six_whatever_the_answer_shape(string words, string answer)
    {
        var guarded = Guard(LabourEntry, words, answer);

        var row = Assert.Single(guarded["labour"]!.AsArray())!.AsObject();
        Assert.Equal("HIRED", row["type"]!.GetValue<string>());
        Assert.Equal("female", row["gender"]!.GetValue<string>());
        Assert.Equal(6m, Number(row["femaleCount"]));
        Assert.False(row.ContainsKey("activity"));
        Assert.False(row.ContainsKey("notes"));
        Assert.False(row.ContainsKey("maleCount"));
        Assert.False(row.ContainsKey("whoWorked"));
        if (row.ContainsKey("count"))
        {
            Assert.Equal(6m, Number(row["count"]));
        }

        NoNotes(guarded);
    }

    public static TheoryData<string, string, string> BavistinShapes()
    {
        string[] words =
        [
            "बाविस्टीन नव्हतं, साफ मारलं होतं",
            "बावीस्टिन नव्हतं, साफ मारलं होतं",
            "बाविस्टीन ऐवजी साफ फवारलं",
            "बाविस्टीन नाही, साफ वापरलं",
            "बाविस्टीन नको, साफ टाकलं होतं",
        ];
        string[] answers =
        [
            """{"inputs":[]}""",
            """{"observations":[{"noteType":"issue","textRaw":"बाविस्टीन नव्हतं"}]}""",
            """{"inputs":[{"productName":"Saaf","rawProductName":"साफ"}]}""",
            """{"inputs":[{"productName":"बाविस्टीन","quantity":200}]}""",
            """{"inputs":[{"productName":"Saaf"},{"productName":"बाविस्टीन","quantity":200}]}""",
            """{"inputs":[],"disturbance":{"reason":"material_shortage","note":"बाविस्टीन नव्हतं"}}""",
            """{"inputs":[{"productName":"साफ","method":"unknown","quantity":0}],"observations":[{"noteType":"observation","textRaw":"बाविस्टीन नव्हतं, साफ मारलं होतं"}]}""",
        ];
        var data = new TheoryData<string, string, string>();
        foreach (var entry in new[] { BavistinEntry, BavistinEntryEnglish })
        {
            foreach (var said in words)
            {
                foreach (var answer in answers)
                {
                    data.Add(entry, said, answer);
                }
            }
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(BavistinShapes))]
    public void Bavistin_was_not_it_was_saaf_whatever_the_answer_shape(string entry, string words, string answer)
    {
        var guarded = Guard(entry, words, answer);

        var row = Assert.Single(guarded["inputs"]!.AsArray())!.AsObject();
        Assert.Equal("साफ", row["productName"]!.GetValue<string>());
        if (row.ContainsKey("rawProductName"))
        {
            Assert.Equal("साफ", row["rawProductName"]!.GetValue<string>());
        }

        Assert.Equal("fungicide", row["type"]!.GetValue<string>());
        Assert.Equal("Spray", row["method"]!.GetValue<string>());
        Assert.Equal(200m, Number(row["quantity"]));
        Assert.Equal("g", row["unit"]!.GetValue<string>());
        Assert.False(row.ContainsKey("notes"));
        NoNotes(guarded);
        Assert.False(guarded.ContainsKey("disturbance"));
    }

    [Fact]
    public void A_new_product_he_adds_is_not_taken_for_the_entrys_row()
    {
        var guarded = Guard(EthrelEntry, "आणि बाविस्टीन पण 200 ग्रॅम मारलं", """{"inputs":[{"productName":"बाविस्टीन","quantity":200,"unit":"g"}]}""");

        var row = Assert.Single(guarded["inputs"]!.AsArray())!;
        Assert.Equal("बाविस्टीन", row["productName"]!.GetValue<string>());
        Assert.Equal(200m, Number(row["quantity"]));
    }

    [Fact]
    public void A_new_condition_said_with_the_correction_stays_a_note()
    {
        var guarded = Guard(WaterEntry, "पाणी 2 तास नव्हतं, 3 तास दिलं. पानांवर डाग दिसले.",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"observations":[{"noteType":"observation","textRaw":"पाणी 2 तास नव्हतं, 3 तास दिलं"},{"noteType":"issue","textRaw":"पानांवर डाग दिसले"}]}""");

        Assert.Equal("पानांवर डाग दिसले", Assert.Single(guarded["observations"]!.AsArray())!["textRaw"]!.GetValue<string>());
    }

    [Fact]
    public void A_plan_he_says_in_another_sentence_stays_even_when_it_sounds_like_the_correction()
    {
        var guarded = Guard(WaterEntry, "पाणी 2 तास नव्हतं, 3 तास दिलं. उद्या पण पाणी 3 तास द्यायचं.",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"plannedTasks":[{"title":"उद्या पण पाणी 3 तास द्यायचं"}]}""");

        Assert.Equal("उद्या पण पाणी 3 तास द्यायचं", Assert.Single(guarded["plannedTasks"]!.AsArray())!["title"]!.GetValue<string>());
    }

    [Fact]
    public void An_unrelated_no_is_not_a_correction_and_its_note_stays()
    {
        var guarded = Guard(WaterEntry, "पाणी 2 तास नव्हतं, 3 तास दिलं. पाऊस आला नाही, जमीन कोरडी आहे.",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"observations":[{"noteType":"observation","textRaw":"पाऊस आला नाही, जमीन कोरडी आहे"}]}""");

        Assert.Single(guarded["observations"]!.AsArray());
    }

    [Fact]
    public void Placeholders_are_dropped_from_a_brand_new_row_too()
    {
        var guarded = Guard(WaterEntry, "पाणी 2 तास नव्हतं, 3 तास दिलं, आणि छाटणी केली",
            """{"irrigation":[{"method":"Drip","durationHours":3}],"cropActivities":[{"title":"छाटणी","notes":"unknown","workTypes":["Pruning"]}],"labour":[{"type":"HIRED","activity":"unknown","notes":"no workers mentioned"}]}""");

        var crop = Assert.Single(guarded["cropActivities"]!.AsArray())!.AsObject();
        Assert.False(crop.ContainsKey("notes"));
        var labour = Assert.Single(guarded["labour"]!.AsArray())!.AsObject();
        Assert.False(labour.ContainsKey("activity"));
        Assert.False(labour.ContainsKey("notes"));
    }

    // =====================================================================================================
    // helpers
    // =====================================================================================================

    private static JsonObject Guard(string entry, string words, string answer)
    {
        using var doc = JsonDocument.Parse(entry);
        return JsonNode.Parse(CorrectionGuard.Apply(answer, doc.RootElement, words))!.AsObject();
    }

    private static void NoNotes(JsonObject guarded)
    {
        foreach (var bucket in new[] { "observations", "unclearSegments", "plannedTasks" })
        {
            if (guarded[bucket] is JsonArray notes)
            {
                Assert.True(notes.Count == 0, $"{bucket} kept: {notes.ToJsonString()}");
            }
        }
    }

    private static decimal Number(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<decimal>(out var d) ? d
        : node is JsonValue s && s.TryGetValue<string>(out var text) ? decimal.Parse(text, System.Globalization.CultureInfo.InvariantCulture)
        : throw new Xunit.Sdk.XunitException($"not a number: {node?.ToJsonString() ?? "missing"}");

    private static List<string> Sentences(string transcript) =>
        transcript.Split('।', StringSplitOptions.RemoveEmptyEntries).Select(s => s.Trim()).Where(s => s.Length > 0).ToList();

    private static List<string> Notes(string content) =>
        JsonNode.Parse(content)!["observations"]!.AsArray().Select(n => n!["textRaw"]!.GetValue<string>()).ToList();

    private static string Normalize(string text) => string.Join(" ", text.Split(' ', StringSplitOptions.RemoveEmptyEntries));

    private static SarvamOptions TestOptions() => new()
    {
        ApiSubscriptionKey = "k-test",
        SttEndpoint = "https://unit.test/stt",
        ChatEndpoint = "https://unit.test/chat",
        ChatModel = "sarvam-test",
        TimeoutSeconds = 10,
        ChatTimeoutSeconds = 10,
    };

    private static SarvamAiProvider SarvamProvider(BudgetChat chat)
    {
        var options = Microsoft.Extensions.Options.Options.Create(TestOptions());
        var factory = new StaticHttpClientFactory(new HttpClient(new BudgetChatHandler(chat)));
        return new SarvamAiProvider(
            new SarvamSttClient(options, factory, NullLogger<SarvamSttClient>.Instance),
            new SarvamChatClient(options, factory, NullLogger<SarvamChatClient>.Instance),
            new SarvamVisionClient(options, factory, NullLogger<SarvamVisionClient>.Instance),
            options,
            new AiResponseNormalizer(),
            NullLogger<SarvamAiProvider>.Instance);
    }

    /// <summary>
    /// A structurer whose answer is <paramref name="ratio"/> tokens per estimated transcript token plus 400, cut off
    /// beyond <paramref name="cap"/> (the live behaviour). A full answer lists every sentence of its piece as an
    /// observation, so the merged answer shows whether anything was lost, repeated or reordered.
    /// </summary>
    private sealed class BudgetChat(double ratio, int cap, Func<string, bool>? alwaysCutOff = null)
    {
        private readonly System.Collections.Concurrent.ConcurrentBag<string> _calls = [];
        private int _cutOffs;
        private int _seed;

        public int Calls => _calls.Count;

        public int CutOffs => _cutOffs;

        public int CallsContaining(string text) => _calls.Count(c => c.Contains(text, StringComparison.Ordinal));

        public bool IsCutOff(string text) =>
            (alwaysCutOff?.Invoke(text) ?? false) || 400 + (StructuringBudget.EstimateTokens(text) * ratio) > cap;

        public string Answer(string text) => JsonSerializer.Serialize(new
        {
            dayOutcome = "WORK_RECORDED",
            observations = Sentences(text).Select(s => new { noteType = "observation", textRaw = s }).ToArray(),
        });

        public async Task<SegmentAnswer> AnswerAsync(string text, CancellationToken ct)
        {
            _calls.Add(text);
            await Task.Delay(Interlocked.Increment(ref _seed) % 3 * 7, ct); // finish out of order
            if (IsCutOff(text))
            {
                Interlocked.Increment(ref _cutOffs);
                return SegmentAnswer.CutOffAnswer(SarvamChatClient.CutOffError);
            }

            return SegmentAnswer.Ok(Answer(text));
        }

        public void CountCall(string text, bool cutOff)
        {
            _calls.Add(text);
            if (cutOff)
            {
                Interlocked.Increment(ref _cutOffs);
            }
        }
    }

    /// <summary>The same budgeted structurer at the HTTP edge of the Sarvam chat API.</summary>
    private sealed class BudgetChatHandler(BudgetChat chat) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            using var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(cancellationToken));
            var user = body.RootElement.GetProperty("messages")[1].GetProperty("content").GetString()!;
            var cutOff = chat.IsCutOff(user);
            chat.CountCall(user, cutOff);
            var choice = cutOff
                ? new { finish_reason = "length", message = new { content = "{\"observations\":[" } }
                : new { finish_reason = "stop", message = new { content = chat.Answer(user) } };
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    JsonSerializer.Serialize(new { choices = new[] { choice }, usage = new { completion_tokens = 1, prompt_tokens = 2 } }),
                    Encoding.UTF8,
                    "application/json"),
            };
        }
    }
}
