// spec: voice-flow-v2-2026-11-23 - one task, shown once. The phone reads plannedTasks; an extractedTasks twin is dropped.
using System.Text.Json.Nodes;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

public sealed class DuplicateTaskGuardTests
{
    private static JsonObject Run(string json)
    {
        var root = JsonNode.Parse(json)!.AsObject();
        DuplicateTaskGuard.Apply(root);
        return root;
    }

    private static JsonArray Extracted(JsonObject root) => root["observations"]![0]!["extractedTasks"]!.AsArray();

    [Fact]
    public void The_extracted_twin_with_the_same_title_is_dropped_and_the_planned_task_stays()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"title":"युरिया टाकणे","rawText":"उद्या urea टाकायचा आहे"}]}],
             "plannedTasks":[{"title":"युरिया टाकणे","dueHint":"उद्या"}]}
            """);

        Assert.Empty(Extracted(root));
        var planned = Assert.Single(root["plannedTasks"]!.AsArray());
        Assert.Equal("युरिया टाकणे", planned!["title"]!.GetValue<string>());
        Assert.Equal("उद्या", planned["dueHint"]!.GetValue<string>());
    }

    [Fact]
    public void The_twin_is_found_by_the_note_id_when_the_titles_differ()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"title":"खत देणे","sourceNoteId":"obs_1"}]}],
             "plannedTasks":[{"title":"युरिया टाकणे","sourceObservationId":"obs_1"}]}
            """);

        Assert.Empty(Extracted(root));
    }

    [Fact]
    public void The_twin_is_found_by_the_raw_text_when_the_titles_differ()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"title":"खत","rawText":"उद्या युरिया टाकायचा आहे"}]}],
             "plannedTasks":[{"title":"युरिया टाकणे","sourceText":"उद्या युरिया टाकायचा आहे"}]}
            """);

        Assert.Empty(Extracted(root));
    }

    [Fact]
    public void A_different_extracted_task_is_kept()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"title":"फवारणी करणे","rawText":"परवा फवारणी करायची","sourceNoteId":"obs_2"}]}],
             "plannedTasks":[{"title":"युरिया टाकणे","sourceObservationId":"obs_1"}]}
            """);

        var kept = Assert.Single(Extracted(root));
        Assert.Equal("फवारणी करणे", kept!["title"]!.GetValue<string>());
    }

    [Fact]
    public void Only_the_twin_goes_when_the_note_holds_a_twin_and_another_task()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[
                {"title":"युरिया टाकणे"},
                {"title":"फवारणी करणे"}]}],
             "plannedTasks":[{"title":"युरिया टाकणे"}]}
            """);

        var kept = Assert.Single(Extracted(root));
        Assert.Equal("फवारणी करणे", kept!["title"]!.GetValue<string>());
    }

    [Fact]
    public void With_no_planned_tasks_the_extracted_tasks_are_left_alone()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"title":"युरिया टाकणे"}]}],
             "plannedTasks":[]}
            """);

        Assert.Single(Extracted(root));
    }

    [Fact]
    public void Tasks_with_no_title_or_ids_are_never_treated_as_twins_of_each_other()
    {
        var root = Run("""
            {"observations":[{"extractedTasks":[{"priority":"normal"}]}],
             "plannedTasks":[{"dueHint":"उद्या"}]}
            """);

        Assert.Single(Extracted(root));
    }

    [Fact]
    public void A_document_without_observations_does_not_throw()
    {
        var root = Run("""{"plannedTasks":[{"title":"युरिया टाकणे"}]}""");

        Assert.Single(root["plannedTasks"]!.AsArray());
    }
}
