using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Npgsql;
using System.Text;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// Phase 7 — Alert Dispatcher. Runs daily at 09:00 IST (03:30 UTC).
/// Scans each mis.alert_r* view for breached = true, then sends an
/// email to the founder. Idempotent: same breach is not re-alerted
/// within 7 days (tracked in mis.alert_dispatch_log in-memory per
/// process lifetime — restart resets the guard, which is acceptable
/// for a low-frequency background job at current scale).
///
/// Upgrade path: swap _emailService.SendAsync for a real SMTP client.
/// For Slack, add an ISlackAlerter port and implement via webhook.
/// </summary>
public sealed class AlertDispatcherJob : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<AlertDispatcherJob> _logger;
    private readonly IConfiguration _config;

    // In-memory dedup: detector → last alert date. Resets on restart.
    private readonly Dictionary<string, DateTime> _lastAlerted = new();
    private readonly TimeSpan _dedupeWindow = TimeSpan.FromDays(7);
    private readonly TimeSpan _checkInterval = TimeSpan.FromHours(1);
    private DateTime _lastRunDate = DateTime.MinValue;

    private static readonly string[] AlertViews =
    [
        "mis.alert_r9_api_error_spike",
        "mis.alert_r10_voice_degraded",
        "mis.alert_r1_smooth_decay",
        "mis.alert_r2_wau_vs_wvfd",
        "mis.alert_r3_rubber_stamp",
        "mis.alert_r4_voice_decay",
        "mis.alert_r5_compliance_plateau",
        "mis.alert_r6_flash_churn",
        "mis.alert_r7_correction_rising",
        "mis.alert_r8_referral_quality",
    ];

    public AlertDispatcherJob(
        IServiceProvider services,
        ILogger<AlertDispatcherJob> logger,
        IConfiguration config)
    {
        _services = services;
        _logger = logger;
        _config = config;
    }

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        _logger.LogInformation("AlertDispatcherJob started.");

        while (!ct.IsCancellationRequested)
        {
            var now = DateTime.UtcNow;

            // Run once per day at 03:30 UTC (= 09:00 IST)
            if (now.Hour == 3 && now.Minute >= 30 && _lastRunDate.Date < now.Date)
            {
                _lastRunDate = now.Date;
                await DispatchAlertsAsync(ct);
            }

            await Task.Delay(_checkInterval, ct);
        }
    }

    private async Task DispatchAlertsAsync(CancellationToken ct)
    {
        var connStr = _config.GetConnectionString("AnalyticsDb")
                   ?? _config.GetConnectionString("UserDb");
        if (string.IsNullOrWhiteSpace(connStr))
        {
            _logger.LogError("AlertDispatcherJob: no AnalyticsDb connection string.");
            return;
        }

        var breaches = new List<(string detector, string description)>();

        await using var conn = new NpgsqlConnection(connStr);
        try { await conn.OpenAsync(ct); }
        catch (Exception ex)
        {
            _logger.LogError(ex, "AlertDispatcherJob: DB connection failed.");
            return;
        }

        foreach (var view in AlertViews)
        {
            if (ct.IsCancellationRequested) return;
            try
            {
                await using var cmd = conn.CreateCommand();
                cmd.CommandText = $"SELECT detector, description FROM {view} WHERE breached = true LIMIT 1";
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                if (await reader.ReadAsync(ct))
                {
                    var detector = reader.GetString(0);
                    var description = reader.GetString(1);

                    // Dedupe: skip if alerted within 7 days
                    if (_lastAlerted.TryGetValue(detector, out var lastAlert) &&
                        (DateTime.UtcNow - lastAlert) < _dedupeWindow)
                    {
                        _logger.LogDebug("Alert {Detector} skipped — still in dedupe window.", detector);
                        continue;
                    }

                    breaches.Add((detector, description));
                    _lastAlerted[detector] = DateTime.UtcNow;
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "AlertDispatcherJob: failed to query {View}.", view);
            }
        }

        if (breaches.Count == 0)
        {
            _logger.LogInformation("AlertDispatcherJob: no breaches today.");
            return;
        }

        await SendFounderAlertAsync(breaches, ct);
    }

    private async Task SendFounderAlertAsync(
        List<(string detector, string description)> breaches,
        CancellationToken ct)
    {
        var founderEmail = _config["Alerts:FounderEmail"]
                        ?? _config["Alerts:Email"]
                        ?? "founder@agrisync.app";

        var sb = new StringBuilder();
        sb.AppendLine($"AgriSync MIS — Anti-PMF Alerts ({DateTime.UtcNow:yyyy-MM-dd})");
        sb.AppendLine($"{breaches.Count} breach(es) detected:\n");
        foreach (var (detector, description) in breaches)
        {
            sb.AppendLine($"  [{detector}]");
            sb.AppendLine($"  {description}");
            sb.AppendLine();
        }
        sb.AppendLine("Open Metabase: http://localhost:3001");

        _logger.LogWarning(
            "AlertDispatcherJob: {BreachCount} breach(es) detected. Would email {FounderEmail}.\n{Body}",
            breaches.Count, founderEmail, sb.ToString());

        // TODO Phase 7 upgrade: wire SMTP/SendGrid here.
        // For now we log at Warning level — Serilog sinks can forward to email/Slack.
        await Task.CompletedTask;
    }
}
