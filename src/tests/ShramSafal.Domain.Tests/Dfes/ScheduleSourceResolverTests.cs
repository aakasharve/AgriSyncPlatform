// spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 2; founder D-B, D-G 2026-11-21)
using System;
using System.Linq;
using ShramSafal.Infrastructure.AI.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// The sources of a question that states agronomy come only from Shram Safal's own published schedule (the Schedule Maker's
/// output, embedded), never from the phone. All or nothing: one unknown or unfit line rejects the question.
/// </summary>
public sealed class ScheduleSourceResolverTests
{
    private const string Irrigation = "grapes-table-oct-fruit-pruning/irrig.0";
    private const string Pruning = "grapes-table-oct-fruit-pruning/prune.1";

    [Fact]
    public void The_embedded_schedule_is_loaded_and_every_line_in_it_stands_on_a_source()
    {
        var resolver = new ScheduleSourceResolver();

        // 21 look lines in the 22 Nov projection, none our own choice, none left to an expert, each with a source.
        Assert.Equal(21, resolver.LineCount);
    }

    [Fact]
    public void A_real_line_resolves_to_the_document_and_page_the_schedule_cites()
    {
        var sources = new ScheduleSourceResolver().Resolve([Irrigation]);

        Assert.NotNull(sources);
        Assert.Equal(
            new[] { "book-on-grape-2023 p71", "gap-table-grapes-2013 p19", "gap-table-grapes-2013 p20" },
            sources!.Select(s => $"{s.DocId} p{s.Page}").OrderBy(x => x, StringComparer.Ordinal).ToArray());
        Assert.All(sources, s => Assert.Equal(Irrigation, s.LineId));
    }

    [Fact]
    public void Two_real_lines_resolve_together()
    {
        var sources = new ScheduleSourceResolver().Resolve([Irrigation, Pruning]);

        Assert.NotNull(sources);
        Assert.Contains(sources!, s => s.LineId == Pruning);
        Assert.Contains(sources!, s => s.LineId == Irrigation);
    }

    [Theory]
    [InlineData("grapes-table-oct-fruit-pruning/no-such-line")]
    [InlineData("irrig.0")] // an unqualified id is not a line of any schedule
    [InlineData("")]
    public void An_unknown_line_resolves_nothing(string id)
        => Assert.Null(new ScheduleSourceResolver().Resolve([id]));

    [Fact]
    public void One_unknown_line_rejects_the_whole_question()
        => Assert.Null(new ScheduleSourceResolver().Resolve([Irrigation, "grapes-table-oct-fruit-pruning/made-up"]));

    [Fact]
    public void No_lines_resolve_nothing()
        => Assert.Null(new ScheduleSourceResolver().Resolve([]));

    [Fact]
    public void A_line_marked_our_choice_left_to_an_expert_or_without_a_source_never_counts()
    {
        const string schedule = """
            { "lines": [
              { "id": "s/ok", "sources": [ { "docId": "nrc-calendar", "page": "6" } ] },
              { "id": "s/ours", "ourChoice": true, "sources": [ { "docId": "nrc-calendar", "page": "6" } ] },
              { "id": "s/expert", "expertDecides": true, "sources": [ { "docId": "nrc-calendar", "page": "6" } ] },
              { "id": "s/bare", "sources": [] },
              { "id": "s/half", "sources": [ { "docId": "", "page": "6" } ] }
            ] }
            """;
        var resolver = new ScheduleSourceResolver([schedule]);

        Assert.NotNull(resolver.Resolve(["s/ok"]));
        Assert.Null(resolver.Resolve(["s/ours"]));
        Assert.Null(resolver.Resolve(["s/expert"]));
        Assert.Null(resolver.Resolve(["s/bare"]));
        Assert.Null(resolver.Resolve(["s/half"]));
        Assert.Equal(1, resolver.LineCount);
    }

    [Fact]
    public void A_line_id_that_appears_twice_is_refused_at_start()
    {
        const string schedule = """{ "lines": [ { "id": "s/x", "sources": [ { "docId": "d", "page": "1" } ] } ] }""";

        Assert.Throws<InvalidOperationException>(() => new ScheduleSourceResolver([schedule, schedule]));
    }
}
