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

    // -------------------------------------------------------------------------
    // (D) The last sibling: the STANDALONE ContainsFertilizerApplication safety
    //     net (no compound labour segment involved — it fires on खत + a
    //     past-tense verb alone). Same shape as (C): gated only on
    //     inputs.Count == 0, not on whether the model already answered, so it
    //     overrides a real "no inputs" answer exactly like the writers above.
    // -------------------------------------------------------------------------

    [Fact]
    public void A_standalone_fertiliser_verb_sentence_does_not_overwrite_a_real_empty_inputs_answer()
    {
        // No worker count in this transcript at all, so no compound labour
        // segment forms — only the standalone ContainsFertilizerApplication
        // net (खत + दिलं/दिले/घातले/टाकले) can fire here.
        const string modelAnsweredNoInputs = """{ "inputs": [] }""";
        const string transcript = "आज खत टाकले.";

        var root = Correct(modelAnsweredNoInputs, transcript);

        root["inputs"].Should().BeOfType<JsonArray>();
        InputsRowCount(root).Should().Be(0,
            "the model answered 'no inputs'; खत + टाकले alone must not overrule that");
    }

    [Fact]
    public void Real_inputs_from_the_model_are_left_untouched_by_the_standalone_fertiliser_net()
    {
        const string modelAnswered = """
            { "inputs": [ { "productName": "युरिया", "method": "Soil", "type": "fertilizer", "sourceText": "युरिया" } ] }
            """;
        const string transcript = "आज खत टाकले.";

        var root = Correct(modelAnswered, transcript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();
        inputs!.Count.Should().Be(1, "the standalone net must not append its own generic खत row onto the model's answer");
        inputs[0]!["productName"]!.GetValue<string>().Should().Be("युरिया",
            "the model already named the real product; the heuristic guess must not replace or dilute it");
    }

    [Fact]
    public void A_standalone_fertiliser_verb_sentence_still_fills_a_genuinely_absent_inputs_key()
    {
        // Proof the gate did not over-tighten: with the inputs key truly
        // ABSENT, the standalone net's gap-fill write must still fire.
        const string modelDidNotAnswerInputs = "{}";
        const string transcript = "आज खत टाकले.";

        var root = Correct(modelDidNotAnswerInputs, transcript);

        var inputs = root["inputs"] as JsonArray;
        inputs.Should().NotBeNull();
        inputs!.Count.Should().Be(1, "the inputs key was genuinely absent, so the gap-fill write is legitimate here");
        inputs[0]!["productName"]!.GetValue<string>().Should().Be("खत");
    }

    // -------------------------------------------------------------------------
    // (E) The last two siblings: ContainsIssueSignal (writes an "issue" note
    //     into observations[]) and ContainsFutureIntent (writes a "reminder"
    //     note into observations[] AND a row into plannedTasks[]). Both were
    //     gated on CONTENT — whether a matching noteType already existed, or
    //     whether plannedTasks was non-empty — never on whether the model
    //     answered at all. A model that deliberately returned
    //     "observations: []" / "plannedTasks: []" (nothing wrong, nothing
    //     planned) was overridden exactly like the labour/inputs/irrigation
    //     writers were, just one layer further from the wage number. Same
    //     gap-fill-only guard, same shape: modelAnsweredObservations /
    //     modelAnsweredPlannedTasks captured once before either writer runs.
    // -------------------------------------------------------------------------

    private static int ObservationsRowCount(JsonObject root) => (root["observations"] as JsonArray)?.Count ?? 0;

    private static int PlannedTasksRowCount(JsonObject root) => (root["plannedTasks"] as JsonArray)?.Count ?? 0;

    [Fact]
    public void An_issue_note_does_not_overwrite_a_real_empty_observations_answer()
    {
        // An empty observations array is an ANSWER — "nothing to flag" — not
        // an absence.
        const string modelAnsweredNothingToFlag = """{ "observations": [] }""";
        const string transcript = "पाने पिवळी पडत आहेत.";

        var root = Correct(modelAnsweredNothingToFlag, transcript);

        root["observations"].Should().BeOfType<JsonArray>();
        ObservationsRowCount(root).Should().Be(0,
            "the model answered 'nothing to flag'; a keyword match on पिवळी must not overrule that");
    }

    [Fact]
    public void Real_observations_from_the_model_are_left_untouched_by_the_issue_writer()
    {
        const string modelAnswered = """
            { "observations": [ { "noteType": "reminder", "textRaw": "काहीतरी", "textCleaned": "काहीतरी" } ] }
            """;
        const string transcript = "पाने पिवळी पडत आहेत.";

        var root = Correct(modelAnswered, transcript);

        var observations = root["observations"] as JsonArray;
        observations.Should().NotBeNull();
        observations!.Count.Should().Be(1,
            "the model already answered observations; the heuristic must not append its own issue row onto it");
        observations[0]!["noteType"]!.GetValue<string>().Should().Be("reminder");
    }

    [Fact]
    public void An_issue_signal_still_fills_a_genuinely_absent_observations_key()
    {
        // Proof the gate did not over-tighten: with observations truly
        // ABSENT (not answered at all), the gap-fill write must still fire.
        const string modelDidNotAnswerObservations = "{}";
        const string transcript = "पाने पिवळी पडत आहेत.";

        var root = Correct(modelDidNotAnswerObservations, transcript);

        var observations = root["observations"] as JsonArray;
        observations.Should().NotBeNull();
        observations!.Count.Should().Be(1, "observations was genuinely absent, so the gap-fill write is legitimate here");
        observations[0]!["noteType"]!.GetValue<string>().Should().Be("issue");
    }

    [Fact]
    public void Gap_filled_issue_note_does_not_assert_a_severity_the_farmer_never_gave()
    {
        // The farmer named a symptom, not a severity. "important" was a
        // hardcoded assertion the transcript never supported — decided to
        // omit the field rather than invent a value, since severity is
        // already optional downstream (ObservationSeverity defaults to
        // Normal; the frontend's ObservationSeveritySchema is optional too).
        const string modelDidNotAnswerObservations = "{}";
        const string transcript = "पाने पिवळी पडत आहेत.";

        var root = Correct(modelDidNotAnswerObservations, transcript);

        var observations = root["observations"] as JsonArray;
        observations![0]!.AsObject().ContainsKey("severity").Should().BeFalse(
            "the farmer stated a symptom, not a severity level — asserting one he never gave is its own fabrication");
    }

    [Fact]
    public void A_reminder_note_does_not_overwrite_a_real_empty_observations_answer()
    {
        const string modelAnsweredNothingToFlag = """{ "observations": [] }""";
        const string transcript = "उद्या फवारणी करायचं आहे.";

        var root = Correct(modelAnsweredNothingToFlag, transcript);

        ObservationsRowCount(root).Should().Be(0,
            "the model answered 'nothing to flag'; a future-intent keyword match must not overrule that");
    }

    [Fact]
    public void A_reminder_does_not_overwrite_a_real_empty_plannedTasks_answer()
    {
        const string modelAnsweredNothingPlanned = """{ "plannedTasks": [] }""";
        const string transcript = "उद्या फवारणी करायचं आहे.";

        var root = Correct(modelAnsweredNothingPlanned, transcript);

        root["plannedTasks"].Should().BeOfType<JsonArray>();
        PlannedTasksRowCount(root).Should().Be(0,
            "the model answered 'nothing planned'; उद्या/करायचं alone must not overrule that");
    }

    [Fact]
    public void Real_plannedTasks_from_the_model_are_left_untouched_by_the_reminder_writer()
    {
        const string modelAnswered = """{ "plannedTasks": [ { "title": "आधीच ठरलेलं काम" } ] }""";
        const string transcript = "उद्या फवारणी करायचं आहे.";

        var root = Correct(modelAnswered, transcript);

        var plannedTasks = root["plannedTasks"] as JsonArray;
        plannedTasks.Should().NotBeNull();
        plannedTasks!.Count.Should().Be(1,
            "the model already answered plannedTasks; the heuristic must not append its own guess onto it");
        plannedTasks[0]!["title"]!.GetValue<string>().Should().Be("आधीच ठरलेलं काम");
    }

    [Fact]
    public void A_future_intent_sentence_still_fills_a_genuinely_absent_plannedTasks_key()
    {
        const string modelDidNotAnswerPlannedTasks = "{}";
        const string transcript = "उद्या फवारणी करायचं आहे.";

        var root = Correct(modelDidNotAnswerPlannedTasks, transcript);

        var plannedTasks = root["plannedTasks"] as JsonArray;
        plannedTasks.Should().NotBeNull();
        plannedTasks!.Count.Should().Be(1, "plannedTasks was genuinely absent, so the gap-fill write is legitimate here");
        plannedTasks[0]!["title"]!.GetValue<string>().Should().Be("फवारणी करणे");
    }

    [Fact]
    public void Gap_filled_planned_task_does_not_assert_a_dueHint_the_farmer_never_gave()
    {
        // The farmer said उद्या in a DIFFERENT context ("करायचं") but the
        // hardcoded "उद्या" dueHint used to fire even when the transcript's
        // temporal cue is not actually "tomorrow". Decided to omit dueHint
        // entirely rather than assert a date — it is optional/nullable in
        // the frontend's PlannedTaskDraftSchema and dueDateResolver already
        // treats a missing dueHint as "no due-date guess".
        const string modelDidNotAnswerPlannedTasks = "{}";
        const string transcript = "फवारणी करायचं आहे.";

        var root = Correct(modelDidNotAnswerPlannedTasks, transcript);

        var plannedTasks = root["plannedTasks"] as JsonArray;
        plannedTasks![0]!.AsObject().ContainsKey("dueHint").Should().BeFalse(
            "the heuristic never determined an actual due date — asserting उद्या here is a fabricated deadline");
    }

    [Fact]
    public void The_observations_and_plannedTasks_gates_are_independent()
    {
        // Model answered observations (nothing to flag) but never touched
        // plannedTasks at all. Each array's gap-fill gate must be judged on
        // its OWN key, not on whether some other array was answered.
        const string modelAnsweredObservationsOnly = """{ "observations": [] }""";
        const string transcript = "उद्या फवारणी करायचं आहे.";

        var root = Correct(modelAnsweredObservationsOnly, transcript);

        ObservationsRowCount(root).Should().Be(0, "observations was answered — must stay empty");
        PlannedTasksRowCount(root).Should().Be(1, "plannedTasks was genuinely absent — must still be gap-filled");
    }
}
