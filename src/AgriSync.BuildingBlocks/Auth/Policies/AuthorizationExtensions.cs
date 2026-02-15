using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks.Auth.Policies;

public static class AuthorizationExtensions
{
    public static IServiceCollection AddDefaultPermissionPolicies(this IServiceCollection services)
    {
        services.AddPermissionPolicy("Users.Manage", PermissionNames.ManageUsers);
        services.AddPermissionPolicy("Memberships.Manage", PermissionNames.ManageMemberships);
        services.AddPermissionPolicy("Logs.Manage", PermissionNames.ManageLogs);

        return services;
    }
}
