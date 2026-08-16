using System.Text.Json;
using System.Text.Json.Nodes;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-2.2) — THE SERVER MAY NOT WRITE THE FARMER'S
/// SUMMARY FOR HIM.
///
/// <para><c>EnsureString(root, "summary", "Log processed.")</c> backfilled a sentence
/// the server wrote about ITSELF whenever a parse carried no summary. That is not a
/// display string: <c>DfesLensExtractor.CoverWhat</c> credits
/// <c>hasSummary ? 0.5 : 0.0</c> on WHAT (weight 20), and on a silent day the
/// completeness denominator is 55 — so the invented sentence is worth
/// 10 × 10 / 55 = 1.82, and the farmer is shown 2/10 for a day he said nothing about.
/// It fires ONLY when <c>hasActivity || hasDisturbance</c> is false: precisely the day
/// the number should read low. Doctrine P4: never fabricate.</para>
///
/// <para>The key is BLANKED, not deleted. <c>summary</c> is required by
/// <c>AgriLogResponseSchema.ts</c>; deleting it would not throw (BackendAiClient uses
/// <c>safeParse</c> with a silent fallback) — it would quietly route every voice parse
/// onto the legacy normalisation path. An empty string satisfies the schema's bare
/// <c>z.string()</c>.</para>
/// </summary>
public sealed class AiResponseNormalizerSummaryTests
{
    private readonly AiResponseNormalizer _sut = new();

    [Fact]
    public void NormalizeVoiceJson_ParseWithNoSummary_KeepsTheKeyButLeavesItBlank()
    {
        const string rawJson = """{"dayOutcome":"NO_WORK","cropActivities":[],"labour":[]}""";

        var root = JsonNode.Parse(_sut.NormalizeVoiceJson(rawJson))!.AsObject();

        // Present — the frontend schema requires the key.
        root.ContainsKey("summary").Should().BeTrue();
        // Blank — nobody wrote a summary, so there is no summary.
        root["summary"]!.GetValue<string>().Should().BeEmpty();
    }

    [Fact]
    public void NormalizeVoiceJson_MalformedJson_LeavesSummaryBlankToo()
    {
        // The fallback-to-safe-defaults path went through the same EnsureString call.
        const string rawJson = "{ this is not valid json at all";

        var root = JsonNode.Parse(_sut.NormalizeVoiceJson(rawJson))!.AsObject();

        root["summary"]!.GetValue<string>().Should().BeEmpty();
    }

    [Fact]
    public void NormalizeVoiceJson_RealSummary_SurvivesUntouched()
    {
        // Not vacuous, and the whole point: what the FARMER said still gets through.
        const string rawJson = """{"summary":"आज द्राक्षबागेत फवारणी केली","dayOutcome":"WORK_RECORDED"}""";

        var root = JsonNode.Parse(_sut.NormalizeVoiceJson(rawJson))!.AsObject();

        root["summary"]!.GetValue<string>().Should().Be("आज द्राक्षबागेत फवारणी केली");
    }

    [Fact]
    public void SilentDay_ThroughTheRealNormalizer_EarnsNoWhatCredit()
    {
        // The whole chain, end to end: an empty parse → the server's normalizer → the
        // lens that scores the day. This is the assertion the farmer actually feels.
        var normalized = _sut.NormalizeVoiceJson("""{"dayOutcome":"NO_WORK"}""");

        using var doc = JsonDocument.Parse(normalized);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([doc.RootElement], System.Array.Empty<ObservationEvent>()),
            probe,
            clientDatePlausible: true);

        var what = input.Possible!.Single(d => d.Name == "WHAT");

        // WHAT stays in the denominator — the farmer can always say what he did, and
        // shrinking the roster is its own fabrication (see the completeness tests).
        what.Applicable.Should().BeTrue();
        what.Coverage.Should().Be(0.0, "the server's own sentence is not the farmer describing his day");
    }

    [Fact]
    public void RealSummary_ThroughTheRealNormalizer_StillEarnsHalfWhatCredit()
    {
        // The counterpart guard: a day the farmer DID describe keeps its half credit.
        var normalized = _sut.NormalizeVoiceJson("""{"summary":"paani dila","dayOutcome":"WORK_RECORDED"}""");

        using var doc = JsonDocument.Parse(normalized);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([doc.RootElement], System.Array.Empty<ObservationEvent>()),
            probe,
            clientDatePlausible: true);

        input.Possible!.Single(d => d.Name == "WHAT").Coverage.Should().Be(0.5);
    }
}
