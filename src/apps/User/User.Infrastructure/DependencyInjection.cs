using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using User.Application.Ports;
using User.Application.Ports.External;
using User.Infrastructure.Otp;
using User.Infrastructure.Persistence;
using User.Infrastructure.Persistence.Repositories;
using User.Infrastructure.Security;

namespace User.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddUserInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        // T-IGH-03-OUTBOX-WIRING: register the outbox interceptors and
        // attach them to UserDbContext so domain events raised by
        // User aggregates (UserRegisteredEvent, MembershipChangedEvent)
        // land in the shared ssf.outbox_messages table.
        services.TryAddSingleton<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>(sp =>
            new AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor(TimeProvider.System));
        services.TryAddSingleton<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>(sp =>
            new AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor(
                sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>()));

        services.AddDbContext<UserDbContext>((sp, options) =>
            options.UseNpgsql(
                configuration.GetConnectionString("UserDb"),
                npgsql =>
                {
                    npgsql.MigrationsHistoryTable("__ef_migrations", "public");
                    npgsql.EnableRetryOnFailure(
                        maxRetryCount: 5,
                        maxRetryDelay: TimeSpan.FromSeconds(10),
                        errorCodesToAdd: null);
                })
                .AddInterceptors(
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>(),
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>()));

        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IRefreshTokenRepository, RefreshTokenRepository>();
        services.AddScoped<IOtpChallengeRepository, OtpChallengeRepository>();
        services.AddSingleton<IPasswordHasher, BcryptPasswordHasher>();
        services.AddSingleton<IJwtTokenService, JwtTokenIssuer>();

        // OTP gateway. Dev builds log the OTP to the console via DevStubSmsSender;
        // prod builds call MSG91. Selection is controlled by the Msg91:UseDevStub
        // flag so a misconfigured prod deploy fails loudly rather than silently
        // skipping SMS.
        services.Configure<Msg91Options>(configuration.GetSection(Msg91Options.SectionName));

        var msg91Section = configuration.GetSection(Msg91Options.SectionName);
        var useDevStub = msg91Section.GetValue<bool>(nameof(Msg91Options.UseDevStub), defaultValue: true);

        if (useDevStub)
        {
            services.AddScoped<ISmsSender, DevStubSmsSender>();
        }
        else
        {
            services.AddHttpClient<ISmsSender, Msg91SmsSender>(client =>
            {
                client.Timeout = TimeSpan.FromSeconds(10);
            });
        }

        return services;
    }
}
