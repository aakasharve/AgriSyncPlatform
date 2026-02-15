using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddShramSafalInfrastructure(this IServiceCollection services, IConfiguration configuration)
    {
        var connectionString =
            configuration.GetConnectionString("ShramSafalDb") ??
            configuration.GetConnectionString("UserDb") ??
            throw new InvalidOperationException("Connection string 'ShramSafalDb' or 'UserDb' is required.");

        services.AddDbContext<ShramSafalDbContext>(options =>
            options.UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf")));

        services.AddScoped<IShramSafalRepository, ShramSafalRepository>();
        services.AddScoped<ISyncMutationStore, SyncMutationStore>();
        return services;
    }
}
