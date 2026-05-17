// spec: data-principle-spine-2026-05-05/10.1
using System.Reflection;
using System.Text.RegularExpressions;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.1 (OQ-2) — the heuristic
/// detector MUST NOT trigger any Gemini / Sarvam / HTTP call. Every
/// such call writes a row to <c>ssf.cross_border_transfers</c>
/// (Phase 05); a regex-only detector keeps the cross-border volume at
/// the heuristic floor.
///
/// <para>
/// <b>How we assert it.</b> Source-grep the
/// <c>HeuristicWorkerNameDetector.cs</c> file: it MUST NOT reference
/// any Gemini / Sarvam / IHttpClient / cross_border_transfers symbol.
/// The companion <c>RlsExemptionAllowlistTests</c> already enforces
/// that net-new tables must be added to a deliberate allow-list; this
/// test closes the symmetric "no new cross-border writes" hole.
/// </para>
/// </summary>
public sealed class HeuristicPiiDetectorPureTests
{
    [Fact]
    public void HeuristicWorkerNameDetector_source_has_no_cross_border_or_http_dependencies()
    {
        var path = Path.Combine(
            TestPathHelper.GetAppsRoot(),
            "ShramSafal",
            "ShramSafal.Infrastructure",
            "Privacy",
            "HeuristicWorkerNameDetector.cs");

        Assert.True(File.Exists(path),
            $"HeuristicWorkerNameDetector.cs not found at {path}.");

        var source = File.ReadAllText(path);

        // Forbidden symbols — any reference is a smell that the detector
        // is doing more than regex matching.
        var forbidden = new[]
        {
            "IHttpClientFactory",
            "HttpClient",
            "GeminiClient",
            "SarvamClient",
            "GeminiAiProvider",
            "SarvamAiProvider",
            "CrossBorderTransfer",
            "cross_border_transfers",
            "IAiProvider",
        };

        var violations = forbidden
            .Where(needle => Regex.IsMatch(source, $@"\b{Regex.Escape(needle)}\b"))
            .ToList();

        Assert.True(violations.Count == 0,
            "HeuristicWorkerNameDetector must not reference any of: "
            + string.Join(", ", violations)
            + ". Per OQ-2 verdict the detector is heuristic-only; adding an "
            + "HTTP/Gemini path would inflate cross-border telemetry.");
    }
}
