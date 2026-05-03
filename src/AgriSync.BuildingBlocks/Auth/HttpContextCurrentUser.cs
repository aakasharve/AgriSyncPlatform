using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Auth;

/// <summary>
/// HttpContext-backed implementation of <see cref="ICurrentUser"/>. Reads
/// the authenticated user's subject from the standard <c>sub</c> /
/// <c>NameIdentifier</c> claims set by the JWT bearer pipeline.
/// </summary>
/// <remarks>
/// <para>
/// Match the claim resolution used by every other authenticated endpoint
/// in this codebase — see <c>ResolveAiRateLimitPartitionKey</c> in
/// <c>Program.cs</c>, <c>FirstFarmBootstrapEndpoints.TryGetUserId</c>, and
/// <c>EndpointActorContext.TryGetUserId</c>. Keeping the lookup in a
/// single shared adapter ends the per-endpoint copy-paste of the same
/// claim resolution.
/// </para>
/// <para>
/// Returns <c>null</c> when the request is anonymous, the principal is
/// missing, or no subject claim is present. Callers that need a strict
/// guarantee of authenticated state should also check
/// <see cref="ClaimsPrincipal.Identity"/>.<see cref="System.Security.Principal.IIdentity.IsAuthenticated"/>
/// at the endpoint layer (the auth middleware already does this for
/// <c>RequireAuthorization()</c> routes).
/// </para>
/// </remarks>
public sealed class HttpContextCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    public string? UserId
    {
        get
        {
            var user = accessor.HttpContext?.User;
            if (user?.Identity?.IsAuthenticated != true)
            {
                return null;
            }

            var subject =
                user.FindFirst("sub")?.Value ??
                user.FindFirst(ClaimTypes.NameIdentifier)?.Value;

            return string.IsNullOrWhiteSpace(subject) ? null : subject;
        }
    }
}
