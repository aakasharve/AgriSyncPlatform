using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using Serilog.Context;

namespace AgriSync.Bootstrapper.Jobs
{
    /// <summary>
    /// Keeps the monthly range partitions of <c>analytics.events</c> provisioned
    /// a fixed horizon ahead.
    ///
    /// <para>
    /// WHY THIS EXISTS: the initial migration created only the current + next
    /// month's partition and deferred ongoing provisioning to "a separate hosted
    /// job" that was never built. Without it, on the first day past the last
    /// pre-created partition EVERY analytics insert raises SQLSTATE 23514, and
    /// <see cref="AnalyticsWriter"/> swallows that error by design — so analytics
    /// silently and totally stops with no alarm. This job is that missing
    /// provisioner AND the alarm: a failure to ensure the current/next partition
    /// is logged at Error level (the signal the swallow removed), without
    /// crashing unrelated traffic.
    /// </para>
    ///
    /// Mirrors <see cref="MisRefreshJob"/>: a <see cref="BackgroundService"/> that
    /// resolves the analytics connection string from configuration and runs
    /// idempotent DDL via Npgsql. <c>CREATE TABLE IF NOT EXISTS ... PARTITION OF</c>
    /// is safe to re-run, so it can never collide with migration-created partitions.
    /// </summary>
    public sealed class PartitionMaintenanceJob : BackgroundService
    {
        /// <summary>
        /// Months beyond the current month to keep provisioned. 3 gives a wide
        /// safety cushion: even if the job is down for weeks, partitions exist
        /// well ahead of "now".
        /// </summary>
        private const int MonthsAhead = 3;

        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<PartitionMaintenanceJob> _logger;
        private readonly TimeSpan _checkInterval = TimeSpan.FromHours(12);

        // Short backoff used when the current/next partition could not be ensured
        // (connection blip / DDL failure) — retry soon instead of leaving analytics
        // silently broken for the full _checkInterval.
        private readonly TimeSpan _retryInterval = TimeSpan.FromMinutes(5);

        public PartitionMaintenanceJob(IServiceProvider serviceProvider, ILogger<PartitionMaintenanceJob> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "PartitionMaintenanceJob starting; ensuring analytics.events partitions {MonthsAhead} months ahead.",
                MonthsAhead);

            // Ensure immediately on startup, then on a slow cadence. A missing
            // current/next partition is a silent total-analytics-loss, so we do
            // not wait for the first interval to elapse.
            while (!stoppingToken.IsCancellationRequested)
            {
                var criticalOk = await EnsurePartitionsAsync(stoppingToken);

                // On a critical failure (current/next partition not ensured), retry on
                // the short backoff rather than waiting the full cadence — otherwise
                // analytics inserts stay silently dropped until the next 12h cycle.
                var delay = criticalOk ? _checkInterval : _retryInterval;
                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }

            _logger.LogInformation("PartitionMaintenanceJob stopping.");
        }

        private async Task<bool> EnsurePartitionsAsync(CancellationToken ct)
        {
            using (LogContext.PushProperty("Job", "PartitionMaintenanceJob"))
            {
                using var scope = _serviceProvider.CreateScope();
                var config = scope.ServiceProvider.GetRequiredService<IConfiguration>();
                var connectionString = config.GetConnectionString("AnalyticsDb")
                    ?? config.GetConnectionString("UserDb");

                if (string.IsNullOrEmpty(connectionString))
                {
                    _logger.LogError(
                        "PartitionMaintenanceJob could not resolve an analytics connection string; "
                        + "analytics.events partitions cannot be ensured and inserts may be silently dropped.");
                    return false;
                }

                await using var conn = new NpgsqlConnection(connectionString);
                try
                {
                    await conn.OpenAsync(ct);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    _logger.LogError(
                        ex,
                        "PartitionMaintenanceJob could not connect to the analytics database; "
                        + "partitions may be missing and analytics inserts silently dropped.");
                    return false;
                }

                var anchor = DateOnly.FromDateTime(DateTime.UtcNow);
                var specs = AnalyticsPartitionPlan.ForHorizon(anchor, MonthsAhead);
                var ensured = 0;
                var criticalOk = true;

                for (var i = 0; i < specs.Count; i++)
                {
                    if (ct.IsCancellationRequested)
                    {
                        return criticalOk;
                    }

                    var spec = specs[i];
                    // The current month (i == 0) and next month (i == 1) are the
                    // windows live inserts land in RIGHT NOW. Failing to ensure
                    // those is the alarm-worthy case.
                    var isCritical = i <= 1;

                    try
                    {
                        await using var cmd = conn.CreateCommand();
                        cmd.CommandText =
                            $"CREATE TABLE IF NOT EXISTS {spec.QualifiedName} "
                            + "PARTITION OF analytics.events "
                            + $"FOR VALUES FROM ('{spec.FromInclusive:yyyy-MM-dd}') TO ('{spec.ToExclusive:yyyy-MM-dd}');";
                        await cmd.ExecuteNonQueryAsync(ct);
                        ensured++;
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        if (isCritical)
                        {
                            criticalOk = false;
                            _logger.LogError(
                                ex,
                                "CRITICAL: failed to ensure analytics partition {Partition} for [{From:yyyy-MM-dd}..{To:yyyy-MM-dd}); "
                                + "analytics inserts in this window will be SILENTLY DROPPED until it exists.",
                                spec.QualifiedName, spec.FromInclusive, spec.ToExclusive);
                        }
                        else
                        {
                            _logger.LogWarning(
                                ex,
                                "Failed to ensure future analytics partition {Partition}; will retry next cycle.",
                                spec.QualifiedName);
                        }
                    }
                }

                _logger.LogInformation(
                    "PartitionMaintenanceJob ensured {Ensured}/{Total} analytics.events partitions through {MonthsAhead} months ahead.",
                    ensured, specs.Count, MonthsAhead);

                return criticalOk;
            }
        }
    }
}
