using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

// spec: 2026-08-28-labour-v2-release-1
//
// The app was writing down hired workers the farmer never mentioned.
// Two independent defects had to line up for that to happen, and each one is
// pinned separately below so neither can come back on its own.
//
//   (A) TryExtractCount matched Marathi number words by SUBSTRING.
//       एक ("one") sits inside एकटाच ("by myself"), एकरभर ("an acre") and
//       एकूण ("total"), so "मी एकटाच छाटणी केली" — I pruned by myself —
//       produced a count of 1.
//
//   (B) ApplyTranscriptIntegrityCorrections then ASSIGNED root["labour"],
//       so that guess replaced whatever the model had returned — including a
//       correct EMPTY array, which is a real answer meaning nobody was hired.
//
// The (A) tests hand the method JSON with the labour key ABSENT, so the
// gap-fill rule permits a write and only the word-boundary fix can keep the
// array empty.  The (B) tests use transcripts that contain REAL number words,
// so the word-boundary fix cannot help and only the no-overwrite rule can.
// Each group therefore fails if only the other half is applied.
public sealed class ParseVoiceLabourFabricationTests
{
    private static JsonObject Correct(string normalizedJson, string transcript)
    {
        var corrected = ParseVoiceInputHandler.ApplyTranscriptIntegrityCorrections(
            normalizedJson,
            transcript,
            domainKnowledgeLayerEnabled: false,
            domainKnowledgePipeline: null);

        return JsonNode.Parse(corrected)!.AsObject();
    }

    private static int LabourRowCount(JsonObject root) => (root["labour"] as JsonArray)?.Count ?? 0;

    // -------------------------------------------------------------------------
    // (A) Word boundaries — a longer word that merely CONTAINS a number word is
    //     not a number.  Labour key absent, so the heuristic is allowed to fill.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("मी एकटाच छाटणी केली")]   // "I pruned by myself"  — एकटाच, not एक
    [InlineData("एकरभर फवारणी केली")]      // "sprayed an acre"     — एकरभर, not एक
    [InlineData("एकूण खत टाकलं")]          // "total fertiliser applied" — एकूण, not एक
    public void A_word_that_merely_contains_a_number_word_never_creates_a_labour_row(string transcript)
    {
        // Labour key ABSENT: the gap-fill rule PERMITS a write here, so nothing
        // but the word-boundary fix can keep this array empty.
        const string modelReturnedNoLabourKey = "{}";

        var root = Correct(modelReturnedNoLabourKey, transcript);

        LabourRowCount(root).Should().Be(0,
            "the farmer named no workers — एकटाच / एकरभर / एकूण are not the number एक, " +
            "and inventing a HIRED worker here lands on the record that determines wages");
    }

    [Theory]
    [InlineData("मी एकटाच छाटणी केली")]
    [InlineData("एकरभर फवारणी केली")]
    [InlineData("एकूण खत टाकलं")]
    public void A_word_that_merely_contains_a_number_word_yields_no_count(string segment)
    {
        ParseVoiceInputHandler.TryExtractCount(segment).Should().BeNull(
            "number words must match as whole words, not as fragments of a longer word");
    }

    // -------------------------------------------------------------------------
    // (A') True positives — these pass BEFORE and AFTER the fix.  The table
    //      deliberately carries inflected and compound forms; restricting the
    //      match to word boundaries must not cost a single one of them.
    // -------------------------------------------------------------------------

    [Theory]
    [InlineData("चार माणसं आली", 4)]           // bare cardinal
    [InlineData("चौघांनी काम केलं", 4)]         // inflected collective
    [InlineData("पाचजणांनी तोडणी केली", 5)]     // compound + inflection (longest key)
    [InlineData("पाचजण आले", 5)]                // compound, uninflected
    [InlineData("दोघांनी छाटणी केली", 2)]        // inflected collective
    [InlineData("तिघे आले होते", 3)]            // short collective form
    [InlineData("सहाजणांनी नांगरणी केली", 6)]    // compound + inflection
    [InlineData("आज 7 मजूर आले", 7)]            // digit form
    public void Real_number_words_still_yield_their_count(string segment, int expected)
    {
        ParseVoiceInputHandler.TryExtractCount(segment).Should().Be(expected,
            "losing a true positive is a real cost — a farmer who says चौघांनी काम केलं must still get 4");
    }

    [Fact]
    public void A_real_worker_sentence_still_fills_a_genuinely_absent_labour_key()
    {
        // End-to-end proof that the word-boundary fix did not over-tighten:
        // number word + a recognised activity, with no model answer to defer to.
        const string modelReturnedNoLabourKey = "{}";
        const string transcript = "चौघांनी छाटणी केली.";

        var root = Correct(modelReturnedNoLabourKey, transcript);

        var labour = root["labour"] as JsonArray;
        labour.Should().NotBeNull();
        labour!.Count.Should().Be(1);
        labour[0]!["count"]!.GetValue<int>().Should().Be(4);
    }

    // -------------------------------------------------------------------------
    // (B) Never overwrite a real answer.  Every transcript below carries a REAL
    //     number word, so the word-boundary fix is no help — only the gap-fill
    //     rule keeps the model's answer intact.
    // -------------------------------------------------------------------------

    [Fact]
    public void An_empty_labour_array_from_the_model_stays_empty()
    {
        // An empty array is an ANSWER — "nobody was hired" — not an absence.
        const string modelAnsweredNobodyWasHired = """{ "labour": [] }""";
        const string transcript = "चार माणसांनी छाटणी केली.";

        var root = Correct(modelAnsweredNobodyWasHired, transcript);

        root["labour"].Should().BeOfType<JsonArray>();
        LabourRowCount(root).Should().Be(0,
            "the model answered 'none'; the heuristic may fill a gap but may never overrule an answer");
    }

    [Fact]
    public void Real_labour_from_the_model_is_left_untouched()
    {
        const string modelAnswered = """
            { "labour": [ { "type": "HIRED", "count": 2, "activity": "pruning", "sourceText": "छाटणी" } ] }
            """;
        const string transcript = "चार माणसांनी छाटणी केली.";

        var root = Correct(modelAnswered, transcript);

        var labour = root["labour"] as JsonArray;
        labour.Should().NotBeNull();
        labour!.Count.Should().Be(1, "the heuristic must not replace the model's rows with its own");
        labour[0]!["count"]!.GetValue<int>().Should().Be(2,
            "the model said 2; a transcript guess of 4 must not silently rewrite the wage record");
    }

    [Fact]
    public void The_gender_split_writer_also_defers_to_the_model()
    {
        // The second labour writer (male/female split) assigned root["labour"]
        // too, so it needs its own guard — and its own test.
        const string modelAnsweredNobodyWasHired = """{ "labour": [] }""";
        const string transcript = "चार पुरुष आणि दोन बायका कामावर होत्या.";

        var root = Correct(modelAnsweredNobodyWasHired, transcript);

        LabourRowCount(root).Should().Be(0,
            "the gender-split writer must fill a gap only, exactly like the compound-segment writer");
    }

    // -------------------------------------------------------------------------
    // (C) The remaining sibling: the fertilizer/irrigation writers riding on a
    //     compound labour segment. The farmer genuinely said खत or पाणी, so
    //     this is imprecise (no product/quantity) rather than invented — but it
    //     still overrides a real "none" answer from the model, so it needs the
    //     same gap-fill-only guard as (B) above.
    // -------------------------------------------------------------------------

    private static int InputsRowCount(JsonObject root) => (root["inputs"] as JsonArray)?.Count ?? 0;

    private static int IrrigationRowCount(JsonObject root) => (root["irrigation"] as JsonArray)?.Count ?? 0;

    [Fact]
    public void A_labour_sentence_mentioning_fertiliser_does_not_overwrite_a_real_empty_inputs_answer()
    {
        // An empty inputs array is an ANSWER — "no inputs were used" — not an
        // absence. The transcript names workers AND खत in the same sentence,
        // so the fertilizer writer would fire on the labour segment alone if
        // it were not gated on the model's own answer.
        const string modelAnsweredNoInputs = """{ "labour": [], "inputs": [] }""";
        const string transcript = "चार माणसांनी खत आणले.";

        var root = Correct(modelAnsweredNoInputs, transcript);

        root["inputs"].Should().BeOfType<JsonArray>();
        InputsRowCount(root).Should().Be(0,
            "the model answered 'no inputs'; a regex that merely saw खत in the sentence must not overrule that");
    }

    [Fact]
    public void A_labour_sentence_mentioning_irrigation_does_not_overwrite_a_real_empty_irrigation_answer()
    {
        const string modelAnsweredNoIrrigation = """{ "labour": [], "irrigation": [] }""";
        const string transcript = "चार माणसांनी पाणी सोडले.";

        var root = Correct(modelAnsweredNoIrrigation, transcript);

        root["irrigation"].Should().BeOfType<JsonArray>();
        IrrigationRowCount(root).Should().Be(0,
            "the model answered 'no irrigation'; a regex that merely saw पाणी in the sentence must not overrule that");
    }

    [Fact]
    public void Real_inputs_from_the_model_are_left_untouched_by_the_fertiliser_writer()
    {
        const string modelAnswered = """
            { "labour": [], "inputs": [ { "productName": "युरिया", "method": "Soil", "type": "fertilizer", "sourceText": "युरिया" } ] }
            """;
        const string transcript = "चार माणसांनी खत आणले.";

        var root = Correct(modelAnswered, transcript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();
        inputs!.Count.Should().Be(1, "the heuristic must not append its own generic खत row onto the model's answer");
        inputs[0]!["productName"]!.GetValue<string>().Should().Be("युरिया",
            "the model already named the real product; the heuristic guess must not replace or dilute it");
    }

    [Fact]
    public void A_fertiliser_labour_sentence_still_fills_a_genuinely_absent_inputs_key()
    {
        // Proof the gate did not over-tighten: with the inputs key truly
        // ABSENT (not answered at all), the gap-fill write must still fire.
        const string modelDidNotAnswerInputs = """{ "labour": [] }""";
        const string transcript = "चार माणसांनी खत आणले.";

        var root = Correct(modelDidNotAnswerInputs, transcript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();
        inputs!.Count.Should().Be(1, "the inputs key was genuinely absent, so the gap-fill write is legitimate here");
        inputs[0]!["productName"]!.GetValue<string>().Should().Be("खत");
    }
}
