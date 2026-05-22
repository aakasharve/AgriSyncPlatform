using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Tasks 3.1 + 3.2 —
/// implementation of <see cref="IAdminAiObservabilityRepository"/>.
/// Reads the two Phase 3 Slice E views via raw SQL through the
/// regular <see cref="ShramSafalDbContext"/> connection.
///
/// <para>
/// <b>Graceful degradation.</b> The views are added in the same
/// migration envelope as this repository; until the migration is
/// applied (the envelope explicitly defers <c>dotnet ef database
/// update</c> per supervisor review), querying them throws. The
/// per-method try/catch swallows the missing-view error and
/// returns an empty list — the admin panel renders a "no data
/// yet" empty state rather than a 500. Once the migration ships,
/// the catch is dormant.
/// </para>
/// </summary>
internal sealed class AdminAiObservabilityRepository(ShramSafalDbContext db)
    : IAdminAiObservabilityRepository
{
    public async Task<IReadOnlyList<AiProviderHealth24hDto>> GetProviderHealth24hAsync(
        CancellationToken ct = default)
    {
        var conn = db.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct).ConfigureAwait(false);

        var results = new List<AiProviderHealth24hDto>();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    provider,
                    operation,
                    attempts,
                    successes,
                    failures,
                    success_rate_pct,
                    p50_latency_ms,
                    p95_latency_ms,
                    window_end_utc,
                    window_start_utc
                FROM ssf.v_ai_provider_health_24h
                ORDER BY provider, operation
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
            {
                results.Add(new AiProviderHealth24hDto(
                    Provider: r.GetString(0),
                    Operation: r.GetString(1),
                    Attempts: r.GetInt32(2),
                    Successes: r.GetInt32(3),
                    Failures: r.GetInt32(4),
                    SuccessRatePct: r.GetDecimal(5),
                    P50LatencyMs: r.IsDBNull(6) ? null : r.GetInt32(6),
                    P95LatencyMs: r.IsDBNull(7) ? null : r.GetInt32(7),
                    WindowEndUtc: r.IsDBNull(8) ? null : r.GetDateTime(8),
                    WindowStartUtc: r.IsDBNull(9) ? null : r.GetDateTime(9)));
            }
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "42P01")
        {
            // 42P01 = "undefined_table" → the view migration has not been
            // applied yet (intended in test contexts that skip the latest
            // chain, and during the brief window before
            // 20260522190000_AddAiProviderHealth24hView ships). Return an
            // empty list so the admin panel surfaces "no data yet" rather
            // than a 500.
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync().ConfigureAwait(false);
        }

        return results;
    }

    public async Task<IReadOnlyList<AiSpendMonthlyDto>> GetSpendMonthlyAsync(
        CancellationToken ct = default)
    {
        var conn = db.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct).ConfigureAwait(false);

        var results = new List<AiSpendMonthlyDto>();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    tenant_id,
                    provider,
                    operation,
                    month_utc,
                    total_inr,
                    days_with_spend,
                    first_day,
                    last_day,
                    last_updated_utc
                FROM ssf.v_ai_spend_monthly
                ORDER BY month_utc DESC, tenant_id, provider, operation
                """;
            await using var r = await cmd.ExecuteReaderAsync(ct).ConfigureAwait(false);
            while (await r.ReadAsync(ct).ConfigureAwait(false))
            {
                results.Add(new AiSpendMonthlyDto(
                    TenantId: r.GetGuid(0),
                    Provider: r.GetString(1),
                    Operation: r.GetString(2),
                    MonthUtc: DateOnly.FromDateTime(r.GetDateTime(3)),
                    TotalInr: r.GetDecimal(4),
                    DaysWithSpend: r.GetInt32(5),
                    FirstDay: DateOnly.FromDateTime(r.GetDateTime(6)),
                    LastDay: DateOnly.FromDateTime(r.GetDateTime(7)),
                    LastUpdatedUtc: r.GetDateTime(8)));
            }
        }
        catch (Npgsql.PostgresException ex) when (ex.SqlState == "42P01")
        {
            // Same graceful-degradation guard as GetProviderHealth24hAsync.
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync().ConfigureAwait(false);
        }

        return results;
    }

    public async Task<IReadOnlyDictionary<Guid, decimal?>> GetMonthlyBudgetByTenantAsync(
        CancellationToken ct = default)
    {
        // ai_provider_configs today is a global table (one row per
        // operation lane). The "per-tenant" map is sourced from the
        // distinct tenant_ids observed in the spend-daily table — the
        // monthly_budget_inr column itself is on the global config
        // row. When the configs table ships per-tenant rows in a
        // future iteration, this query upgrades without changing the
        // port contract.
        var globalBudget = await db.AiProviderConfigs
            .AsNoTracking()
            .Select(c => c.MonthlyBudgetInr)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        var tenantIds = await db.AiProviderSpendDaily
            .AsNoTracking()
            .Select(s => s.TenantId)
            .Distinct()
            .ToListAsync(ct)
            .ConfigureAwait(false);

        var dict = new Dictionary<Guid, decimal?>(tenantIds.Count);
        foreach (var tid in tenantIds)
        {
            dict[tid] = globalBudget;
        }
        return dict;
    }
}
