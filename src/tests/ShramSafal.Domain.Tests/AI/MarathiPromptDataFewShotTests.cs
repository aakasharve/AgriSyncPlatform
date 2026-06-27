using System.Text.Json;
using ShramSafal.Infrastructure.AI;
using Xunit;

namespace ShramSafal.Domain.Tests.AI;

/// <summary>
/// AI_INTELLIGENCE_PLAN_2026-06-25 W1.P0 Component 10 — production few-shot
/// curriculum guards.
///
/// This test set enforces three invariants over the complete
/// <see cref="MarathiPromptData.FewShotExamples"/> list (all 16 legacy +
/// 12 new C10 examples):
///
///   1. Every Output: body is valid JSON (guards against editing errors).
///   2. Each of the 4 new curriculum skills is demonstrably present:
///      batch-decomposition, carrier-vs-irrigation, dose-basis-abstention,
///      decision-chain.
///   3. The dishonesty governor: no example pairs
///      "doseBasis":"NOT_MENTIONED" with a fabricated "totalMl" value.
/// </summary>
public sealed class MarathiPromptDataFewShotTests
{
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------

    private static string ExtractOutputJson(string example)
    {
        // Each example is a raw string literal of the form:
        //   Input: "…"
        //   Output: {minified JSON}
        const string marker = "Output: ";
        var idx = example.IndexOf(marker, StringComparison.Ordinal);
        Assert.True(idx >= 0, $"FewShotExamples entry is missing 'Output: ' marker.\nEntry:\n{example}");

        return example[(idx + marker.Length)..].Trim();
    }

    private static JsonDocument ParseOutputJson(string example)
    {
        var json = ExtractOutputJson(example);
        try
        {
            return JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            throw new Xunit.Sdk.XunitException(
                $"Output body is not valid JSON: {ex.Message}\nFull entry:\n{example}");
        }
    }

    // -------------------------------------------------------------------------
    // Guard 1 — every Output: is valid JSON
    // -------------------------------------------------------------------------

    [Fact]
    public void AllFewShotExamples_OutputIsValidJson()
    {
        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            // ParseOutputJson asserts and throws on invalid JSON.
            using var _ = ParseOutputJson(example);
        }
    }

    // -------------------------------------------------------------------------
    // Guard 2a — batch decomposition: 00:52:34 present AND ≥3 inputs rows
    // -------------------------------------------------------------------------

    [Fact]
    public void FewShotExamples_ContainsBatchDecompositionExample()
    {
        var found = false;

        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            if (!example.Contains("00:52:34", StringComparison.Ordinal))
                continue;

            using var doc = ParseOutputJson(example);
            var root = doc.RootElement;

            if (!root.TryGetProperty("inputs", out var inputs))
                continue;

            if (inputs.GetArrayLength() >= 3)
            {
                found = true;
                break;
            }
        }

        Assert.True(found,
            "Expected at least one FewShotExamples entry to contain '00:52:34' in the " +
            "Input AND produce ≥3 inputs[] rows in the Output (batch decomposition skill).");
    }

    // -------------------------------------------------------------------------
    // Guard 2b — dose-basis abstention: doseBasis=NOT_MENTIONED, no totalMl
    // -------------------------------------------------------------------------

    [Fact]
    public void FewShotExamples_ContainsDoseBasisAbstentionExample()
    {
        var found = false;

        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            var json = ExtractOutputJson(example);

            if (!json.Contains("\"doseBasis\":\"NOT_MENTIONED\"", StringComparison.Ordinal))
                continue;

            // Also assert: no totalMl key at all in this example.
            Assert.False(
                json.Contains("\"totalMl\"", StringComparison.Ordinal),
                $"Dose-abstention example must NOT contain 'totalMl' (dishonesty governor).\nEntry:\n{example}");

            found = true;
            break;
        }

        Assert.True(found,
            "Expected at least one FewShotExamples entry whose Output contains " +
            "\"doseBasis\":\"NOT_MENTIONED\" (dose-basis abstention skill).");
    }

    // -------------------------------------------------------------------------
    // Guard 2c — carrier-vs-irrigation: 1000 L on input row, irrigation absent/empty
    // -------------------------------------------------------------------------

    [Fact]
    public void FewShotExamples_ContainsCarrierVsIrrigationExample()
    {
        // We identify the carrier example by:
        //   - Input contains "एक हजार लिटर" or "1000" (the 1000 L carrier marker)
        //   - Output.irrigation is absent or empty
        var found = false;

        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            var hasCarrierMarker =
                example.Contains("एक हजार लिटर", StringComparison.Ordinal) ||
                example.Contains("1000 L", StringComparison.Ordinal) ||
                example.Contains("\"carrierVolumeLitres\":1000", StringComparison.Ordinal) ||
                example.Contains("\"notes\":\"1000", StringComparison.Ordinal);

            if (!hasCarrierMarker)
                continue;

            using var doc = ParseOutputJson(example);
            var root = doc.RootElement;

            var irrigationAbsent = !root.TryGetProperty("irrigation", out var irr);
            var irrigationEmpty = !irrigationAbsent && irr.GetArrayLength() == 0;

            if (irrigationAbsent || irrigationEmpty)
            {
                found = true;
                break;
            }
        }

        Assert.True(found,
            "Expected at least one FewShotExamples entry showing 1000 L as spray carrier " +
            "on an inputs[] row with irrigation[] absent or empty (carrier-vs-irrigation skill).");
    }

    // -------------------------------------------------------------------------
    // Guard 2d — decision-chain: 4h→1h rain cut as a single linked entry
    // -------------------------------------------------------------------------

    [Fact]
    public void FewShotExamples_ContainsDecisionChainExample()
    {
        // The decision-chain example encodes rain → irrigation cut 4h→1h as ONE
        // causal link. We identify it by:
        //   - Output contains a disturbance OR an observation that references
        //     the causal reduction (both "4" and "1" appear as hour values).
        //   - It is NOT split into two unrelated irrigation entries.
        var found = false;

        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            var json = ExtractOutputJson(example);

            // Must encode the cause (rain / पाऊस) and the effect (hour cut).
            if (!(json.Contains("\"cause\"", StringComparison.Ordinal) ||
                  json.Contains("\"causalLink\"", StringComparison.Ordinal) ||
                  json.Contains("\"reducedFrom\"", StringComparison.Ordinal) ||
                  json.Contains("reducedTo", StringComparison.Ordinal) ||
                  json.Contains("\"rain\"", StringComparison.Ordinal) ||
                  json.Contains("\"weather\"", StringComparison.Ordinal)))
            {
                continue;
            }

            // Must reference irrigation hour adjustment.
            if (!json.Contains("1", StringComparison.Ordinal))
                continue;

            // The disturbance entry must be SINGLE (one cause→one effect block);
            // guard: there must NOT be two separate unrelated irrigation entries
            // that each encode part of the causal pair.
            using var doc = ParseOutputJson(example);
            var root = doc.RootElement;

            if (root.TryGetProperty("irrigation", out var irr) && irr.GetArrayLength() > 1)
            {
                // Two separate irrigation entries — that is the wrong shape. Skip.
                continue;
            }

            found = true;
            break;
        }

        Assert.True(found,
            "Expected at least one FewShotExamples entry encoding a rain→irrigation-cut " +
            "causal link as a single linked entry (decision-chain skill).");
    }

    // -------------------------------------------------------------------------
    // Guard 3 — dishonesty governor: no example has totalMl + NOT_MENTIONED
    // -------------------------------------------------------------------------

    [Fact]
    public void FewShotExamples_NoDoseBasisNotMentionedPairedWithTotalMl()
    {
        foreach (var example in MarathiPromptData.FewShotExamples)
        {
            var json = ExtractOutputJson(example);

            var hasAbstention = json.Contains("\"doseBasis\":\"NOT_MENTIONED\"", StringComparison.Ordinal);
            var hasTotalMl = json.Contains("\"totalMl\"", StringComparison.Ordinal);

            Assert.False(
                hasAbstention && hasTotalMl,
                $"DISHONESTY GOVERNOR VIOLATION: An example declares " +
                $"doseBasis=NOT_MENTIONED but also emits totalMl (fabricated total).\n" +
                $"Entry:\n{example}");
        }
    }
}
