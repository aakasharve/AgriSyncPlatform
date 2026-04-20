namespace Accounts.Domain.Subscriptions;

/// <summary>
/// Plan identifiers for subscriptions. Kept as string constants rather than
/// an enum so new plans can ship without a domain rebuild.
/// </summary>
public static class PlanCode
{
    public const string Free = "free";
    public const string ShramSafalPro = "shramsafal_pro";
}
