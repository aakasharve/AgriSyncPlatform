// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2; amendments C6 and C18)
//
// Written by the test-writer from the plan only. Every expected area below is
// pinned from the plan's anchors (C6, C18), never read out of the production
// route table: a table that put everything in "other" fails these tests.
//
// The recorded route key is props->>'route', holding "VERB /pattern"
// (RequestObservabilityProps); the pattern carries the group prefix
// ("/shramsafal/..."), and ProblemArea.For matches on the pattern's ending so
// the prefix does not matter.

using FluentAssertions;
using ShramSafal.Application.UseCases.Admin.Shared;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class ProblemAreaTests
{
    private const string ApiError = "api.error";
    private const string ClientError = "client.error";
    private const string AiInvocation = "ai.invocation";

    private static readonly string[] FourAreas =
        { ProblemArea.Sync, ProblemArea.Entries, ProblemArea.Voice, ProblemArea.Other };

    [Fact]
    public void The_four_areas_are_the_planned_words()
    {
        ProblemArea.Sync.Should().Be("sync");
        ProblemArea.Entries.Should().Be("entries");
        ProblemArea.Voice.Should().Be("voice");
        ProblemArea.Other.Should().Be("other");
    }

    [Theory]
    [InlineData("POST /shramsafal/sync/push")]
    [InlineData("GET /shramsafal/sync/pull")]
    [InlineData("POST /sync/push")]
    [InlineData("GET /sync/pull")]
    [InlineData("POST /shramsafal/v2/sync/push")]
    public void Sync_push_is_sync(string route)
    {
        ProblemArea.For(ApiError, route, null).Should().Be(ProblemArea.Sync,
            "a route ending in /sync/push or /sync/pull is syncing, whatever the group prefix (C6)");
    }

    [Theory]
    [InlineData("POST /shramsafal/logs")]
    [InlineData("POST /logs")]
    [InlineData("POST /shramsafal/logs/{id:guid}/verify")]
    [InlineData("POST /shramsafal/logs/{id:guid}/tasks")]
    [InlineData("GET /shramsafal/logs/{id:guid}/transitions")]
    [InlineData("GET /shramsafal/logs/{id:guid}/original-voice")]
    public void Saving_an_entry_is_entries(string route)
    {
        ProblemArea.For(ApiError, route, null).Should().Be(ProblemArea.Entries,
            "POST …/logs and any …/logs/{id:guid}/… is saving or working on an entry (C6)");
    }

    [Theory]
    [InlineData("POST /shramsafal/ai/voice-parse")]
    [InlineData("POST /shramsafal/ai/parse-voice")]
    [InlineData("POST /shramsafal/ai/parse-voice-stream")]
    [InlineData("POST /shramsafal/ai/transcribe-stream")]
    [InlineData("POST /ai/voice-parse")]
    [InlineData("POST /ai/transcribe-stream")]
    public void Each_voice_route_is_voice(string route)
    {
        ProblemArea.For(ApiError, route, null).Should().Be(ProblemArea.Voice,
            "the four voice routes of C6 are voice, whatever the group prefix");
    }

    [Fact]
    public void A_failed_voice_call_is_voice()
    {
        ProblemArea.For(AiInvocation, null, "failure").Should().Be(ProblemArea.Voice,
            "an ai.invocation with outcome failure is a voice problem (C6)");
    }

    [Theory]
    [InlineData("POST /shramsafal/voice-diary/persist")]
    [InlineData("GET /shramsafal/voice-diary/by-range")]
    [InlineData("GET /shramsafal/voice-diary/by-id/{clipId:guid}")]
    public void Voice_diary_routes_are_voice(string route)
    {
        ProblemArea.For(ApiError, route, null).Should().Be(ProblemArea.Voice,
            "recording a voice note is voice (C18)");
    }

    [Theory]
    [InlineData("GET /shramsafal/cr2e/a-route-nobody-mapped")]
    [InlineData("GET /shramsafal/admin/farms")]
    [InlineData("POST /shramsafal/made-up/thing")]
    public void An_unknown_route_is_other(string route)
    {
        ProblemArea.For(ApiError, route, null).Should().Be(ProblemArea.Other,
            "any pattern not in the table is other");
    }

    [Fact]
    public void No_route_is_other()
    {
        ProblemArea.For(ApiError, null, null).Should().Be(ProblemArea.Other, "no route → other (C6)");
        ProblemArea.For(ApiError, string.Empty, null).Should().Be(ProblemArea.Other, "an empty route names nothing");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("POST /shramsafal/sync/push")]
    [InlineData("POST /shramsafal/logs")]
    [InlineData("POST /shramsafal/ai/voice-parse")]
    public void A_phone_report_is_other(string? route)
    {
        ProblemArea.For(ClientError, route, null).Should().Be(ProblemArea.Other,
            "client.error is other: the phone's own report, whatever route its body claims (C6)");
    }

    [Fact]
    public void Every_problem_lands_in_exactly_one_area()
    {
        // Every pattern of the production table (membership only: the expected bucket of each
        // anchor is pinned by the tests above, never taken from the table), the anchors, an
        // unknown pattern and no pattern at all.
        var routes = new List<string?>(ProblemArea.KnownRoutes.Keys)
        {
            "POST /shramsafal/sync/push",
            "GET /shramsafal/sync/pull",
            "POST /shramsafal/logs",
            "POST /shramsafal/logs/{id:guid}/verify",
            "POST /shramsafal/ai/voice-parse",
            "POST /shramsafal/ai/parse-voice",
            "POST /shramsafal/ai/parse-voice-stream",
            "POST /shramsafal/ai/transcribe-stream",
            "POST /shramsafal/voice-diary/persist",
            "GET /shramsafal/cr2e/a-route-nobody-mapped",
            null,
        };

        foreach (var route in routes)
        {
            foreach (var eventType in new[] { ApiError, ClientError })
            {
                var area = ProblemArea.For(eventType, route, null);
                FourAreas.Should().Contain(area,
                    "{0} on '{1}' must land in exactly one of the four areas", eventType, route ?? "(none)");
            }

            FourAreas.Should().Contain(ProblemArea.For(AiInvocation, route, "failure"),
                "a failed voice call on '{0}' must land in one of the four areas", route ?? "(none)");
        }
    }
}
