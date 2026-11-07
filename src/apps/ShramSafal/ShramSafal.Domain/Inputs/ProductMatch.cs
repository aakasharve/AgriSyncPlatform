// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT1, Task 2)
namespace ShramSafal.Domain.Inputs;

/// <summary>What his spoken product name came to against the catalogue.</summary>
public enum MatchState
{
    /// <summary>No product carries this exact name. Never "found" with half credit.</summary>
    NotFound,

    /// <summary>Exactly one product carries it. "Found in the list", not yet confirmed by him.</summary>
    Found,

    /// <summary>More than one product carries it. Never the first-listed one.</summary>
    Ambiguous,
}

/// <summary>The match result. <see cref="ProductId"/> is set only when <see cref="State"/> is
/// <see cref="MatchState.Found"/>; <see cref="CandidateIds"/> lists every product that matched, in
/// catalogue order.</summary>
public sealed record ProductMatch(MatchState State, string? ProductId, IReadOnlyList<string> CandidateIds);
