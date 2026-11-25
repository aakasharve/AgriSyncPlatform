// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 16, "voice fills the timer")
// The response shape: the timer read from his words rides INSIDE the one planned-work item (nested objects pass unknown fields through on
// the phone, P11) and NEVER at the top level (the phone's top level is strict). Two planned works, no planned work or an unclear sentence = nothing added.
using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Application.UseCases.AI.ParseVoiceInput;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class SpokenTimerAttachmentTests
{
    private const string Sentence = "पेस्टनंतर आठ दिवसांनी, फूट दिसली की";

    private static string Answer(string plannedTasksJson) => $$"""
        {"summary":"x","dayOutcome":"WORK_RECORDED","cropActivities":[],"observations":[],"plannedTasks":{{plannedTasksJson}},"fullTranscript":"x","confidence":0.9}
        """;

    private static JsonObject Run(string plannedTasksJson, string? words) =>
        JsonNode.Parse(SpokenTimerAttachment.Attach(Answer(plannedTasksJson), words))!.AsObject();

    [Fact]
    public void One_planned_work_carries_the_timer_inside_the_item_and_nothing_at_the_top_level()
    {
        var before = JsonNode.Parse(Answer("""[{"title":"पेस्ट फवारणी","dueHint":null}]"""))!.AsObject();
        var after = Run("""[{"title":"पेस्ट फवारणी","dueHint":null}]""", Sentence);

        // top level: exactly the keys it had
        after.Select(p => p.Key).Should().BeEquivalentTo(before.Select(p => p.Key));
        after.ContainsKey("spokenTimer").Should().BeFalse();

        var item = after["plannedTasks"]!.AsArray().Should().ContainSingle().Subject!.AsObject();
        item["title"]!.GetValue<string>().Should().Be("पेस्ट फवारणी");
        var timer = item["spokenTimer"]!.AsObject();
        timer["kind"]!.GetValue<string>().Should().Be("after");
        timer["afterWorkWords"]!.GetValue<string>().Should().Be("पेस्ट");
        timer["usualDays"]!.GetValue<int>().Should().Be(8);
        timer["heardWords"]!.GetValue<string>().Should().Be("पेस्टनंतर आठ दिवसांनी");
        timer["provenance"]!.GetValue<string>().Should().Be("spoken");
        timer.ContainsKey("fromDay").Should().BeFalse();
        timer.ContainsKey("signWords").Should().BeFalse();
    }

    [Fact]
    public void A_day_and_a_sign_have_their_own_fields_only()
    {
        var day = Run("""[{"title":"छाटणी"}]""", "दहाव्या दिवशी")["plannedTasks"]![0]!["spokenTimer"]!.AsObject();
        day["kind"]!.GetValue<string>().Should().Be("day");
        day["fromDay"]!.GetValue<int>().Should().Be(9);
        day.ContainsKey("usualDays").Should().BeFalse();

        var sign = Run("""[{"title":"खत"}]""", "फूट दिसली की")["plannedTasks"]![0]!["spokenTimer"]!.AsObject();
        sign["kind"]!.GetValue<string>().Should().Be("sign");
        sign["signWords"]!.GetValue<string>().Should().Be("फूट");
    }

    [Theory]
    [InlineData("""[{"title":"a"},{"title":"b"}]""", Sentence)]   // two planned works: which one it belongs to would be a guess
    [InlineData("""[]""", Sentence)]                                // a log with no planned work gets nothing
    [InlineData("""[{"title":"a"}]""", "दोन तीन दिवसांनी")]        // unclear
    [InlineData("""[{"title":"a"}]""", "")]                         // empty transcript
    [InlineData("""[{"title":"a"}]""", null)]
    public void Nothing_is_added_for_two_planned_works_none_or_an_unclear_sentence(string planned, string? words)
    {
        var original = Answer(planned);

        SpokenTimerAttachment.Attach(original, words).Should().Be(original);
    }

    [Fact]
    public void A_planned_item_that_already_has_a_timer_field_is_left_alone_and_bad_json_passes_through()
    {
        var withOwn = Answer("""[{"title":"a","spokenTimer":{"kind":"day"}}]""");
        SpokenTimerAttachment.Attach(withOwn, Sentence).Should().Be(withOwn);
        SpokenTimerAttachment.Attach("not json", Sentence).Should().Be("not json");
    }
}
