namespace ShramSafal.Domain.Compliance;

public enum ComplianceSeverity
{
    Info = 0,            // purely informational — displayed but not ranked into attention
    Watch = 1,           // shown on attention board as Watch
    NeedsAttention = 2,  // shown on attention board as NeedsAttention
    Critical = 3         // shown on attention board as Critical
}
