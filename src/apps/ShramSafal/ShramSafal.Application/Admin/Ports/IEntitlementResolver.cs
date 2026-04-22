using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Application.Admin.Ports;

/// <summary>
/// Resolves the caller's AdminScope for the currently-selected active org.
/// Every admin HTTP endpoint routes through this port before any business logic runs.
/// </summary>
public interface IEntitlementResolver
{
    Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct);
}

public enum ResolveOutcome
{
    /// <summary>Scope resolved successfully. Render normally.</summary>
    Resolved = 0,

    /// <summary>User has zero active memberships. HTTP 401.</summary>
    Unauthorized = 1,

    /// <summary>User has multiple memberships and did not specify activeOrgId. HTTP 428.</summary>
    Ambiguous = 2,

    /// <summary>activeOrgId was provided but user has no active membership in that org. HTTP 403.</summary>
    NotInOrg = 3
}

public sealed record MembershipSummary(
    Guid OrganizationId,
    string OrganizationName,
    OrganizationType OrganizationType,
    OrganizationRole OrganizationRole);

public sealed record ResolveResult(
    ResolveOutcome Outcome,
    AdminScope? Scope,
    IReadOnlyList<MembershipSummary> Memberships)
{
    public static ResolveResult Resolved(AdminScope scope, IReadOnlyList<MembershipSummary> all)
        => new(ResolveOutcome.Resolved, scope, all);

    public static ResolveResult Unauthorized()
        => new(ResolveOutcome.Unauthorized, null, Array.Empty<MembershipSummary>());

    public static ResolveResult Ambiguous(IReadOnlyList<MembershipSummary> options)
        => new(ResolveOutcome.Ambiguous, null, options);

    public static ResolveResult NotInOrg(IReadOnlyList<MembershipSummary> memberships)
        => new(ResolveOutcome.NotInOrg, null, memberships);
}
