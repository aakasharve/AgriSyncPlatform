using Accounts.Application.Ports;
using Accounts.Infrastructure.Persistence;
using Accounts.Infrastructure.Persistence.Repositories;
using Accounts.Domain.Affiliation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Accounts.Infrastructure;

public static class DependencyInjection
{
    public const string ConnectionStringName = "AccountsDb";

    /// <summary>
    /// Registers the <see cref="AccountsDbContext"/> with the
    /// <c>AccountsDb</c> connection string (falls back to <c>UserDb</c>
    /// for single-DB development — all apps share the same PostgreSQL
    /// instance under different schemas).
    /// </summary>
    public static IServiceCollection AddAccountsInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString = configuration.GetConnectionString(ConnectionStringName)
            ?? configuration.GetConnectionString("UserDb")
            ?? throw new InvalidOperationException(
                $"Connection string '{ConnectionStringName}' (or fallback 'UserDb') must be configured.");

        // T-IGH-03-OUTBOX-WIRING: outbox interceptors. Domain events
        // raised by Subscription / OwnerAccount aggregates flow into
        // the shared ssf.outbox_messages table.
        services.TryAddSingleton<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>(sp =>
            new AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor(TimeProvider.System));
        services.TryAddSingleton<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>(sp =>
            new AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor(
                sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>()));

        services.AddDbContext<AccountsDbContext>((sp, options) =>
        {
            options.UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsHistoryTable(
                    tableName: "__accounts_migrations_history",
                    schema: AccountsDbContext.SchemaName);
                npgsql.EnableRetryOnFailure(
                    maxRetryCount: 5,
                    maxRetryDelay: TimeSpan.FromSeconds(10),
                    errorCodesToAdd: null);
            })
            .AddInterceptors(
                sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.DomainEventToOutboxInterceptor>(),
                sp.GetRequiredService<AgriSync.BuildingBlocks.Persistence.Outbox.OutboxTransactionInterceptor>());
        });

        services.AddScoped<IOwnerAccountRepository, OwnerAccountRepository>();
        services.AddScoped<ISubscriptionRepository, SubscriptionRepository>();
        services.AddScoped<IAffiliationRepository, AffiliationRepository>();
        services.AddScoped<IOwnerAccountRepository, OwnerAccountRepository>();

        return services;
    }
}
