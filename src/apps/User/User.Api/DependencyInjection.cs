using AgriSync.BuildingBlocks.Auth.Jwt;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Users.GetCurrentUser;
using User.Infrastructure;

namespace User.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddUserApi(this IServiceCollection services, IConfiguration configuration)
    {
        // Infrastructure (DbContext, repos, password hasher, JWT issuer)
        services.AddUserInfrastructure(configuration);

        // JWT token validation (shared BuildingBlocks extension)
        services.AddJwtTokenValidation(configuration);
        services.AddAuthorization();

        // Use-case handlers
        services.AddScoped<RegisterUserHandler>();
        services.AddScoped<LoginHandler>();
        services.AddScoped<RefreshTokenHandler>();
        services.AddScoped<GetCurrentUserHandler>();

        return services;
    }
}
