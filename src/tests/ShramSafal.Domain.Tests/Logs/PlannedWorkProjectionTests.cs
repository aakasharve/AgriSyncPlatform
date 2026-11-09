// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-4 Task 1 (D-78 = 1, D-29, D-31, P3).
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Which planned items of a content document become a reminder, and exactly what each carries. Pure: the save, the audit and
/// the visibility are the real-Postgres class <c>PlannedWorkFromVoiceLogRealPostgresTests</c>.
/// </summary>
public sealed class PlannedWorkProjectionTests
{
    private static readonly Guid Log = Guid.Parse("2c8a1f6e-3b57-4d90-8a41-0e5d9b7c3f12");
    private static readonly DateOnly Day = new(2026, 11, 8);

    private static JsonElement Doc(string json) => JsonDocument.Parse(json).RootElement.Clone();

    [Fact]
    public void Two_planned_items_are_two_reminders_in_the_order_he_said_them()
    {
        var found = PlannedWorkProjection.Project(Log, Day, Doc("""
            {"schema":1,"plannedTasks":[
              {"id":"t1","title":"पाईपलाईन दुरुस्त करायची","dueHint":"उद्या","status":"pending","sourceType":"ai_extracted","plotId":"FARM_GLOBAL"},
              {"id":"t2","title":"खत आणायचं","status":"pending","sourceType":"ai_extracted"}]}
            """));

        found.Select(r => r.Title).Should().Equal("पाईपलाईन दुरुस्त करायची", "खत आणायचं");
        found.Select(r => r.TaskId).Should().Equal(PlannedWorkIds.ForSpokenItem(Log, "t1"), PlannedWorkIds.ForSpokenItem(Log, "t2"));
        found[0].DueDate.Should().Be(Day.AddDays(1), "a clear cue");
        found[1].DueDate.Should().BeNull("no cue is no date, never today");
    }

    [Theory]
    [InlineData("नंतर")]
    [InlineData("या आठवड्यात")]
    [InlineData("कधीतरी")]
    public void An_unclear_cue_leaves_the_reminder_undated(string hint)
    {
        var found = PlannedWorkProjection.Project(Log, Day, Doc("{\"schema\":1,\"plannedTasks\":[{\"id\":\"t1\",\"title\":\"x\",\"dueHint\":\"" + hint + "\",\"status\":\"pending\"}]}"));
        found.Should().ContainSingle().Which.DueDate.Should().BeNull();
    }

    [Fact]
    public void A_date_the_phone_wrote_on_the_item_is_not_trusted_only_the_spoken_cue_counts()
    {
        // The old local to-do filed a typed reminder under the log's day; a date with no cue behind it is not a clear cue (D-29).
        var found = PlannedWorkProjection.Project(Log, Day, Doc("""
            {"schema":1,"plannedTasks":[{"id":"t1","title":"x","dueDate":"2026-11-08","status":"pending","sourceType":"observation_derived"}]}
            """));
        found.Should().ContainSingle().Which.DueDate.Should().BeNull();
    }

    [Theory]
    [InlineData("done")]
    [InlineData("cancelled")]
    public void An_item_already_done_or_cancelled_makes_no_reminder(string status)
    {
        PlannedWorkProjection.Project(Log, Day, Doc("{\"schema\":1,\"plannedTasks\":[{\"id\":\"t1\",\"title\":\"x\",\"status\":\"" + status + "\"}]}")).Should().BeEmpty();
    }

    [Fact]
    public void Schedule_work_is_not_a_spoken_reminder()
    {
        PlannedWorkProjection.Project(Log, Day, Doc("""{"schema":1,"plannedTasks":[{"id":"t1","title":"x","status":"pending","sourceType":"schedule"}]}""")).Should().BeEmpty();
    }

    [Fact]
    public void An_item_with_no_words_makes_no_reminder_and_a_description_stands_in_for_a_missing_title()
    {
        var found = PlannedWorkProjection.Project(Log, Day, Doc("""
            {"schema":1,"plannedTasks":[{"id":"a","title":"  "},{"id":"b","description":"ठिबक तपासा"},{"id":"c","title":7}]}
            """));
        found.Should().ContainSingle().Which.Title.Should().Be("ठिबक तपासा");
    }

    [Fact]
    public void A_long_title_is_cut_on_a_word_boundary_at_the_cap()
    {
        var words = string.Join(' ', Enumerable.Repeat("पाईपलाईन", 60)); // 60 x 9 = far over 200
        var found = PlannedWorkProjection.Project(Log, Day, Doc("{\"schema\":1,\"plannedTasks\":[{\"id\":\"t1\",\"title\":\"" + words + "\"}]}"));

        var title = found.Should().ContainSingle().Subject.Title;
        title.Length.Should().BeLessThanOrEqualTo(PlannedWork.MaxTitle);
        title.Should().EndWith("पाईपलाईन", "cut between words, never inside one");
        words.Should().StartWith(title);
    }

    [Fact]
    public void The_reminder_carries_no_transcript_no_source_text_and_no_interpretation()
    {
        var found = PlannedWorkProjection.Project(Log, Day, Doc("""
            {"schema":1,"fullTranscript":"आज फवारणी केली उद्या पाईपलाईन दुरुस्त करायची",
             "plannedTasks":[{"id":"t1","title":"पाईपलाईन","sourceText":"उद्या पाईपलाईन दुरुस्त करायची","systemInterpretation":"pipeline repair","rawText":"raw","description":"d"}]}
            """));

        var text = JsonSerializer.Serialize(found, new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        text.Should().NotContain("आज फवारणी").And.NotContain("दुरुस्त करायची").And.NotContain("pipeline repair").And.NotContain("raw");
    }

    [Fact]
    public void A_place_is_named_only_by_a_real_plot_id()
    {
        var plot = Guid.Parse("3d030000-0000-4000-8000-0000000000a3");
        var found = PlannedWorkProjection.Project(Log, Day, Doc("{\"schema\":1,\"plannedTasks\":[" +
            "{\"id\":\"a\",\"title\":\"a\",\"plotId\":\"" + plot + "\"}," +
            "{\"id\":\"b\",\"title\":\"b\",\"plotId\":\"FARM_GLOBAL\"}," +
            "{\"id\":\"c\",\"title\":\"c\",\"plotId\":\"not-an-id\"}," +
            "{\"id\":\"d\",\"title\":\"d\"}]}"));

        found.Select(r => r.NamedPlotId).Should().Equal(plot, null, null, null);
    }

    [Fact]
    public void A_reorder_or_an_item_inserted_in_the_middle_keeps_every_id()
    {
        var before = PlannedWorkProjection.Project(Log, Day, Doc("""{"schema":1,"plannedTasks":[{"id":"a","title":"a"},{"id":"b","title":"b"}]}"""));
        var after = PlannedWorkProjection.Project(Log, Day, Doc("""{"schema":1,"plannedTasks":[{"id":"b","title":"b"},{"id":"new","title":"n"},{"id":"a","title":"a"}]}"""));

        after.Single(r => r.ItemKey == "a").TaskId.Should().Be(before.Single(r => r.ItemKey == "a").TaskId);
        after.Single(r => r.ItemKey == "b").TaskId.Should().Be(before.Single(r => r.ItemKey == "b").TaskId);
    }

    [Fact]
    public void A_document_with_no_planned_items_or_not_an_object_makes_nothing()
    {
        PlannedWorkProjection.Project(Log, Day, Doc("""{"schema":1}""")).Should().BeEmpty();
        PlannedWorkProjection.Project(Log, Day, Doc("""{"schema":1,"plannedTasks":null}""")).Should().BeEmpty();
        PlannedWorkProjection.Project(Log, Day, Doc("[]")).Should().BeEmpty();
    }

    [Fact]
    public void The_items_of_a_confirmed_voice_parse_get_their_ids_by_place_and_read_the_same_cue()
    {
        var found = PlannedWorkProjection.ProjectJob(Log, Day, Doc("""
            {"plannedTasks":[{"title":"पाईपलाईन दुरुस्त करायची","dueHint":"उद्या","category":"maintenance","sourceText":"उद्या पाईपलाईन","systemInterpretation":"x"},
                             {"title":"खत आणायचं","dueHint":null}]}
            """));

        found.Select(r => r.TaskId).Should().Equal(PlannedWorkIds.ForJobItem(Log, 0), PlannedWorkIds.ForJobItem(Log, 1));
        found.Select(r => r.DueDate).Should().Equal(Day.AddDays(1), null);
        found.Should().OnlyContain(r => r.ItemSourceType == "ai_extracted", "it came off the voice parse");
    }
}
