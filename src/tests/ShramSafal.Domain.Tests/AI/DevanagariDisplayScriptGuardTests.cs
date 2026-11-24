// spec: voice-flow-v2-2026-11-23 - display text follows the transcript's script; his own words never change.
using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class DevanagariDisplayScriptGuardTests
{
    private const string MarathiTranscript = "उद्या urea टाकायचा आहे.";

    private static JsonObject Run(string json)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        DevanagariDisplayScriptGuard.Apply(root);
        return root;
    }

    private static string Marathi(string body) => $$"""
        {
          "fullTranscript":"{{MarathiTranscript}}",
          "summary":"उद्या urea टाकण्याचा बेत आहे.",
          "observations":[{
             "textRaw":"उद्या urea टाकायचा आहे",
             "sourceText":"उद्या urea टाकायचा आहे",
             "textCleaned":"उद्या urea टाकायचा आहे",
             "extractedTasks":[{"title":"urea टाकणे","rawText":"उद्या urea टाकायचा आहे"}]}],
          "plannedTasks":[{"title":"urea टाकणे","rawText":"उद्या urea टाकायचा आहे","dueHint":"उद्या"}]
          {{body}}
        }
        """;

    [Fact]
    public void Urea_becomes_yuriya_in_the_summary_the_cleaned_text_and_every_task_title_and_raw_text()
    {
        var root = Run(Marathi(""));

        Assert.Equal("उद्या युरिया टाकण्याचा बेत आहे.", root["summary"]!.GetValue<string>());
        var note = root["observations"]![0]!;
        Assert.Equal("उद्या युरिया टाकायचा आहे", note["textCleaned"]!.GetValue<string>());
        var extracted = note["extractedTasks"]![0]!;
        Assert.Equal("युरिया टाकणे", extracted["title"]!.GetValue<string>());
        Assert.Equal("उद्या युरिया टाकायचा आहे", extracted["rawText"]!.GetValue<string>());
        var planned = root["plannedTasks"]![0]!;
        Assert.Equal("युरिया टाकणे", planned["title"]!.GetValue<string>());
        Assert.Equal("उद्या युरिया टाकायचा आहे", planned["rawText"]!.GetValue<string>());
    }

    [Fact]
    public void His_own_words_keep_the_latin_spelling_exactly_as_heard()
    {
        var root = Run(Marathi(""));

        var note = root["observations"]![0]!;
        Assert.Equal("उद्या urea टाकायचा आहे", note["sourceText"]!.GetValue<string>());
        Assert.Equal("उद्या urea टाकायचा आहे", note["textRaw"]!.GetValue<string>());
        Assert.Equal(MarathiTranscript, root["fullTranscript"]!.GetValue<string>());
    }

    [Fact]
    public void The_conversion_is_case_blind()
    {
        var root = Run("""{"fullTranscript":"उद्या युरिया","summary":"उद्या Urea आणि UREA"}""");

        Assert.Equal("उद्या युरिया आणि युरिया", root["summary"]!.GetValue<string>());
    }

    [Fact]
    public void An_unknown_latin_word_and_a_digit_string_are_left_as_they_are()
    {
        var root = Run("""{"fullTranscript":"आज खत दिलं","summary":"आज Xyzzy आणि 19:19:19 आणि 05234 दिलं"}""");

        Assert.Equal("आज Xyzzy आणि 19:19:19 आणि 05234 दिलं", root["summary"]!.GetValue<string>());
    }

    [Fact]
    public void An_english_transcript_is_untouched()
    {
        var json = """
            {"fullTranscript":"Tomorrow put urea in the plot.",
             "summary":"Tomorrow urea will be applied.",
             "observations":[{"textCleaned":"put urea tomorrow","extractedTasks":[{"title":"Apply urea","rawText":"put urea tomorrow"}]}],
             "plannedTasks":[{"title":"Apply urea"}]}
            """;

        var root = Run(json);

        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(json), root), "an English transcript must come back unchanged");
    }

    [Fact]
    public void A_transcript_that_is_mostly_latin_with_one_devanagari_word_is_not_converted()
    {
        var root = Run("""{"fullTranscript":"Applied urea today आज in block two","summary":"Applied urea"}""");

        Assert.Equal("Applied urea", root["summary"]!.GetValue<string>());
    }

    [Fact]
    public void A_document_without_the_optional_arrays_does_not_throw()
    {
        var root = Run("""{"fullTranscript":"उद्या urea","summary":"उद्या urea"}""");

        Assert.Equal("उद्या युरिया", root["summary"]!.GetValue<string>());
    }
}
