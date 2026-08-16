using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Integrations.Gemini;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-2.2) — THE SECOND SUMMARY INJECTOR.
///
/// <para>Commit 355192b3 blanked <c>EnsureString(root, "summary", "Log processed.")</c> in
/// <c>AiResponseNormalizer</c>. <c>GeminiParsingService</c> carried the same defect on the
/// legacy parse path with a different literal — "Voice log parsed successfully." — and so
/// defeated that fix wherever the legacy path still runs.</para>
///
/// <para>It is not a display string. <c>DfesLensExtractor.CoverWhat</c> credits
/// <c>hasSummary ? 0.5 : 0.0</c> on WHAT (weight 20), and on a silent day the completeness
/// denominator is 55 — so the injected sentence is worth 10 × 10 / 55 = 1.82 and the farmer
/// is shown 2/10 for a day he said nothing about. Doctrine P4: never fabricate.</para>
///
/// <para>Blanked, not deleted: <c>summary</c> is required by <c>AgriLogResponseSchema.ts</c>
/// and an empty string satisfies its bare <c>z.string()</c>.</para>
/// </summary>
public sealed class GeminiParsingServiceSummaryTests
{
    [Fact]
    public void ParseAndNormalizePayload_NoSummary_KeepsTheKeyButLeavesItBlank()
    {
        const string rawJson = """{"dayOutcome":"NO_WORK_PLANNED","cropActivities":[],"labour":[]}""";

        var payload = GeminiParsingService.ParseAndNormalizePayload(rawJson, fallbackTranscript: "");

        // Present — the frontend schema requires the key.
        payload.ParsedLog.TryGetProperty("summary", out var summary).Should().BeTrue();
        // Blank — nobody wrote a summary, so there is no summary.
        summary.GetString().Should().BeEmpty();
    }

    [Fact]
    public void ParseAndNormalizePayload_BlankSummary_IsNotBackfilled()
    {
        // EnsureString's guard is IsNullOrWhiteSpace, so a whitespace-only summary took the
        // fallback too. It must now take the blank, not the sentence.
        const string rawJson = """{"summary":"   ","dayOutcome":"WORK_RECORDED"}""";

        var payload = GeminiParsingService.ParseAndNormalizePayload(rawJson, fallbackTranscript: "");

        payload.ParsedLog.GetProperty("summary").GetString().Should().BeEmpty();
    }

    [Fact]
    public void ParseAndNormalizePayload_RealSummary_SurvivesUntouched()
    {
        // Not vacuous, and the whole point: what the FARMER said still gets through.
        const string rawJson = """{"summary":"आज द्राक्षबागेत फवारणी केली","dayOutcome":"WORK_RECORDED"}""";

        var payload = GeminiParsingService.ParseAndNormalizePayload(rawJson, fallbackTranscript: "");

        payload.ParsedLog.GetProperty("summary").GetString().Should().Be("आज द्राक्षबागेत फवारणी केली");
    }

    [Fact]
    public void SilentDay_ThroughTheLegacyGeminiPath_EarnsNoWhatCredit()
    {
        // The chain end to end: an empty legacy parse → this normalizer → the lens that
        // scores the day. This is the assertion the farmer actually feels.
        var payload = GeminiParsingService.ParseAndNormalizePayload(
            """{"dayOutcome":"NO_WORK_PLANNED"}""", fallbackTranscript: "");

        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([payload.ParsedLog], System.Array.Empty<ObservationEvent>()),
            probe,
            clientDatePlausible: true);

        var what = input.Possible!.Single(d => d.Name == "WHAT");

        // WHAT stays in the denominator — the farmer can always say what he did.
        what.Applicable.Should().BeTrue();
        what.Coverage.Should().Be(0.0, "the server's own sentence is not the farmer describing his day");
    }

    [Fact]
    public void DescribedDay_ThroughTheLegacyGeminiPath_StillEarnsHalfWhatCredit()
    {
        // The counterpart guard: a day the farmer DID describe keeps its half credit.
        var payload = GeminiParsingService.ParseAndNormalizePayload(
            """{"summary":"paani dila","dayOutcome":"WORK_RECORDED"}""", fallbackTranscript: "");

        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([payload.ParsedLog], System.Array.Empty<ObservationEvent>()),
            probe,
            clientDatePlausible: true);

        input.Possible!.Single(d => d.Name == "WHAT").Coverage.Should().Be(0.5);
    }
}
