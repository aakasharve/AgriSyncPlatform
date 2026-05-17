// spec: data-principle-spine-2026-05-05/10.4
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using ShramSafal.Infrastructure.Privacy;

namespace ShramSafal.Api.Authorization;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 10 sub-phase 10.4 — guards the
/// <c>/shramsafal/admin/pii-review/*</c> endpoints. Per OQ-6 verdict
/// V1 reviewer pool is 1-3 humans (akash + ops); allow-list ships in
/// hours via <see cref="PiiOptions.ReviewerUserIds"/>. Promote to a
/// <c>ssf.pii_reviewer_role</c> table when the reviewer count exceeds
/// five.
///
/// <para>
/// <b>Policy name.</b> Register as <c>"pii_reviewer"</c> on
/// <see cref="AuthorizationOptions.AddPolicy"/>. Endpoints attach via
/// <c>[Authorize(Policy = "pii_reviewer")]</c> or
/// <c>RequireAuthorization("pii_reviewer")</c>.
/// </para>
/// </summary>
public sealed class PiiReviewerRequirement : IAuthorizationRequirement
{
    public const string PolicyName = "pii_reviewer";
}

/// <summary>
/// Authorization handler — reads the caller's user-id from the JWT
/// <c>sub</c> / <c>nameidentifier</c> claim and checks it against the
/// configured allow-list.
/// </summary>
public sealed class PiiReviewerAuthorizationHandler : AuthorizationHandler<PiiReviewerRequirement>
{
    private readonly IOptionsMonitor<PiiOptions> _options;

    public PiiReviewerAuthorizationHandler(IOptionsMonitor<PiiOptions> options)
    {
        _options = options;
    }

    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PiiReviewerRequirement requirement)
    {
        var snapshot = _options.CurrentValue;
        if (snapshot.ReviewerUserIds is null || snapshot.ReviewerUserIds.Length == 0)
        {
            // No reviewers configured — fail closed. The policy stays
            // unsatisfied; the endpoint returns 403.
            return Task.CompletedTask;
        }

        var sub = context.User.FindFirst(ClaimTypes.NameIdentifier)?.Value
                  ?? context.User.FindFirst("sub")?.Value;
        if (string.IsNullOrWhiteSpace(sub))
        {
            return Task.CompletedTask;
        }

        // Allow-list compare. Strict ordinal (uppercase-Guid friendly)
        // covers the parse path even when an operator pasted a
        // canonical 36-char form into appsettings.
        foreach (var allowed in snapshot.ReviewerUserIds)
        {
            if (string.Equals(sub.Trim(), allowed?.Trim(), StringComparison.OrdinalIgnoreCase))
            {
                context.Succeed(requirement);
                return Task.CompletedTask;
            }
        }

        return Task.CompletedTask;
    }
}
