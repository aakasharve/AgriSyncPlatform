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
        //
        // T-IGH-03-MIS-MATVIEW-REDESIGN Bucket 1 (2026-05-01, ADR-0004 α):
        // Restored mis.subscription_farms (denormalised cross-aggregate
        // projection) plus its two consumers — mis.silent_churn_watchlist
        // and mis.zero_engagement_farms. Refresh ORDER MATTERS: the
        // projection must refresh BEFORE its consumers so they see the
        // current Subscription→Farm link snapshot.
        //
        // T-IGH-03-MIS-MATVIEW-REDESIGN Buckets 2/3/4 (2026-05-03):
        // 13 matviews restored by 20260502020000_RestoreBuckets234Matviews
        // — only matviews with a documented in-tree consumer
        // (AlertDispatcherJob for R1-R8, build/metabase/dashboards/founder.json
        // for engagement_tier / activation_funnel / d30_retention_paying /
        // schedule_migration_rate / api_health_24h). Refresh order: bases
        // first, dependents next (R2 reads mis.wvfd_weekly; R5 reads
        // mis.schedule_compliance_weekly; engagement_tier reads
        // mis.wvfd_weekly).
        //
        // 7 matviews stay deferred (NO-CONSUMER set per the 2026-05-03
        // investigation): schedule_adoption_rate, schedule_abandonment_rate,
        // feature_retention_lift, new_farm_day_snapshot, activity_heatmap,
        // cohort_quality_score, voice_pipeline_health.
        private static readonly string[] ViewsToRefresh = new[]
        {
            // ShramSafal verification + log signals (production-read base)
            "mis.wvfd_weekly",
            "mis.log_verify_lag",
            "mis.correction_rate",
            // Analytics-events behavioural signals (production-read base)
            "mis.voice_log_share",
            "mis.schedule_compliance_weekly",
            "mis.schedule_unscheduled_ratio",
            "mis.gemini_cost_per_farm",
            // Ops health (production-read base)
            "mis.farmer_suffering_watchlist",
            "mis.alert_r9_api_error_spike",
            "mis.alert_r10_voice_degraded",
            // W0-A — Admin resolver observability (separate migration,
            // not in the AnalyticsRewrite scope; refreshes here).
            "mis.admin_scope_health",
            // Bucket 1 — Subscription-aware churn-watch dashboards.
            // ORDER: projection first, consumers second.
            "mis.subscription_farms",
            "mis.silent_churn_watchlist",
            "mis.zero_engagement_farms",
            // Bucket 2 (Metabase founder dashboard cards 3/8/9/10).
            // engagement_tier depends on wvfd_weekly — listed AFTER it.
            "mis.engagement_tier",
            "mis.activation_funnel",
            "mis.d30_retention_paying",
            "mis.schedule_migration_rate",
            // Bucket 4 (Metabase founder dashboard card 13).
            "mis.api_health_24h",
            // Bucket 3 — R1..R8 detectors (AlertDispatcherJob).
            // R2 reads wvfd_weekly; R5 reads schedule_compliance_weekly —
            // both bases are listed above so they refresh first.
            "mis.alert_r1_smooth_decay",
            "mis.alert_r2_wau_vs_wvfd",
            "mis.alert_r3_rubber_stamp",
            "mis.alert_r4_voice_decay",
            "mis.alert_r5_compliance_plateau",
            "mis.alert_r6_flash_churn",
            "mis.alert_r7_correction_rising",
            "mis.alert_r8_referral_quality",
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
