namespace ShramSafal.Application.Contracts.Dtos;

/// <summary>
/// One day of activity counts for a farm — drives the 14-day timeline
/// grid in the Mode A drilldown UI (per
/// <c>UI_DESIGN_BRIEF_GEMINI.md</c> Band 3).
/// </summary>
/// <remarks>
/// <para>
/// Sourced from <c>analytics.events</c> grouped by day and event_type.
/// All counts are non-negative integers; absent days are surfaced as a
/// row with all zeros so the calendar grid stays a fixed 14-cell layout.
/// </para>
/// </remarks>
public sealed record FarmerHealthTimelineDto(
    DateOnly Date,
    int ClosuresStarted,
    int ClosuresSubmitted,
    int ProofAttached,
    int SummariesViewed,
    int Verifications,
    int Errors);
