using System.Linq;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

// Phase 3 (VOICE_LATENCY_PIPELINE_V2 §7 Task 3.2) — covers the four
// failure modes called out in the plan: simple top-level string field,
// top-level array (per-element + per-field), full-document completion,
// and escaped quotes inside string values.
public sealed class PartialJsonParserTests
{
    [Fact]
    public void EmitsFieldComplete_WhenTopLevelStringFieldFinishes()
    {
        var (parser, events) = NewParser();

        parser.Feed("{\"summary\":\"hello\",");

        Assert.Single(events);
        Assert.Equal(PartialJsonEventType.FieldComplete, events[0].Type);
        Assert.Equal("summary", events[0].FieldPath);
    }

    [Fact]
    public void EmitsFieldComplete_WhenTopLevelArrayFieldFinishes()
    {
        var (parser, events) = NewParser();

        parser.Feed("{\"irrigation\":[{\"method\":\"drip\"}],");

        // Plan §7 Task 3.2 Step 1: array element + array itself = 2 events.
        Assert.Equal(2, events.Count);
        Assert.All(events, e => Assert.Equal(PartialJsonEventType.FieldComplete, e.Type));
        Assert.All(events, e => Assert.Equal("irrigation", e.FieldPath));
    }

    [Fact]
    public void EmitsComplete_WhenWholeDocumentFinishes()
    {
        var (parser, events) = NewParser();

        parser.Feed("{\"summary\":\"hello\"}");

        Assert.Contains(events, e => e.Type == PartialJsonEventType.Complete);
        var complete = events.First(e => e.Type == PartialJsonEventType.Complete);
        Assert.NotNull(complete.Value);
        Assert.Equal("hello", complete.Value!.Value.GetProperty("summary").GetString());
    }

    [Fact]
    public void HandlesEscapedQuotesInStrings()
    {
        var (parser, events) = NewParser();

        parser.Feed("{\"summary\":\"he said \\\"hi\\\"\",");

        var fieldEvents = events.Where(e => e.Type == PartialJsonEventType.FieldComplete).ToList();
        Assert.Single(fieldEvents);
        Assert.Equal("summary", fieldEvents[0].FieldPath);
    }

    [Fact]
    public void HandlesChunkedFeed_AcrossSplitTokens()
    {
        // Streaming arrives in arbitrary chunks; state must survive.
        var (parser, events) = NewParser();

        parser.Feed("{\"sum");
        parser.Feed("mary\":\"he");
        parser.Feed("llo\",\"confidence\":0.87}");

        var fieldEvents = events.Where(e => e.Type == PartialJsonEventType.FieldComplete).ToList();
        Assert.Single(fieldEvents);
        Assert.Equal("summary", fieldEvents[0].FieldPath);
        Assert.Contains(events, e => e.Type == PartialJsonEventType.Complete);
    }

    private static (PartialJsonParser Parser, List<PartialJsonEvent> Events) NewParser()
    {
        var parser = new PartialJsonParser();
        var events = new List<PartialJsonEvent>();
        parser.OnEvent += events.Add;
        return (parser, events);
    }
}
