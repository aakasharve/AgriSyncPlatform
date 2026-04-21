namespace ShramSafal.Domain.Compliance;

public static class ComplianceEvaluator
{
    public static IReadOnlyList<(ComplianceRule Rule, ComplianceEvidence Evidence)> Evaluate(
        ComplianceEvaluationInput input)
    {
        var results = new List<(ComplianceRule, ComplianceEvidence)>();

        foreach (var rule in ComplianceRuleBook.Rules)
        {
            var evidences = rule.Evaluate(input);
            foreach (var ev in evidences)
            {
                results.Add((rule, ev));
            }
        }

        return results;
    }
}
