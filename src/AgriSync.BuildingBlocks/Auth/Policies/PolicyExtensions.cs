using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks.Auth.Policies;

public static class PolicyExtensions
{
    public static IServiceCollection AddPermissionPolicy(this IServiceCollection services, string policyName, string permissionName)
    {
        services.AddAuthorizationBuilder()
            .AddPolicy(policyName, policy =>
            {
                policy.RequireAuthenticatedUser();
                policy.RequireClaim("permission", permissionName);
            });

        return services;
    }
}
