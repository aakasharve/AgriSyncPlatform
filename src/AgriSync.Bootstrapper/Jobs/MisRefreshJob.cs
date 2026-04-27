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
            // Phase 4 — Tier 0/1 core views (order matters: wvfd before engagement_tier)
            "mis.wvfd_weekly",
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
            "mis.gemini_cost_per_farm",
            // Phase 7 — Behavioral analytics
            "mis.feature_retention_lift",
            "mis.new_farm_day_snapshot",
            "mis.silent_churn_watchlist",  // Phase 7 version replaces Phase 4
            "mis.zero_engagement_farms",
            "mis.activity_heatmap",
            "mis.cohort_quality_score",
            // Ops Phase 2 — engineering health views
            "mis.api_health_24h",
            "mis.farmer_suffering_watchlist",
            "mis.voice_pipeline_health",
            "mis.alert_r9_api_error_spike",
            "mis.alert_r10_voice_degraded",
            // Phase 7 — Red-flag detectors
            "mis.alert_r1_smooth_decay",
            "mis.alert_r2_wau_vs_wvfd",
            "mis.alert_r3_rubber_stamp",
            "mis.alert_r4_voice_decay",
            "mis.schedule_compliance_weekly",   // must refresh before R5 (R5 depends on it)
            "mis.alert_r5_compliance_plateau",
            "mis.alert_r6_flash_churn",
            "mis.alert_r7_correction_rising",
            "mis.alert_r8_referral_quality",
            // W0-A — Admin resolver observability
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
