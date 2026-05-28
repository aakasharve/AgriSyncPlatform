using AgriSync.BuildingBlocks.Auth.Jwt;
using Microsoft.Extensions.Options;
using User.Application.UseCases.Auth;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.StartOtp;
using User.Application.UseCases.Auth.TestLogin;
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

        // SARVAM_DEPLOY_READINESS gate B6 enabler (2026-05-28) —
        // test-login bypass options. Always bound so the
        // TestLoginOptions instance is available for the
        // endpoint-registration gating in AuthEndpoints. The handler
        // itself is registered ONLY when the flag is on (below) so
        // an Enabled=false config produces a DI miss for any code
        // path that tries to resolve the handler.
        services.Configure<TestLoginOptions>(configuration.GetSection(TestLoginOptions.SectionName));

        // Use-case handlers
        services.AddScoped<RegisterUserHandler>();
        services.AddScoped<LoginHandler>();
        services.AddScoped<RefreshTokenHandler>();
        services.AddScoped<GetMeContextHandler>();
        services.AddScoped<StartOtpHandler>();
        services.AddScoped<VerifyOtpHandler>();

        // SARVAM_DEPLOY_READINESS gate B6 enabler — conditional
        // handler registration. Read the bound options synchronously
        // from configuration so the registration decision is made
        // exactly once at startup, not per-request. When Enabled=false
        // (the default + production posture), the handler is never
        // added to the container; an accidental request reaching the
        // would-be endpoint resolves to nothing and the request
        // returns 404.
        var testLoginEnabled = configuration
            .GetSection(TestLoginOptions.SectionName)
            .GetValue<bool>(nameof(TestLoginOptions.Enabled), defaultValue: false);
        if (testLoginEnabled)
        {
            services.AddScoped<TestLoginHandler>();
        }

        return services;
    }
}
