using AgriSync.BuildingBlocks.Persistence;
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

        // DATA_PRINCIPLE_SPINE 03.6 — register TenantContext +
        // TenantConnectionInterceptor here as well as in
        // AddShramSafalInfrastructure so the Sync Integration test
        // harness and any standalone User-only host pick them up.
        // TryAddScoped is idempotent — if Program.cs (or
        // AddShramSafalInfrastructure) already registered them this is
        // a no-op.
        services.TryAddScoped<AgriSync.BuildingBlocks.Persistence.TenantContext>();
        services.TryAddScoped<AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor>();

        // DATA_PRINCIPLE_SPINE 03.6 — append UserDbContext to the
        // tenant-scoped writing-context registry so
        // TenantTransactionMiddleware opens an explicit tx on it per
        // request. Without this the interceptor's
        // `set_config('agrisync.user_id', ..., true)` GUC would
        // evaporate after the per-command auto-commit transaction and
        // the UserDb RLS policy (memberships.user_id) would see NULL
        // → return 0 rows silently.
        var userWritingContexts = services
            .EnsureTenantScopedRegistry();
        userWritingContexts.Register<UserDbContext>();

        // DATA_PRINCIPLE_SPINE 03.6 — UserDbContext now uses
        // AddDbContext with the (sp, options) overload so the scoped
        // TenantConnectionInterceptor can be resolved per-request and
        // attached to the options chain. This keeps the third
        // `agrisync.user_id` GUC the interceptor emits (added in 03.6)
        // visible to the UserDb RLS policies installed by migration
        // 20260516150000_EnableUserDbRowLevelSecurity.
        //
        // Do NOT switch to AddDbContextPool — pooled contexts share
        // interceptors across scopes and would smear tenant claims
        // between requests. The same ban applies to
        // ShramSafalDbContext; see its registration's XML doc for
        // rationale.
        services.AddDbContext<UserDbContext>((sp, options) =>
            options.UseNpgsql(
                configuration.GetConnectionString("UserDb"),
                npgsql =>
                {
                    npgsql.MigrationsHistoryTable("__ef_migrations", "public");
                    // DATA_PRINCIPLE_SPINE 03.6 — EnableRetryOnFailure removed
                    // because UserDbContext is now wrapped by
                    // TenantTransactionMiddleware (per-request explicit
                    // transaction so set_config GUCs propagate). EF Core's
                    // retry strategy is incompatible with user-initiated
                    // transactions. Same call as ShramSafalDbContext registration.
                })
                .AddInterceptors(
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>(),
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>(),
                    sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor>()));

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
