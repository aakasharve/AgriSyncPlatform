namespace ShramSafal.Application.Contracts.Dtos;

public sealed record ComplianceSignalDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    string RuleCode,
    string Severity,        // "Info" | "Watch" | "NeedsAttention" | "Critical"
    string SuggestedAction, // enum name
    string TitleEn,
    string TitleMr,
    string DescriptionEn,
    string DescriptionMr,
    string PayloadJson,
    DateTime FirstSeenAtUtc,
    DateTime LastSeenAtUtc,
    DateTime? AcknowledgedAtUtc,
    DateTime? ResolvedAtUtc,
    string? ResolutionNote,
    bool IsOpen);
