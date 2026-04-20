using Accounts.Api.Endpoints;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;

namespace Accounts.Api;

public static class ModuleEndpoints
{
    public static IEndpointRouteBuilder MapAccountsModuleEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/accounts/health", () => Results.Ok(new { status = "ok", module = "accounts" }))
            .WithTags("Accounts")
            .AllowAnonymous();

        endpoints.MapSubscriptionWebhookEndpoints();

        return endpoints;
    }
}
