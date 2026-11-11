using System.Security.Claims;

namespace AgriSync.Bootstrapper.Middleware;

/// <summary>
/// The signed-in user's id, read from the standard <c>sub</c> /
/// <c>NameIdentifier</c> claim. One reader for
/// <c>AnalyticsIngestEndpoints</c> and <c>RequestObservabilityMiddleware</c>,
/// so the two cannot disagree about who a request came from.
/// </summary>
internal static class ClaimsUserId
{
    public static Guid? TryGet(ClaimsPrincipal? user)
    {
        if (user?.Identity?.IsAuthenticated != true)
        {
            return null;
        }

        // Match the claim resolution used by every other authenticated
        // endpoint in the Bootstrapper (see ResolveAiRateLimitPartitionKey
        // in Program.cs and FirstFarmBootstrapEndpoints.TryGetUserId).
        var subject =
            user.FindFirst("sub")?.Value ??
            user.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return Guid.TryParse(subject, out var userId) ? userId : null;
    }
}
