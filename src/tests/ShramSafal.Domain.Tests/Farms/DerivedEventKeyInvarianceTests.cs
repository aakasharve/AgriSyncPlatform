using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class DerivedEventKeyInvarianceTests
{
    private static readonly Guid Log = Guid.Parse("11111111-1111-1111-1111-111111111111");

    [Fact]
    public void Compute_is_deterministic_for_identical_inputs()
    {
        var a = DerivedEventKey.Compute(Log, "एकोणीस एकोणीस एकोणीस खत ड्रीपने दिले", "input");
        var b = DerivedEventKey.Compute(Log, "एकोणीस एकोणीस एकोणीस खत ड्रीपने दिले", "input");
        Assert.Equal(a, b);
        Assert.Equal(64, a.Value.Length);
        Assert.Matches("^[0-9a-f]{64}$", a.Value);
    }

    [Fact]
    public void Compute_is_invariant_under_prompt_or_model_version_change()
    {
        // Key inputs are (voiceLogId, RAW span, eventType) ONLY — never the
        // prompt/model version. Re-parsing the same utterance under a different
        // prompt version must yield the SAME key. Pins that design choice.
        var underPromptV1 = DerivedEventKey.Compute(Log, "00:52:34 MKP", "input");
        var underPromptV2 = DerivedEventKey.Compute(Log, "00:52:34 MKP", "input");
        Assert.Equal(underPromptV1, underPromptV2);
    }

    [Fact]
    public void Compute_differs_when_eventType_differs()
    {
        var asInput = DerivedEventKey.Compute(Log, "same span", "input");
        var asIrrigation = DerivedEventKey.Compute(Log, "same span", "irrigation");
        Assert.NotEqual(asInput, asIrrigation);
    }

    [Fact]
    public void Compute_differs_when_raw_span_differs()
    {
        var a = DerivedEventKey.Compute(Log, "19-19-19", "input");
        var b = DerivedEventKey.Compute(Log, "13-00-45", "input");
        Assert.NotEqual(a, b);
    }

    [Fact]
    public void Compute_boundary_is_unambiguous_under_separator_in_span()
    {
        // The length prefix prevents a crafted span from aliasing the field
        // boundary: "a|input" as a span must NOT collide with span "a" + type "input".
        var crafted = DerivedEventKey.Compute(Log, "a|input", "input");
        var split = DerivedEventKey.Compute(Log, "a", "input");
        Assert.NotEqual(crafted, split);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    public void Compute_rejects_blank_span(string span)
    {
        Assert.Throws<ArgumentException>(() => DerivedEventKey.Compute(Log, span, "input"));
    }

    [Fact]
    public void Compute_rejects_blank_eventType()
    {
        Assert.Throws<ArgumentException>(() => DerivedEventKey.Compute(Log, "span", " "));
    }
}
