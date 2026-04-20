using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks.Analytics;

public static class AnalyticsDependencyInjection
{
    /// <summary>
    /// Registers the analytics event rail: <see cref="AnalyticsDbContext"/>
    /// and the failure-isolated <see cref="IAnalyticsWriter"/> implementation.
    /// The caller supplies the DB provider (e.g. <c>opts.UseNpgsql(conn, npgsql =&gt; ...)</c>)
    /// to keep BuildingBlocks provider-neutral.
    /// </summary>
    public static IServiceCollection AddAnalytics(
        this IServiceCollection services,
        Action<DbContextOptionsBuilder> configureDbContext)
    {
        services.AddDbContext<AnalyticsDbContext>(configureDbContext);
        services.AddScoped<IAnalyticsWriter, AnalyticsWriter>();
        return services;
    }
}
