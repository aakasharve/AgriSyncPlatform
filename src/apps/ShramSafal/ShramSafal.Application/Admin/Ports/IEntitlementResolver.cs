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

    /// <summary>
    /// spec: plr-d10 lane F99 fix pass 2 (review N-8) — ShramSafal's platform admin: an ACTIVE Owner seat of an ACTIVE
    /// Platform organisation, whichever of his seats is selected (no org header). The one rule for the global price list
    /// (D-72): the write and the phone's "may I edit it" both ask this. QUIET: unlike <see cref="ResolveAsync"/> it records
    /// no admin-scope analytics event, so a farmer opening the price book is not counted as an unauthorised admin.
    /// The default (for test doubles) reads the resolved scope; the real resolver asks the database directly.
    /// </summary>
    async Task<bool> IsPlatformOwnerAsync(UserId userId, CancellationToken ct)
    {
        var resolved = await ResolveAsync(userId, activeOrgId: null, ct);
        return resolved.Scope is { IsPlatformAdmin: true }
            || resolved.Memberships.Any(m =>
                m.OrganizationType == OrganizationType.Platform && m.OrganizationRole == OrganizationRole.Owner);
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-A (Task 3; founder D-74, L8-R) - may this person CHECK library schedules? A schedule check is a
    /// ShramSafal PLATFORM act: an ACTIVE seat of an ACTIVE Platform organisation whose role holds WRITE on
    /// <see cref="ModuleKey.ScheduleReview"/> in <see cref="EntitlementMatrix"/> (Platform Owner and Employee; the Analyst
    /// only reads). Never a farm seat: a farm's primary owner, and a farm seat with <c>AppRole.Agronomist</c>, hold nothing
    /// here. QUIET like <see cref="IsPlatformOwnerAsync"/>: no admin-scope analytics event. The default (for test doubles)
    /// reads the resolved memberships; the real resolver asks the database directly.
    /// </summary>
    async Task<bool> MayCheckSchedulesAsync(UserId userId, CancellationToken ct)
    {
        var resolved = await ResolveAsync(userId, activeOrgId: null, ct);
        return resolved.Memberships.Any(m =>
            m.OrganizationType == OrganizationType.Platform
            && EntitlementMatrix.For(m.OrganizationType, m.OrganizationRole)
                .Any(e => e.ModuleKey == ModuleKey.ScheduleReview && e.CanWrite));
    }

    /// <summary>
    /// spec: plr-d10 lane SCH-A (Task 4) - may this person READ the schedule-check queue? Platform Owner, Employee and
    /// Analyst (read on <see cref="ModuleKey.ScheduleReview"/>); nobody else. Same seats and quietness as
    /// <see cref="MayCheckSchedulesAsync"/>.
    /// </summary>
    async Task<bool> MayReadScheduleChecksAsync(UserId userId, CancellationToken ct)
    {
        var resolved = await ResolveAsync(userId, activeOrgId: null, ct);
        return resolved.Memberships.Any(m =>
            m.OrganizationType == OrganizationType.Platform
            && EntitlementMatrix.For(m.OrganizationType, m.OrganizationRole)
                .Any(e => e.ModuleKey == ModuleKey.ScheduleReview && e.CanRead));
    }

    /// <summary>
    /// spec: plr-d10 lane RATE-1 fix round 1 (review F7) — which of these people are platform owners, by the SAME rule as
    /// <see cref="IsPlatformOwnerAsync"/>: the suggestion door asks it once for every author of the shared price list. The
    /// default (for test doubles) asks the one-person rule per person; the real resolver answers in one query.
    /// </summary>
    async Task<IReadOnlySet<Guid>> PlatformOwnersAmongAsync(IReadOnlyCollection<UserId> userIds, CancellationToken ct)
    {
        var owners = new HashSet<Guid>();
        foreach (var userId in userIds.Distinct())
        {
            if (await IsPlatformOwnerAsync(userId, ct))
            {
                owners.Add(userId.Value);
            }
        }

        return owners;
    }
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
