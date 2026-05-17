// spec: data-principle-spine-2026-05-05/10.3
using System.Diagnostics;
using FluentAssertions;
using ShramSafal.Domain.Privacy.Pii;
using Xunit;

namespace ShramSafal.Domain.Tests.Privacy.Pii;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.3 (OQ-5) — perf budget
/// assertion for the heuristic detector. The envelope budgets <30ms p95
/// added latency in <c>ParseVoiceInputHandler</c>; the detector itself
/// is the dominant cost (the handler's surrounding wire is microseconds).
///
/// <para>
/// <b>Deviation note.</b> The envelope places this test under
/// <c>src/tests/ShramSafal.Application.Tests/AI/</c>; that project does
/// not yet exist in the repo (the existing convention is that handler
/// tests live in <c>ShramSafal.Domain.Tests/AI/</c> — see
/// <c>CoVeReverifyHandlerTests</c>). Adding a brand-new test project
/// here would balloon the envelope; co-locating the perf assertion
/// with the other Pii tests keeps the change minimal. The assertion
/// targets the engine directly, which is what dominates the
/// handler-side latency budget.
/// </para>
/// </summary>
public sealed class HeuristicDetectorPerfTests
{
    private const decimal AutoRedactThreshold = 0.85m;
    private const decimal DiscardThreshold = 0.3m;

    private static WorkerNameDetector NewDetector()
    {
        var names = new HashSet<string>(StringComparer.Ordinal);
        // Stress dictionary: realistic ~100 names.
        for (int i = 0; i < 100; i++)
        {
            names.Add($"NAME_{i:D3}");
        }
        names.Add("रामू");
        names.Add("सीता");
        names.Add("रवि");

        var markers = new HashSet<string>(StringComparer.Ordinal)
        {
            "मजूर", "मजुरी", "गडी", "कामगार", "worker",
        };

        return new WorkerNameDetector(names, markers);
    }

    [Fact]
    public void Detect_p95_added_latency_under_controlled_input_is_below_30ms()
    {
        var d = NewDetector();
        // ~30-word Marathi transcript — representative of a single
        // voice-clip parse. Mix of names + markers + filler.
        var sample = "आज रामू मजूर आला, सीता पण मजुरीसाठी आली. " +
                     "नांगरणी झाली, पाणी दिले, खत टाकले. " +
                     "उद्या औषध फवारणी करायची आहे, गडी बोलवायचे.";

        // Warmup — JIT + dictionary load on first call.
        for (int i = 0; i < 5; i++)
        {
            d.Detect(sample, AutoRedactThreshold, DiscardThreshold);
        }

        const int iterations = 100;
        var samples = new long[iterations];
        var sw = new Stopwatch();
        for (int i = 0; i < iterations; i++)
        {
            sw.Restart();
            d.Detect(sample, AutoRedactThreshold, DiscardThreshold);
            sw.Stop();
            samples[i] = sw.ElapsedMilliseconds;
        }

        Array.Sort(samples);
        var p95 = samples[(int)(iterations * 0.95) - 1];

        p95.Should().BeLessThan(30,
            because: "envelope §10.3 (OQ-5) budgets <30ms p95 added latency for the detector.");
    }
}
