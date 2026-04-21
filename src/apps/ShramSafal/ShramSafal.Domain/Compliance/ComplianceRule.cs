using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Compliance;

public sealed record ComplianceEvidence(
    FarmId FarmId,
    Guid PlotId,
    Guid? CropCycleId,
    string PayloadJson,
    string DescriptionEn,
    string DescriptionMr);

public sealed record ComplianceRule(
    string RuleCode,
    ComplianceSeverity Severity,
    ComplianceSuggestedAction SuggestedAction,
    string TitleEn,
    string TitleMr,
    Func<ComplianceEvaluationInput, IReadOnlyList<ComplianceEvidence>> Evaluate);
