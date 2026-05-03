namespace ShramSafal.Application.Wtl;

/// <summary>
/// Extracts candidate worker names from a Marathi-language daily-log
/// transcript. Pure function — no AI, no I/O.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.3 / ADR <c>2026-05-04 wtl-v0-entity-shape</c>. The default
/// implementation is <c>RegexWorkerNameExtractor</c> in the
/// Infrastructure layer; the contract sits here so the
/// <c>WorkerNameProjector</c> can depend on the abstraction.
/// </para>
/// <para>
/// The extractor is precision-over-recall: rare phrasings simply do not
/// extract names rather than introducing wrong ones. Returning an empty
/// list for ambiguous transcripts is the correct behaviour.
/// </para>
/// </remarks>
public interface IWorkerNameExtractor
{
    /// <summary>
    /// Returns distinct candidate worker names extracted from the
    /// supplied transcript. Returns an empty list if
    /// <paramref name="transcript"/> is null, empty, whitespace, or
    /// contains no recognised worker patterns.
    /// </summary>
    IReadOnlyList<string> ExtractFromMarathiTranscript(string? transcript);
}
