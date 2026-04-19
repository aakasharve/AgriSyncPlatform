using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Accounts.Api;

public static class ModuleEndpoints
{
    /// <summary>
    /// Mount point for Accounts endpoints. Currently exposes only a health
    /// probe so a successful boot can be verified before any real routes
    /// (OwnerAccount CRUD, Subscription webhook) land.
    /// </summary>
    public static IEndpointRouteBuilder MapAccountsModuleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/accounts/health", () => Results.Ok(new { status = "ok", module = "accounts" }))
            .WithTags("Accounts")
            .AllowAnonymous();

        return endpoints;
    }
}
