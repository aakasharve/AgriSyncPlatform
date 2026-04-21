namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed record AttentionCardDto(
    Guid CardId,
    Guid FarmId,
    string FarmName,
    Guid PlotId,
    string PlotName,
    Guid? CropCycleId,
    string? StageName,
    AttentionRank Rank,
    string TitleEn,
    string TitleMr,
    string DescriptionEn,
    string DescriptionMr,
    SuggestedActionKind SuggestedAction,   // CEI-I6: NEVER null (non-nullable struct)
    string SuggestedActionLabelEn,
    string SuggestedActionLabelMr,
    int? OverdueTaskCount,
    string? LatestHealthScore,             // "Excellent"|"Good"|"NeedsAttention"|"Critical" — string to avoid cross-layer enum exposure
    int? UnresolvedDisputeCount,
    int? MissingTestCount,                 // CEI Phase 2 §4.5 — Due/Overdue tests at or past their planned due date
    int OpenComplianceSignalCount,         // CEI Phase 3 §4.6 — open compliance signals for this plot
    DateTime ComputedAtUtc);

public enum AttentionRank { Critical = 0, NeedsAttention = 1, Watch = 2, Healthy = 3 }
