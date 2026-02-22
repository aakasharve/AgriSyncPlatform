using System.Security.Claims;

namespace ShramSafal.Api.Endpoints;

internal static class EndpointActorContext
{
    private const string SubjectClaimType = "sub";
    private const string MembershipClaimType = "membership";
    private const string AppId = "shramsafal";

    public static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
    {
        var subject = user.FindFirstValue(SubjectClaimType);
        if (subject is not null && Guid.TryParse(subject, out userId))
        {
            return true;
        }

        userId = Guid.Empty;
        return false;
    }

    public static string GetActorRole(ClaimsPrincipal user)
    {
        foreach (var claim in user.FindAll(MembershipClaimType))
        {
            if (string.IsNullOrWhiteSpace(claim.Value))
            {
                continue;
            }

            var parts = claim.Value.Split(':', 2, StringSplitOptions.TrimEntries);
            if (parts.Length == 2 && string.Equals(parts[0], AppId, StringComparison.OrdinalIgnoreCase))
            {
                return string.IsNullOrWhiteSpace(parts[1]) ? "unknown" : parts[1];
            }
        }

        return "unknown";
    }
}
