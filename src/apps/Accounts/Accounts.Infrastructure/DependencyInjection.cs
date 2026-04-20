using Accounts.Application.Ports;
using Accounts.Infrastructure.Persistence;
using Accounts.Infrastructure.Persistence.Repositories;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

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

        services.AddDbContext<AccountsDbContext>(options =>
        {
            options.UseNpgsql(connectionString, npgsql =>
            {
                npgsql.MigrationsHistoryTable(
                    tableName: "__accounts_migrations_history",
                    schema: AccountsDbContext.SchemaName);
            });
        });

        services.AddScoped<ISubscriptionRepository, SubscriptionRepository>();

        return services;
    }
}
