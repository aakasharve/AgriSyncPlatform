using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Organizations;
using System.Data.Common;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Mode A drilldown reader. Returns the per-farmer DWC v2 health
/// payload assembled from six matview / event-table reads, scope-checked
/// against <c>mis.effective_org_farm_scope</c> per CEI W0.
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.5 Step 1. Same shape as
/// <see cref="AdminMisRepository"/> /
/// <see cref="AdminOpsRepository"/>: read-only against
/// <see cref="AnalyticsDbContext"/>, raw SQL via
/// <c>ExecuteReaderAsync</c>, graceful empty-row fallbacks per try
/// block (so a missing matview returns zero-counts rather than throwing).
/// </para>
/// <para>
/// <b>Scope check.</b> Platform admins
/// (<see cref="AdminScope.IsPlatformAdmin"/>) bypass the JOIN; every
/// non-Platform caller's first read is a presence check against
/// <c>mis.effective_org_farm_scope WHERE org_id = @org AND farm_id =
/// @farm</c>. A miss returns <c>null</c> immediately so the handler
/// emits <c>NotFound</c> without leaking any farm data.
/// </para>
/// <para>
/// <b>ssf.farms PK.</b> The schema's primary key is the quoted
/// <c>"Id"</c> column (per
/// <c>20260222080909_AddAuditEvents.cs</c>). All joins here use
/// <c>f."Id"</c> rather than the legacy <c>f.farm_id</c> shape that
/// <see cref="AdminMisRepository"/> uses (which gracefully returns
/// empty because the column doesn't exist). Same identifier-quoting
/// discipline as the <c>20260505000000_DwcV2Matviews</c> migration.
/// </para>
/// </remarks>
public sealed class AdminFarmerHealthRepository(AnalyticsDbContext analyticsContext) : IAdminFarmerHealthRepository
{
    public async Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        try
        {
            // 1. Scope check — Platform admins bypass; everyone else must
            // have an effective_org_farm_scope row for (orgId, farmId).
            if (!scope.IsPlatformAdmin && !await IsFarmInScopeAsync(conn, scope.OrganizationId, farmId, ct))
                return null;

            // 2. Farm presence + identity (farmer name + phone via owner
            // membership). Returns null if the farm doesn't exist at all.
            var identity = await GetFarmIdentityAsync(conn, farmId, ct);
            if (identity is null) return null;

            // 3. Score row (current ISO week from mis.dwc_score_per_farm_week).
            var score = await GetScoreAsync(conn, farmId, ct);

            // 4. 14-day timeline from analytics.events.
            var timeline = await GetTimelineAsync(conn, farmId, ct);

            // 5. Verifications (counts, last 14 days).
            var verifications = await GetVerificationCountsAsync(conn, farmId, ct);

            // 6. WTL v0 worker summary — top 5 by assignment_count.
            var workers = await GetTopWorkersAsync(conn, farmId, limit: 5, ct);

            // 7. Sync state + AI health — gated by ops:read claim. The
            // claim model in the codebase today uses CanRead(ModuleKey.OpsErrors)
            // for sync errors and CanRead(ModuleKey.OpsVoice) for AI health
            // (mirrors AdminEndpoints.cs gating pattern). Non-ops callers
            // get null sub-blocks so the redactor doesn't leak ops data.
            var syncState = scope.CanRead(ModuleKey.OpsErrors)
                ? await GetSyncStateAsync(conn, farmId, ct)
                : null;
            var aiHealth = scope.CanRead(ModuleKey.OpsVoice)
                ? await GetAiHealthAsync(conn, farmId, ct)
                : null;

            return new FarmerHealthDto(
                FarmId: farmId,
                FarmerName: identity.FarmerName,
                Phone: identity.Phone,
                Score: score,
                Timeline: timeline,
                SyncState: syncState,
                AiHealth: aiHealth,
                Verifications: verifications,
                WorkerSummary: workers);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private static async Task<bool> IsFarmInScopeAsync(
        DbConnection conn, Guid orgId, Guid farmId, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT 1 FROM mis.effective_org_farm_scope
                WHERE org_id = @org AND farm_id = @farm
                LIMIT 1
                """;
            AddParam(cmd, "@org", orgId);
            AddParam(cmd, "@farm", farmId);
            var raw = await cmd.ExecuteScalarAsync(ct);
            return raw is not null;
        }
        catch { return false; }
    }

    private sealed record FarmIdentity(string FarmerName, string Phone);

    private static async Task<FarmIdentity?> GetFarmIdentityAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            // ssf.farms PK is "Id" (quoted) per 20260222080909_AddAuditEvents.
            // The owner membership join may be missing for newly-seeded
            // farms — the LEFT JOIN keeps the row alive with empty phone.
            cmd.CommandText = """
                SELECT
                    f.name,
                    COALESCE(u.display_name, f.name) AS farmer_name,
                    COALESCE(u.phone, '—')           AS phone
                FROM ssf.farms f
                LEFT JOIN ssf.farm_memberships fm
                    ON fm.farm_id = f."Id" AND fm.role = 'owner' AND fm.is_revoked = FALSE
                LEFT JOIN public.users u ON u."Id" = fm.user_id
                WHERE f."Id" = @farm
                LIMIT 1
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return null;
            return new FarmIdentity(
                FarmerName: r.IsDBNull(1) ? r.GetString(0) : r.GetString(1),
                Phone: r.IsDBNull(2) ? "—" : r.GetString(2));
        }
        catch
        {
            // Schema may not yet have the join columns in legacy environments.
            // Return a placeholder identity so the rest of the payload still
            // assembles.
            return new FarmIdentity(FarmerName: "—", Phone: "—");
        }
    }

    private static async Task<FarmerHealthScoreBreakdownDto> GetScoreAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    week_start, score, COALESCE(flag, 'insufficient_data'),
                    COALESCE(bucket, 'intervention'),
                    pillar_trigger_fit, pillar_action_simplicity,
                    pillar_proof, pillar_reward,
                    pillar_investment, pillar_repeat
                FROM mis.dwc_score_per_farm_week
                WHERE farm_id = @farm
                ORDER BY week_start DESC
                LIMIT 1
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                return new FarmerHealthScoreBreakdownDto(
                    Total: r.GetInt32(1),
                    Bucket: r.GetString(3),
                    Flag: r.GetString(2),
                    Pillars: new FarmerHealthPillarsDto(
                        TriggerFit:       r.IsDBNull(4) ? 0m : r.GetDecimal(4),
                        ActionSimplicity: r.IsDBNull(5) ? 0m : r.GetDecimal(5),
                        Proof:            r.IsDBNull(6) ? 0m : r.GetDecimal(6),
                        Reward:           r.IsDBNull(7) ? 0m : r.GetDecimal(7),
                        Investment:       r.IsDBNull(8) ? 0m : r.GetDecimal(8),
                        Repeat:           r.IsDBNull(9) ? 0m : r.GetDecimal(9)),
                    WeekStart: DateOnly.FromDateTime(r.GetDateTime(0)));
            }
        }
        catch { /* matview missing → fall through to insufficient_data */ }
        return EmptyScore();
    }

    private static FarmerHealthScoreBreakdownDto EmptyScore() => new(
        Total: 0,
        Bucket: "intervention",
        Flag: "insufficient_data",
        Pillars: new FarmerHealthPillarsDto(0m, 0m, 0m, 0m, 0m, 0m),
        WeekStart: DateOnly.FromDateTime(DateTime.UtcNow.Date));

    private static async Task<IReadOnlyList<FarmerHealthTimelineDto>> GetTimelineAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        var dict = new Dictionary<DateOnly, FarmerHealthTimelineDto>();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    DATE(occurred_at_utc AT TIME ZONE 'UTC') AS day,
                    event_type,
                    COUNT(*) AS n
                FROM analytics.events
                WHERE farm_id = @farm
                  AND occurred_at_utc >= NOW() - INTERVAL '14 days'
                GROUP BY day, event_type
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                var d = DateOnly.FromDateTime(r.GetDateTime(0));
                var et = r.GetString(1);
                var n = (int)r.GetInt64(2);
                var current = dict.TryGetValue(d, out var existing)
                    ? existing
                    : new FarmerHealthTimelineDto(d, 0, 0, 0, 0, 0, 0);
                dict[d] = et switch
                {
                    "closure.started"          => current with { ClosuresStarted   = current.ClosuresStarted + n },
                    "closure.submitted"        => current with { ClosuresSubmitted = current.ClosuresSubmitted + n },
                    "proof.attached"           => current with { ProofAttached     = current.ProofAttached + n },
                    "closure_summary.viewed"   => current with { SummariesViewed   = current.SummariesViewed + n },
                    "verification.recorded"    => current with { Verifications     = current.Verifications + n },
                    "api.error" or "client.error" => current with { Errors          = current.Errors + n },
                    _ => current
                };
            }
        }
        catch { /* graceful empty timeline */ }

        // Backfill the 14-day window so the UI always has a stable shape.
        var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
        var window = new List<FarmerHealthTimelineDto>(14);
        for (int i = 13; i >= 0; i--)
        {
            var d = today.AddDays(-i);
            window.Add(dict.TryGetValue(d, out var row)
                ? row
                : new FarmerHealthTimelineDto(d, 0, 0, 0, 0, 0, 0));
        }
        return window;
    }

    private static async Task<FarmerHealthVerificationCountsDto> GetVerificationCountsAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    COUNT(*) FILTER (WHERE ve.status = 'Confirmed') AS confirmed,
                    COUNT(*) FILTER (WHERE ve.status = 'Verified')  AS verified,
                    COUNT(*) FILTER (WHERE ve.status = 'Disputed')  AS disputed,
                    COUNT(*) FILTER (WHERE ve.status = 'Pending')   AS pending
                FROM ssf.verification_events ve
                JOIN ssf.daily_logs l ON l."Id" = ve.daily_log_id
                WHERE l.farm_id = @farm
                  AND ve.occurred_at_utc >= NOW() - INTERVAL '14 days'
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                return new FarmerHealthVerificationCountsDto(
                    Confirmed: (int)r.GetInt64(0),
                    Verified:  (int)r.GetInt64(1),
                    Disputed:  (int)r.GetInt64(2),
                    Pending:   (int)r.GetInt64(3));
            }
        }
        catch { /* graceful zero-counts */ }
        return new FarmerHealthVerificationCountsDto(0, 0, 0, 0);
    }

    private static async Task<IReadOnlyList<FarmerHealthWorkerSummaryDto>> GetTopWorkersAsync(
        DbConnection conn, Guid farmId, int limit, CancellationToken ct)
    {
        var rows = new List<FarmerHealthWorkerSummaryDto>(limit);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT "Id", name_raw, assignment_count, first_seen_utc
                FROM ssf.workers
                WHERE farm_id = @farm
                ORDER BY assignment_count DESC, first_seen_utc DESC
                LIMIT @lim
                """;
            AddParam(cmd, "@farm", farmId);
            AddParam(cmd, "@lim", limit);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                rows.Add(new FarmerHealthWorkerSummaryDto(
                    WorkerId: r.GetGuid(0),
                    Name: r.GetString(1),
                    AssignmentCount: r.GetInt32(2),
                    FirstSeenUtc: new DateTimeOffset(r.GetDateTime(3), TimeSpan.Zero)));
            }
        }
        catch { /* graceful empty */ }
        return rows;
    }

    private static async Task<FarmerHealthSyncStateDto> GetSyncStateAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        DateTime? lastSyncAt = null;
        int failed7d = 0;
        var lastErrors = new List<FarmerHealthSyncErrorDto>(10);

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT MAX(occurred_at_utc) FROM analytics.events
                WHERE farm_id = @farm AND event_type IN ('sync.completed','log.created')
                """;
            AddParam(cmd, "@farm", farmId);
            var raw = await cmd.ExecuteScalarAsync(ct);
            if (raw is DateTime dt) lastSyncAt = dt;
        }
        catch { /* graceful */ }

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT COUNT(*) FROM analytics.events
                WHERE farm_id = @farm
                  AND event_type IN ('api.error', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
                """;
            AddParam(cmd, "@farm", farmId);
            var raw = await cmd.ExecuteScalarAsync(ct);
            failed7d = raw is long l ? (int)l : raw is int i ? i : 0;
        }
        catch { /* graceful */ }

        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    occurred_at_utc,
                    COALESCE(props->>'endpoint', 'unknown'),
                    COALESCE((props->>'statusCode')::int, 0),
                    COALESCE(props->>'message', '')
                FROM analytics.events
                WHERE farm_id = @farm
                  AND event_type IN ('api.error','client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '7 days'
                ORDER BY occurred_at_utc DESC
                LIMIT 10
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                lastErrors.Add(new FarmerHealthSyncErrorDto(
                    Ts: r.GetDateTime(0),
                    Endpoint: r.GetString(1),
                    Status: r.GetInt32(2),
                    Message: r.GetString(3)));
            }
        }
        catch { /* graceful */ }

        return new FarmerHealthSyncStateDto(
            LastSyncAt: lastSyncAt,
            PendingPushes: 0, // server-side cannot observe device-side queue depth
            FailedPushesLast7d: failed7d,
            LastErrors: lastErrors);
    }

    private static async Task<FarmerHealthAiHealthDto> GetAiHealthAsync(
        DbConnection conn, Guid farmId, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    COUNT(*)                                                             AS total,
                    COALESCE(
                        (COUNT(*) FILTER (WHERE props->>'provider' = 'voice'
                                             AND props->>'outcome'  = 'success'))::numeric
                      / NULLIF(COUNT(*) FILTER (WHERE props->>'provider' = 'voice'), 0)::numeric,
                        1.0)                                                             AS voice_success,
                    COALESCE(
                        (COUNT(*) FILTER (WHERE props->>'provider' = 'receipt'
                                             AND props->>'outcome'  = 'success'))::numeric
                      / NULLIF(COUNT(*) FILTER (WHERE props->>'provider' = 'receipt'), 0)::numeric,
                        1.0)                                                             AS receipt_success
                FROM analytics.events
                WHERE event_type = 'ai.invocation'
                  AND farm_id = @farm
                  AND occurred_at_utc >= NOW() - INTERVAL '14 days'
                """;
            AddParam(cmd, "@farm", farmId);
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                return new FarmerHealthAiHealthDto(
                    VoiceParseSuccessRate14d:   r.IsDBNull(1) ? 1m : r.GetDecimal(1),
                    ReceiptParseSuccessRate14d: r.IsDBNull(2) ? 1m : r.GetDecimal(2),
                    InvocationCount14d:         r.IsDBNull(0) ? 0  : (int)r.GetInt64(0));
            }
        }
        catch { /* graceful */ }
        return new FarmerHealthAiHealthDto(1m, 1m, 0);
    }

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
