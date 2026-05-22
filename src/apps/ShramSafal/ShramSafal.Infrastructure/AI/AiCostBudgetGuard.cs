using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Domain.AI;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.7 (Safeguard S9) —
/// cost budget guardrail background worker.
///
/// <para>
/// <b>What it does.</b> On every tick:
/// <list type="number">
///   <item>Reads the latest <see cref="AiProviderConfig"/> to discover
///   the active monthly budget. NULL budget → no-op tick (worker is
///   "enabled" but unconstrained).</item>
///   <item>Aggregates each completed <see cref="AiJobAttempt"/> for the
///   current UTC day into a single
///   <c>ssf.ai_provider_spend_daily</c> row per
///   (tenant_id, provider, operation, day_utc). Idempotent: re-running
///   the aggregator over the same day rewrites the rollup with the
///   recomputed sum.</item>
///   <item>Sums the rollup's month-to-date total. Compares against the
///   budget. Emits a Warning at 80% and a Critical at 100%. Founder
///   decides whether to flip <see cref="AiProviderConfig.IsAiProcessingDisabled"/>
///   via the admin surface — auto-flip is INTENTIONALLY DEFERRED.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Efficiency.</b> The aggregator query is bounded to the current
/// UTC day's <see cref="AiJobAttempt"/> rows
/// (<c>WHERE attempted_at_utc &gt;= day_start AND &lt; day_end</c>). The
/// month-to-date probe reads from the rollup table only, which is
/// indexed on <c>(tenant_id, day_utc)</c> per
/// <see cref="Persistence.Configurations.AiProviderSpendDailyConfiguration"/>.
/// The cost of one tick is therefore O(today's attempts) for the
/// aggregation + O(days_in_current_month) for the probe — never
/// O(all attempts).
/// </para>
///
/// <para>
/// <b>Disabled by default.</b> See <see cref="AiCostBudgetOptions.Enabled"/> —
/// production opts in via env var after Phase 2 ships. The hosted
/// service still spawns but <see cref="ExecuteAsync"/> exits
/// immediately when the flag is off.
/// </para>
/// </summary>
internal sealed class AiCostBudgetGuard(
    IServiceScopeFactory scopeFactory,
    IOptions<AiCostBudgetOptions> options,
    ILogger<AiCostBudgetGuard> logger,
    TimeProvider? timeProvider = null) : BackgroundService
{
    private readonly AiCostBudgetOptions _options = options.Value;
    private readonly TimeProvider _timeProvider = timeProvider ?? TimeProvider.System;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            logger.LogInformation(
                "AiCostBudgetGuard disabled by configuration (Ai:CostBudgetGuard:Enabled = false). Exiting.");
            return;
        }

        var tickInterval = TimeSpan.FromMinutes(Math.Max(1, _options.TickIntervalMinutes));
        logger.LogInformation(
            "AiCostBudgetGuard started. TickIntervalMinutes={Interval} Warn80Pct=true Crit100Pct=true.",
            tickInterval.TotalMinutes);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(tickInterval, _timeProvider, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            try
            {
                await RunTickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                logger.LogWarning(
                    ex,
                    "AiCostBudgetGuard tick failed. Continuing.");
            }
        }

        logger.LogInformation("AiCostBudgetGuard stopped.");
    }

    /// <summary>
    /// One full tick of the guardrail. <c>internal</c> so the test can
    /// drive the worker synchronously without spinning up the hosted
    /// service.
    /// </summary>
    internal async Task RunTickAsync(CancellationToken ct)
    {
        await using var scope = scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var nowUtc = _timeProvider.GetUtcNow().UtcDateTime;
        var today = DateOnly.FromDateTime(nowUtc);
        var monthStart = new DateOnly(today.Year, today.Month, 1);

        var config = await db.AiProviderConfigs
            .OrderByDescending(x => x.ModifiedAtUtc)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        // No config yet (cold start) or no budget set → nothing to guard.
        // The aggregator still runs so the rollup table stays populated
        // for when a budget is set — surfaces month-to-date spend on the
        // admin dashboard regardless of whether a budget is in force.
        await UpsertTodayRollupAsync(db, today, nowUtc, ct).ConfigureAwait(false);

        if (config?.MonthlyBudgetInr is null)
        {
            return;
        }

        var budgetInr = config.MonthlyBudgetInr.Value;
        if (budgetInr <= 0m)
        {
            // Budget of 0 INR is a kill-switch semantic — any spend
            // crosses 100%. Emit critical immediately.
            logger.LogCritical(
                "[ai-cost-budget] budget set to {BudgetInr} INR — every AI call breaches the cap. Founder runbook action required.",
                budgetInr);
            return;
        }

        var monthEnd = monthStart.AddMonths(1);
        var monthToDateInr = await db.AiProviderSpendDaily
            .Where(x => x.DayUtc >= monthStart && x.DayUtc < monthEnd)
            .SumAsync(x => (decimal?)x.TotalInr, ct)
            .ConfigureAwait(false) ?? 0m;

        var spentRatio = monthToDateInr / budgetInr;
        var spentPct = (double)spentRatio * 100d;

        if (monthToDateInr >= budgetInr)
        {
            logger.LogCritical(
                "[ai-cost-budget] month-to-date spend {SpentInr:F2} INR has reached 100% of monthly budget {BudgetInr:F2} INR ({SpentPct:F2}%). Founder runbook action required — auto-flip is deferred.",
                monthToDateInr,
                budgetInr,
                spentPct);
        }
        else if (monthToDateInr >= 0.80m * budgetInr)
        {
            logger.LogWarning(
                "[ai-cost-budget] month-to-date spend {SpentInr:F2} INR has reached 80% of monthly budget {BudgetInr:F2} INR ({SpentPct:F2}%). Founder action recommended.",
                monthToDateInr,
                budgetInr,
                spentPct);
        }
        else
        {
            logger.LogInformation(
                "[ai-cost-budget] month-to-date spend {SpentInr:F2} INR ({SpentPct:F2}%) within monthly budget {BudgetInr:F2} INR.",
                monthToDateInr,
                spentPct,
                budgetInr);
        }
    }

    /// <summary>
    /// Recomputes the per-(tenant × provider × operation) rollup row
    /// for <paramref name="day"/> from <c>ai_job_attempts</c>. Idempotent
    /// — re-running over the same day rewrites the row with the
    /// recomputed sum.
    /// </summary>
    private static async Task UpsertTodayRollupAsync(
        ShramSafalDbContext db,
        DateOnly day,
        DateTime nowUtc,
        CancellationToken ct)
    {
        var dayStart = day.ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);
        var dayEnd = day.AddDays(1).ToDateTime(TimeOnly.MinValue, DateTimeKind.Utc);

        // Aggregate today's attempts into (tenant × provider × operation)
        // buckets. We join AiJobAttempt → AiJob to recover the tenant
        // (= AiJob.FarmId) + operation columns since AiJobAttempt itself
        // doesn't carry them.
        var rollups = await (
                from att in db.AiJobAttempts
                join job in db.AiJobs on att.AiJobId equals job.Id
                where att.AttemptedAtUtc >= dayStart
                      && att.AttemptedAtUtc < dayEnd
                      && att.EstimatedCostUnits != null
                group new { att.EstimatedCostUnits, job.FarmId, att.Provider, job.OperationType }
                    by new { job.FarmId, att.Provider, job.OperationType }
                into g
                select new
                {
                    TenantId = g.Key.FarmId,
                    Provider = g.Key.Provider,
                    Operation = g.Key.OperationType,
                    TotalInr = g.Sum(x => x.EstimatedCostUnits ?? 0m)
                })
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // Apply each rollup. Upsert pattern: if a row already exists for
        // the (tenant, provider, operation, day_utc) tuple, overwrite
        // the total; otherwise insert a fresh row.
        foreach (var roll in rollups)
        {
            var existing = await db.AiProviderSpendDaily
                .FirstOrDefaultAsync(
                    x => x.TenantId == roll.TenantId
                         && x.Provider == roll.Provider
                         && x.Operation == roll.Operation
                         && x.DayUtc == day,
                    ct)
                .ConfigureAwait(false);

            if (existing is null)
            {
                var fresh = AiProviderSpendDaily.Create(
                    id: Guid.NewGuid(),
                    tenantId: roll.TenantId,
                    provider: roll.Provider,
                    operation: roll.Operation,
                    dayUtc: day,
                    totalInr: roll.TotalInr,
                    nowUtc: nowUtc);
                await db.AiProviderSpendDaily.AddAsync(fresh, ct).ConfigureAwait(false);
            }
            else
            {
                existing.SetTotal(roll.TotalInr, nowUtc);
            }
        }

        if (rollups.Count > 0)
        {
            await db.SaveChangesAsync(ct).ConfigureAwait(false);
        }
    }
}

/// <summary>
/// Options for <see cref="AiCostBudgetGuard"/>. Bound from the
/// <c>Ai:CostBudgetGuard</c> appsettings section.
/// </summary>
public sealed class AiCostBudgetOptions
{
    public const string SectionName = "Ai:CostBudgetGuard";

    /// <summary>
    /// Master kill-switch. Default <c>false</c> so the worker no-ops
    /// in every environment that does not explicitly opt in. Founder
    /// enables via <c>Ai__CostBudgetGuard__Enabled=true</c> after
    /// Phase 2 ships and the rollup table has had time to populate.
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// Tick cadence in minutes. Default <c>60</c>. Clamped to a minimum
    /// of 1 minute at runtime.
    /// </summary>
    public int TickIntervalMinutes { get; set; } = 60;
}
