namespace ShramSafal.Domain.Compliance;

// Rule codes are stable string constants — stored on the signal, rendered in exports.
public static class ComplianceRuleCode
{
    public const string MissedTaskThresholdWeek = "compliance.missed-tasks.week>=3";
    public const string RepeatedSkipsPerActivity = "compliance.repeated-skips.activity>=3";
    public const string SkippedTestOverdue = "compliance.skipped-test.overdue-days>=7";
    public const string ResidueRiskReported = "compliance.residue.high-reported";
    public const string UnresolvedDisputeAgeHigh = "compliance.dispute.age-days>=3";
    public const string ProtocolBreakInStage = "compliance.stage.health-critical>=3-days";

    // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2) - products a reviewed, sourced rule says must never share a tank,
    // given together in one saved record (see InputMixRule).
    public const string InputMixNeverTogether = "compliance.input-mix.never-together";
}
