using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class DerivedEventKeyInvarianceTests
{
    private static readonly Guid Log = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid Plot = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");

    [Fact]
    public void Compute_is_deterministic_for_identical_inputs()
    {
        var a = DerivedEventKey.Compute(Log, Plot, "एकोणीस एकोणीस एकोणीस खत ड्रीपने दिले", "input");
        var b = DerivedEventKey.Compute(Log, Plot, "एकोणीस एकोणीस एकोणीस खत ड्रीपने दिले", "input");
        Assert.Equal(a, b);
        Assert.Equal(64, a.Value.Length);
        Assert.Matches("^[0-9a-f]{64}$", a.Value);
    }

    [Fact]
    public void Compute_is_invariant_under_prompt_or_model_version_change()
    {
        // Key inputs are (voiceLogId, plotScope, RAW span, eventType) ONLY — never
        // the prompt/model version. Re-parsing the same utterance under a different
        // prompt version must yield the SAME key. Pins that design choice.
        var underPromptV1 = DerivedEventKey.Compute(Log, Plot, "00:52:34 MKP", "input");
        var underPromptV2 = DerivedEventKey.Compute(Log, Plot, "00:52:34 MKP", "input");
        Assert.Equal(underPromptV1, underPromptV2);
    }

    [Fact]
    public void Compute_differs_when_eventType_differs()
    {
        var asInput = DerivedEventKey.Compute(Log, Plot, "same span", "input");
        var asIrrigation = DerivedEventKey.Compute(Log, Plot, "same span", "irrigation");
        Assert.NotEqual(asInput, asIrrigation);
    }

    [Fact]
    public void Compute_differs_when_raw_span_differs()
    {
        var a = DerivedEventKey.Compute(Log, Plot, "19-19-19", "input");
        var b = DerivedEventKey.Compute(Log, Plot, "13-00-45", "input");
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Compute_differs_when_plot_scope_differs()
    {
        // Multi-plot fix: the mobile flow creates one DailyLog PER plot while
        // reusing the SAME SourceAiJobId + span, so the plot scope is the ONLY
        // component that distinguishes two plots' operations. Different plots MUST
        // produce different keys or the 2nd plot supersedes the 1st on the shared
        // (farm_id, derived_event_key) unique index (silent data loss).
        var plotA = Guid.Parse("aaaaaaaa-1111-1111-1111-111111111111");
        var plotB = Guid.Parse("bbbbbbbb-2222-2222-2222-222222222222");
        var forPlotA = DerivedEventKey.Compute(Log, plotA, "same span", "input");
        var forPlotB = DerivedEventKey.Compute(Log, plotB, "same span", "input");
        Assert.NotEqual(forPlotA, forPlotB);
    }

    [Fact]
    public void Compute_same_for_same_plot_scope_supports_reconfirm_supersession()
    {
        // The SAME plot re-confirmed (a distinct DailyLog id but the same plot and
        // same source job/span) must recompute the SAME key so the offline
        // re-confirm SUPERSEDES rather than duplicating.
        var first = DerivedEventKey.Compute(Log, Plot, "same span", "input");
        var reconfirm = DerivedEventKey.Compute(Log, Plot, "same span", "input");
        Assert.Equal(first, reconfirm);
    }

    [Fact]
    public void Compute_differs_when_plot_scope_is_null_vs_present()
    {
        // A null plot scope (plot-less operation) must not alias a real plot.
        var withPlot = DerivedEventKey.Compute(Log, Plot, "same span", "input");
        var withoutPlot = DerivedEventKey.Compute(Log, null, "same span", "input");
        Assert.NotEqual(withPlot, withoutPlot);
    }

    [Fact]
    public void Compute_null_plot_scope_is_deterministic()
    {
        var a = DerivedEventKey.Compute(Log, null, "same span", "input");
        var b = DerivedEventKey.Compute(Log, null, "same span", "input");
        Assert.Equal(a, b);
    }

    [Fact]
    public void Compute_boundary_is_unambiguous_under_separator_in_span()
    {
        // The length prefix prevents a crafted span from aliasing the field
        // boundary: "a|input" as a span must NOT collide with span "a" + type "input".
        var crafted = DerivedEventKey.Compute(Log, Plot, "a|input", "input");
        var split = DerivedEventKey.Compute(Log, Plot, "a", "input");
        Assert.NotEqual(crafted, split);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void Compute_rejects_blank_span(string span)
    {
        Assert.Throws<ArgumentException>(() => DerivedEventKey.Compute(Log, Plot, span, "input"));
    }

    [Fact]
    public void Compute_rejects_blank_eventType()
    {
        Assert.Throws<ArgumentException>(() => DerivedEventKey.Compute(Log, Plot, "span", " "));
    }
}
