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
}
