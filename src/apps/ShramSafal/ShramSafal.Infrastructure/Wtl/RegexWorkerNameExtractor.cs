using ShramSafal.Application.Wtl;

namespace ShramSafal.Infrastructure.Wtl;

/// <summary>
/// Default <see cref="IWorkerNameExtractor"/> implementation. Pure
/// regex over Devanagari script — NO AI, NO I/O. Implementation lands
/// in the follow-up commit; this stub locks the contract so the
/// behaviour matrix in <c>RegexWorkerNameExtractorTests</c> can be
/// committed first and observed failing.
/// </summary>
/// <remarks>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>.
/// </remarks>
public sealed class RegexWorkerNameExtractor : IWorkerNameExtractor
{
    public IReadOnlyList<string> ExtractFromMarathiTranscript(string? transcript)
    {
        // Stub — replaced in the implementation commit. Tests that
        // expect empty results coincidentally pass; tests that expect
        // names will (correctly) fail.
        return Array.Empty<string>();
    }
}
