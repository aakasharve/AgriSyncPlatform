namespace ShramSafal.Domain.Compliance;

public enum ComplianceSuggestedAction
{
    OpenPlot = 0,
    OpenStageCompare = 1,
    AssignTest = 2,
    ScheduleMissingActivity = 3,
    ResolveDispute = 4,
    ContactAgronomist = 5,
    AcknowledgeOnly = 6   // rare — signals where action isn't possible yet; CEI-I6 still satisfied (non-null)
}
