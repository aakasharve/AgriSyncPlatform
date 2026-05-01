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

        // T-IGH-03-ANALYTICS-MIGRATION-REWRITE (Sub-plan 03 Task 9):
        // List trimmed 2026-05-01 to match the matview set rebuilt by
        // 20260502000000_AnalyticsRewrite (production-read surface only).
        // 22 unqueried/broken matviews from Phase4/Phase7/PhaseOps were
        // dropped from the rewrite and removed here so the nightly
        // refresh stops logging "relation does not exist" for them.
        // Reintroduction of the dropped matviews is tracked under
        // T-IGH-03-MIS-MATVIEW-REDESIGN — that work needs a proper
        // subscription→farm cross-aggregate model first.
        private static readonly string[] ViewsToRefresh = new[]
        {
            // ShramSafal verification + log signals
            "mis.wvfd_weekly",
            "mis.log_verify_lag",
            "mis.correction_rate",
            // Analytics-events behavioural signals
            "mis.voice_log_share",
            "mis.schedule_compliance_weekly",
            "mis.schedule_unscheduled_ratio",
            "mis.gemini_cost_per_farm",
            // Ops health
            "mis.farmer_suffering_watchlist",
            "mis.alert_r9_api_error_spike",
            "mis.alert_r10_voice_degraded",
            // W0-A — Admin resolver observability (separate migration,
            // not in the AnalyticsRewrite scope; refreshes here).
            "mis.admin_scope_health",
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
