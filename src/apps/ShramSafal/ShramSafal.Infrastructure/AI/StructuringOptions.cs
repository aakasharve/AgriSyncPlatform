namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// spec: voice-instant-phase-a-2026-11-23 (Task 5) — how many parts of a long transcript are sorted at the same time.
/// Bound from <c>Ai:Structuring</c>. When the section or the value is absent the default stays 2, exactly the number
/// that was hard-wired before, so a settings file that does not name it behaves as it always did; the shipped
/// production settings name 4 (a 10-minute note is about 25 speech pieces and the sorting prompt is large, so more
/// parts at once is the main wait left once speech-to-text is parallel).
/// </summary>
public sealed class StructuringOptions
{
    public const string SectionName = "Ai:Structuring";

    /// <summary>Parts of one transcript sorted at once. Less than 1 means "not set" and reads as the default.</summary>
    public int MaxParallel { get; set; } = ChunkedStructuring.DefaultMaxParallel;
}
