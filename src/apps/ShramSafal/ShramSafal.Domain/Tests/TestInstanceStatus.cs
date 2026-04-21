namespace ShramSafal.Domain.Tests;

/// <summary>
/// Lifecycle state of a <see cref="TestInstance"/>. See CEI §4.5.
/// Numeric values are stable and safe to persist.
/// </summary>
public enum TestInstanceStatus
{
    Due = 0,
    Collected = 1,
    Reported = 2,
    Overdue = 3,
    Waived = 4
}
