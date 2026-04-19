using System;
using System.Data;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;
using Serilog.Context;
using Npgsql;


namespace AgriSync.Bootstrapper.Jobs
{
    public class MisRefreshJob : BackgroundService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<MisRefreshJob> _logger;
        // Default: 2 AM every day. For a simpler implementation without cron packages, we check periodically.
        private readonly TimeSpan _checkInterval = TimeSpan.FromHours(1);
        private DateTime _lastRunDate = DateTime.MinValue;

        private static readonly string[] ViewsToRefresh = new[]
        {
            "mis.wvfd_weekly",
            "mis.silent_churn_watchlist",
            "mis.d30_retention_paying",
            "mis.log_verify_lag",
            "mis.correction_rate",
            "mis.voice_log_share",
            "mis.activation_funnel",
            "mis.engagement_tier",
            "mis.schedule_adoption_rate",
            "mis.schedule_migration_rate",
            "mis.schedule_abandonment_rate",
            "mis.schedule_unscheduled_ratio",
            "mis.gemini_cost_per_farm"
        };

        public MisRefreshJob(IServiceProvider serviceProvider, ILogger<MisRefreshJob> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("MisRefreshJob starting.");

            while (!stoppingToken.IsCancellationRequested)
            {
                var now = DateTime.UtcNow;
                
                // CRON: 0 2 * * * (Run at 2 AM UTC)
                // Since this runs in a loop, we check if it is past 2 AM and we haven't run today.
                if (now.Hour >= 2 && _lastRunDate.Date < now.Date)
                {
                    _lastRunDate = now.Date;
                    await RefreshAllViewsAsync(stoppingToken);
                }

                await Task.Delay(_checkInterval, stoppingToken);
            }

            _logger.LogInformation("MisRefreshJob stopping.");
        }

        private async Task RefreshAllViewsAsync(CancellationToken ct)
        {
            using (LogContext.PushProperty("Job", "MisRefreshJob"))
            {
                _logger.LogInformation("Starting nightly MIS materalized view refreshes.");
                using var scope = _serviceProvider.CreateScope();
                var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                var connectionString = config.GetConnectionString("AnalyticsDb") ?? config.GetConnectionString("UserDb");

                if (string.IsNullOrEmpty(connectionString))
                {
                    _logger.LogError("Unable to resolve AnalyticsDb connection string. MIS views will not be refreshed.");
                    return;
                }

                await using var conn = new NpgsqlConnection(connectionString);
                try
                {
                    await conn.OpenAsync(ct);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to connect to database for MIS refreshes.");
                    return;
                }

                foreach (var viewName in ViewsToRefresh)
                {
                    if (ct.IsCancellationRequested) return;

                    try
                    {
                        var stopwatch = System.Diagnostics.Stopwatch.StartNew();
                        await using var cmd = conn.CreateCommand();
                        cmd.CommandText = $"REFRESH MATERIALIZED VIEW CONCURRENTLY {viewName};";
                        await cmd.ExecuteNonQueryAsync(ct);
                        stopwatch.Stop();
                        _logger.LogInformation("Refreshed {ViewName} concurrently in {ElapsedMilliseconds}ms.", viewName, stopwatch.ElapsedMilliseconds);
                    }
                    catch (Exception ex)
                    {
                        // Failure isolation: 1 failing view does not block others.
                        _logger.LogError(ex, "Failed to refresh materialized view {ViewName}. Continuing with remaining.", viewName);
                    }
                }
                _logger.LogInformation("Completed nightly MIS materalized view refreshes.");
            }
        }
    }
}
