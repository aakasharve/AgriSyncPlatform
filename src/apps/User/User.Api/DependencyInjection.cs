using AgriSync.BuildingBlocks.Auth.Jwt;
using User.Application.UseCases.Auth;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.StartOtp;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Application.UseCases.Users.GetMeContext;
using User.Infrastructure;

namespace User.Api;

public static class DependencyInjection
{
    public static IServiceCollection AddUserApi(this IServiceCollection services, IConfiguration configuration)
    {
        // Infrastructure (DbContext, repos, password hasher, JWT issuer, SMS sender)
        services.AddUserInfrastructure(configuration);

        // JWT token validation (shared BuildingBlocks extension)
        services.AddJwtTokenValidation(configuration);
        services.AddAuthorization();

        // Phase 3 OTP policy (plan §5.2) — Application-layer, provider-agnostic.
        services.Configure<OtpPolicyOptions>(configuration.GetSection(OtpPolicyOptions.SectionName));

        // Use-case handlers
        services.AddScoped<RegisterUserHandler>();
        services.AddScoped<LoginHandler>();
        services.AddScoped<RefreshTokenHandler>();
        services.AddScoped<GetMeContextHandler>();
        services.AddScoped<StartOtpHandler>();
        services.AddScoped<VerifyOtpHandler>();

        return services;
    }
}
