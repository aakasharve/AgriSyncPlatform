using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// Queries analytics.events directly for live operational health.
/// Uses raw SQL via AnalyticsDbContext connection — no SaveChanges ever.
///
/// Graceful degradation: if a view or column doesn't exist yet
/// (e.g. api.error events before Ops Phase 1 middleware is deployed),
/// the query returns empty collections rather than throwing.
///
/// <para>
/// The app-versions methods at the end of this class are the exception: they
/// let every failure escape (spec control-room-app-versions-2026-11-12). So
/// does <see cref="GetRecordedAsync"/> after them
/// (spec control-room-go-live-must-haves-2026-11-10).
/// </para>
///
/// <para>
/// <paramref name="adminDbFactory"/> is needed only by
/// <see cref="GetFarmNamesByPersonAsync"/>, the one cross-farm read here. It
/// is optional so code that builds this repository by hand for the analytics
/// queries keeps working; the container always supplies it
/// (<c>AddShramSafalInfrastructure</c> registers the factory).
/// </para>
/// </summary>
public sealed class AdminOpsRepository(
    AnalyticsDbContext analyticsContext,
    ILogger<AdminOpsRepository> logger,
    IAdminDbContextFactory<ShramSafalDbContext>? adminDbFactory = null) : IAdminOpsRepository
{
    /// <summary>
    /// Builds the DTO from a reader positioned on a row of either error
    /// projection. Shared so /admin/ops/health and /admin/ops/errors cannot
    /// drift into giving an admin two different answers about one failure.
    /// Column order must match both SELECTs.
    /// </summary>
    private static OpsErrorEventDto ReadErrorRow(System.Data.Common.DbDataReader r)
    {
        var errorCode = r.IsDBNull(6) ? null : r.GetString(6);
        var explanation = ErrorExplanations.For(errorCode);

        return new OpsErrorEventDto(
            EventType: r.GetString(0),
            Endpoint: r.GetString(1),
            StatusCode: r.IsDBNull(2) ? null : r.GetInt32(2),
            LatencyMs: r.IsDBNull(3) ? null : r.GetInt32(3),
            FarmId: r.IsDBNull(4) ? null : r.GetGuid(4),
            OccurredAtUtc: r.GetDateTime(5),
            ErrorCode: errorCode,
            WorkKept: r.IsDBNull(7) ? null : r.GetString(7),
            Message: r.IsDBNull(8) ? null : r.GetString(8),
            AppVersion: r.IsDBNull(9) ? null : r.GetString(9),
            Meaning: explanation?.Meaning,
            UsualCause: explanation?.UsualCause);
    }

    public async Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);

        try
        {
            var voice = await GetVoiceHealthAsync(conn, ct);
            var errors = await GetRecentErrorsAsync(conn, logger, ct);
            var suffering = await GetTopSufferingFarmsAsync(conn, ct);
            var (r9, r10) = await GetAlertBreachesAsync(conn, ct);

            return new AdminOpsHealthDto(
                VoiceInvocations24h: voice.total,
                VoiceFailures24h: voice.failures,
                VoiceFailureRatePct: voice.failureRate,
                VoiceAvgLatencyMs: voice.avgLatency,
                VoiceP95LatencyMs: voice.p95Latency,
                RecentErrors: errors,
                TopSufferingFarms: suffering,
                ApiErrorSpike: r9,
                VoiceDegraded: r10,
                ComputedAtUtc: DateTime.UtcNow);
        }
        finally
        {
            if (!wasOpen) await conn.CloseAsync();
        }
    }

    private static async Task<(int total, int failures, decimal failureRate, decimal avgLatency, decimal p95Latency)>
        GetVoiceHealthAsync(System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    COUNT(*)                                                          AS total,
                    COUNT(*) FILTER (WHERE props->>'outcome' = 'failure')            AS failures,
                    COALESCE(ROUND(
                        COUNT(*) FILTER (WHERE props->>'outcome' = 'failure') * 100.0
                        / NULLIF(COUNT(*), 0), 1), 0)                               AS failure_rate,
                    COALESCE(ROUND(AVG((props->>'latencyMs')::numeric)), 0)          AS avg_latency,
                    COALESCE(ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP
                        (ORDER BY (props->>'latencyMs')::numeric)), 0)              AS p95_latency
                FROM analytics.events
                WHERE event_type = 'ai.invocation'
                  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                return (
                    r.IsDBNull(0) ? 0 : (int)r.GetInt64(0),
                    r.IsDBNull(1) ? 0 : (int)r.GetInt64(1),
                    r.IsDBNull(2) ? 0m : r.GetDecimal(2),
                    r.IsDBNull(3) ? 0m : r.GetDecimal(3),
                    r.IsDBNull(4) ? 0m : r.GetDecimal(4));
            }
        }
        catch { /* table may not exist in test env */ }
        return (0, 0, 0m, 0m, 0m);
    }

    private static async Task<IReadOnlyList<OpsErrorEventDto>> GetRecentErrorsAsync(
        System.Data.Common.DbConnection conn, ILogger logger, CancellationToken ct)
    {
        var results = new List<OpsErrorEventDto>();
        try
        {
            using var cmd = conn.CreateCommand();
            // api.error events are populated after RequestObservabilityMiddleware ships (Ops Phase 1).
            // client.error events are populated after ClientErrorReporter ships (Ops Phase 3).
            // Query gracefully returns empty list until those phases are deployed.
            cmd.CommandText = """
                SELECT
                    event_type,
                    COALESCE(props->>'endpoint', 'unknown')  AS endpoint,
                    (props->>'statusCode')::int              AS status_code,
                    (props->>'latencyMs')::int               AS latency_ms,
                    farm_id,
                    occurred_at_utc,
                    props->>'errorCode'                      AS error_code,
                    props->>'workKept'                       AS work_kept,
                    props->>'message'                        AS message,
                    props->>'appVersion'                     AS app_version
                FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '2 hours'
                ORDER BY occurred_at_utc DESC
                LIMIT 50
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                results.Add(ReadErrorRow(r));
            }
        }
        catch (Exception ex)
        {
            // Still graceful — an ops dashboard must not 500 because a props
            // key is missing — but no longer silent. Before 2026-08-30 a wrong
            // projection here returned an empty list and nothing anywhere said
            // why; the admin just saw a blank panel.
            logger.LogWarning(ex,
                "AdminOpsRecentErrorsProjectionFailed. Returning an empty list; the "
                + "/admin/ops/health error panel will be blank until this is fixed.");
        }
        return results;
    }

    private static async Task<IReadOnlyList<OpsFarmErrorDto>> GetTopSufferingFarmsAsync(
        System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        var results = new List<OpsFarmErrorDto>();
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT
                    farm_id,
                    COUNT(*)                                                           AS error_count,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%sync%')          AS sync_errors,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%log%')           AS log_errors,
                    COUNT(*) FILTER (WHERE props->>'endpoint' LIKE '%voice%'
                                       OR event_type = 'ai.invocation'
                                       AND props->>'outcome' = 'failure')             AS voice_errors,
                    MAX(occurred_at_utc)                                              AS last_error_at
                FROM analytics.events
                WHERE event_type IN ('api.error', 'client.error')
                  AND occurred_at_utc >= NOW() - INTERVAL '24 hours'
                  AND farm_id IS NOT NULL
                GROUP BY farm_id
                HAVING COUNT(*) >= 2
                ORDER BY error_count DESC
                LIMIT 10
                """;
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                results.Add(new OpsFarmErrorDto(
                    FarmId: r.GetGuid(0),
                    ErrorCount: (int)r.GetInt64(1),
                    SyncErrors: (int)r.GetInt64(2),
                    LogErrors: (int)r.GetInt64(3),
                    VoiceErrors: (int)r.GetInt64(4),
                    LastErrorAt: r.GetDateTime(5)));
            }
        }
        catch { /* graceful — returns empty */ }
        return results;
    }

    private static async Task<(bool? r9, bool? r10)> GetAlertBreachesAsync(
        System.Data.Common.DbConnection conn, CancellationToken ct)
    {
        // mis.alert_r9/r10 views only exist after Ops Phase 2 migration.
        // Returns null (unknown) until then — frontend shows "—" rather than false.
        bool? r9 = null, r10 = null;
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT breached FROM mis.alert_r9_api_error_spike LIMIT 1";
            var raw = await cmd.ExecuteScalarAsync(ct);
            if (raw is bool b9) r9 = b9;
        }
        catch { /* view not yet created */ }
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT breached FROM mis.alert_r10_voice_degraded LIMIT 1";
            var raw = await cmd.ExecuteScalarAsync(ct);
            if (raw is bool b10) r10 = b10;
        }
        catch { /* view not yet created */ }
        return (r9, r10);
    }

    // ───────────────────────────────────────────────────────────
    // Phase 2 additions
    // ───────────────────────────────────────────────────────────

    public async Task<OpsErrorsPageDto> GetErrorsPagedAsync(
        int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            var sinceFilter = since?.ToUniversalTime()
                ?? DateTime.UtcNow.AddHours(-24);
            int total = 0;
            var items = new List<OpsErrorEventDto>();

            using var countCmd = conn.CreateCommand();
            countCmd.CommandText = $"""
                SELECT COUNT(*) FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= @since
                  {(endpoint is not null ? "AND props->>'endpoint' ILIKE @ep" : "")}
                """;
            AddParam(countCmd, "@since", sinceFilter);
            if (endpoint is not null) AddParam(countCmd, "@ep", $"%{endpoint}%");
            var rawCount = await countCmd.ExecuteScalarAsync(ct);
            total = rawCount is long l ? (int)l : rawCount is int i ? i : 0;

            using var dataCmd = conn.CreateCommand();
            dataCmd.CommandText = $"""
                SELECT
                    event_type,
                    COALESCE(props->>'endpoint', 'unknown'),
                    (props->>'statusCode')::int,
                    (props->>'latencyMs')::int,
                    farm_id,
                    occurred_at_utc,
                    props->>'errorCode',
                    props->>'workKept',
                    props->>'message',
                    props->>'appVersion'
                FROM analytics.events
                WHERE event_type IN ('api.error', 'api.slow', 'client.error')
                  AND occurred_at_utc >= @since
                  {(endpoint is not null ? "AND props->>'endpoint' ILIKE @ep" : "")}
                ORDER BY occurred_at_utc DESC
                LIMIT @size OFFSET @offset
                """;
            AddParam(dataCmd, "@since", sinceFilter);
            AddParam(dataCmd, "@size", pageSize);
            AddParam(dataCmd, "@offset", (page - 1) * pageSize);
            if (endpoint is not null) AddParam(dataCmd, "@ep", $"%{endpoint}%");

            using var r = await dataCmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                items.Add(ReadErrorRow(r));

            return new OpsErrorsPageDto(items, total, page, pageSize);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex,
                "AdminOpsErrorsPagedProjectionFailed: page={Page} pageSize={PageSize}. "
                + "Returning an empty page; /admin/ops/errors will look healthy when it is not.",
                page, pageSize);
            return new OpsErrorsPageDto([], 0, page, pageSize);
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"""
                SELECT
                    DATE(occurred_at_utc AT TIME ZONE 'UTC')                            AS day,
                    COUNT(*)                                                            AS total,
                    COUNT(*) FILTER (WHERE props->>'outcome' = 'failure')              AS failures,
                    COALESCE(ROUND(
                        (1 - COUNT(*) FILTER (WHERE props->>'outcome' = 'failure')::numeric
                          / NULLIF(COUNT(*), 0)) * 100, 1), 100)                       AS success_pct,
                    COALESCE(ROUND(AVG((props->>'latencyMs')::numeric)), 0)            AS avg_latency
                FROM analytics.events
                WHERE event_type = 'ai.invocation'
                  AND occurred_at_utc >= NOW() - INTERVAL '{days} days'
                GROUP BY day
                ORDER BY day ASC
                """;

            var result = new List<OpsVoiceDayDto>();
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                result.Add(new OpsVoiceDayDto(
                    DateOnly.FromDateTime(r.GetDateTime(0)),
                    r.IsDBNull(1) ? 0 : (int)r.GetInt64(1),
                    r.IsDBNull(2) ? 0 : (int)r.GetInt64(2),
                    r.IsDBNull(3) ? 100m : r.GetDecimal(3),
                    r.IsDBNull(4) ? 0m : r.GetDecimal(4)));

            return new OpsVoiceTrendDto(result);
        }
        catch { return new OpsVoiceTrendDto([]); }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    // ───────────────────────────────────────────────────────────
    // App versions — spec: control-room-app-versions-2026-11-12 (ADR 0028)
    //
    // No try/catch in any of these five. A failed query throws, the server's
    // own error path logs it and answers 500, and the page says it could not
    // load. An empty answer here would read as "nobody is on an older
    // version" (P4).
    //
    // Both app.seen reads take only rows the SERVER wrote: no actor
    // (actor_user_id IS NULL) and actor_role = 'system'. That pair is what
    // AppSeenMiddleware writes and what client ingest can never write (ingest
    // stamps every row 'user' or 'anonymous'). Ingest refuses app.seen as
    // well; this is the second lock, and it also shuts out any such row
    // already in an append-only store. Column names are the mapping in
    // AnalyticsEventConfiguration. The trigger column is deliberately not
    // part of the test.
    // ───────────────────────────────────────────────────────────

    public async Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            // Every row, not one per person: which row counts for a person is
            // a counting rule, and those live in the handler. AppSeenMiddleware
            // writes at most one row per person, version and UTC day per
            // server process, so this is small.
            cmd.CommandText = """
                SELECT
                    props->>'personId'   AS person_id,
                    props->>'appVersion' AS app_version,
                    occurred_at_utc
                FROM analytics.events
                WHERE event_type = 'app.seen'
                  AND actor_user_id IS NULL
                  AND actor_role = 'system'
                  AND occurred_at_utc >= @since
                """;
            AddParam(cmd, "@since", AsUtc(sinceUtc));

            var rows = new List<AppSeenRow>();
            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                // The person is text inside props, not a column. A row whose
                // person is not an id, or that names no version, cannot be
                // counted on any version and is skipped.
                if (r.IsDBNull(0) || !Guid.TryParse(r.GetString(0), out var personId)) continue;
                if (r.IsDBNull(1) || string.IsNullOrWhiteSpace(r.GetString(1))) continue;

                rows.Add(new AppSeenRow(personId, r.GetString(1), r.GetDateTime(2)));
            }

            return rows;
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT MIN(occurred_at_utc)
                FROM analytics.events
                WHERE event_type = 'app.seen'
                  AND actor_user_id IS NULL
                  AND actor_role = 'system'
                """;
            var raw = await cmd.ExecuteScalarAsync(ct);
            return raw is DateTime first ? first : null;
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            // public.refresh_tokens is the server's record of sign-ins (one
            // row per session). Column names are the User context's mapping
            // (RefreshTokenConfiguration). A device id that is blank, or one
            // of the server's two placeholders ("unknown": none was sent;
            // "legacy": rows from before device sessions), names no device —
            // the same rule as NewPhoneQuestion.NamesAPhone. Totals only: no
            // device id leaves this query.
            cmd.CommandText = """
                SELECT
                    COUNT(DISTINCT (s.user_id, s.device_id))
                        FILTER (WHERE s.device_known AND s.is_android)     AS phones,
                    COUNT(DISTINCT (s.user_id, s.device_id))
                        FILTER (WHERE s.device_known AND NOT s.is_android) AS other_devices,
                    COUNT(DISTINCT s.user_id)
                        FILTER (WHERE NOT s.device_known)                  AS people_with_unknown_device
                FROM (
                    SELECT
                        user_id,
                        BTRIM(device_id) AS device_id,
                        COALESCE(LOWER(BTRIM(platform)), '') = 'android' AS is_android,
                        COALESCE(LOWER(BTRIM(device_id)), '') NOT IN ('', 'unknown', 'legacy') AS device_known
                    FROM public.refresh_tokens
                    WHERE created_at_utc >= @since
                       OR last_used_at_utc >= @since
                ) s
                """;
            AddParam(cmd, "@since", AsUtc(sinceUtc));

            using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct))
            {
                throw new InvalidOperationException(
                    "The sign-in device totals query returned no row; an aggregate always returns one.");
            }

            return new SignInDevices(
                Phones: (int)r.GetInt64(0),
                OtherDevices: (int)r.GetInt64(1),
                PeopleWithUnknownDevice: (int)r.GetInt64(2));
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
        IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        var names = new Dictionary<Guid, string?>();
        if (personIds.Count == 0)
        {
            return names;
        }

        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            // public.users: the key column is "Id" (quoted, EF's default name)
            // and the name is display_name (UserConfiguration). The name only:
            // no phone number is read.
            cmd.CommandText = """
                SELECT u."Id", u.display_name
                FROM public.users u
                WHERE u."Id" = ANY(@ids)
                """;
            AddParam(cmd, "@ids", personIds.Distinct().ToArray());

            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                names[r.GetGuid(0)] = r.IsDBNull(1) ? null : r.GetString(1);
            }

            return names;
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    public async Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
        Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        var result = new Dictionary<Guid, IReadOnlyList<string>>();
        if (personIds.Count == 0)
        {
            // Nobody to look up: the factory is not opened, so no audit row.
            return result;
        }

        if (adminDbFactory is null)
        {
            throw new InvalidOperationException(
                $"{nameof(AdminOpsRepository)} was built without an admin DbContext factory, so it cannot "
                + "read farm names across farms. Resolve it from the container.");
        }

        // ssf.farms and ssf.farm_memberships are under FORCED row-level
        // security, and "the farms of these people" has no single farm scope
        // to set. So this runs on the privileged context the admin factory
        // hands out, which records an admin_cross_tenant audit row naming the
        // admin who opened the page.
        await using var ssf = await adminDbFactory.CreateAsync(
            reason: $"{nameof(AdminOpsRepository)}.app-versions-farm-names",
            actorUserId: adminUserId,
            ct: ct);

        // Forced row-level security hides every row WITHOUT an error when the
        // connection is not privileged. "This context can see no farm at all"
        // is therefore treated as that failure, not as "nobody has a farm".
        if (!await ssf.Farms.AsNoTracking().AnyAsync(ct))
        {
            throw new InvalidOperationException(
                "The admin context can see no farm at all. ssf.farms is under forced row-level security, "
                + "which returns zero rows without an error to a connection that is not privileged; "
                + "refusing to answer that nobody has a farm.");
        }

        var people = personIds.Distinct().Select(id => new UserId(id)).ToList();

        // Farms the person registered.
        var owned = await ssf.Farms
            .AsNoTracking()
            .Where(f => people.Contains(f.OwnerUserId))
            .Select(f => new { PersonId = f.OwnerUserId, FarmId = f.Id, f.Name })
            .ToListAsync(ct);

        // Farms where the person holds a seat that has not ended.
        var joined = await ssf.FarmMemberships
            .AsNoTracking()
            .Where(m => people.Contains(m.UserId)
                && m.Status != MembershipStatus.Revoked
                && m.Status != MembershipStatus.Exited)
            .Join(ssf.Farms.AsNoTracking(),
                m => m.FarmId,
                f => f.Id,
                (m, f) => new { PersonId = m.UserId, FarmId = f.Id, f.Name })
            .ToListAsync(ct);

        // An owner usually also holds a seat on his own farm: one farm, once.
        foreach (var person in owned.Concat(joined).GroupBy(x => x.PersonId))
        {
            result[person.Key.Value] = person
                .GroupBy(x => x.FarmId)
                .Select(farm => farm.First().Name)
                .OrderBy(name => name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(name => name, StringComparer.Ordinal)
                .ToList();
        }

        return result;
    }

    // ───────────────────────────────────────────────────────────
    // What was recorded — spec: control-room-go-live-must-haves-2026-11-10
    // (plan CR-1a Task R1, ADR 0027)
    //
    // No try/catch around the query. A failed query throws; the route logs it
    // and answers 503. An empty list would read as "nothing failed" (P4).
    //
    // What may NOT fail the query is one unreadable row. analytics.events is
    // append-only and client ingest checks only that a prop is present, so a
    // row whose count is a word stays inside the window until it ages out and
    // nobody can remove it. The app's failure reporter goes further: it keeps
    // the raw body of an anonymous caller as the props, and that body need
    // not be a JSON object at all (a word, a number, a list and null are all
    // valid JSON).
    //
    // For the same reason the props of a row never leave the database whole
    // (asked for by the independent review of 2026-11-14). The query takes
    // out the keys this route returns and no others, so a body an anonymous
    // caller posted is not copied into this process for one value in it.
    //
    // Every value is taken behind a test of its JSON type (jsonb_typeof), so
    // no operator is handed a kind of value it could raise on:
    //   - props that are not an object give no bag at all, and every value of
    //     that row is NULL;
    //   - text is taken only from a JSON string;
    //   - a whole number only from a JSON number with no fraction part that
    //     fits a 32-bit column, and it is cast only after that test, so the
    //     cast cannot fail;
    //   - the list of codes only from a JSON array, and only its strings.
    // A value of any other kind is NULL (the list: empty). What the code
    // below still decides is what a readable value means: blank text is no
    // value, a count is not negative, an id has the form of one, a version
    // goes through the one sanitiser.
    // ───────────────────────────────────────────────────────────

    /// <summary>The most rows <see cref="GetRecordedAsync"/> returns: the newest ones.</summary>
    public const int MaxRecordedRows = 500;

    /// <summary>
    /// How many characters of <c>props.appVersion</c> the query hands over:
    /// the first 256. It is the one value read from a row a client wrote, so
    /// its length is whatever the sender chose. A version is at most 32
    /// characters (<see cref="RequestObservabilityProps.SanitiseAppVersion"/>),
    /// so a longer value is not one, and the sanitiser says so from its first
    /// 256 characters exactly as it would from all of them. Keep this number
    /// well above the sanitiser's own limit: a value cut BELOW that limit
    /// would be returned as a version nobody stated.
    ///
    /// <para>
    /// The one answer this changes: a value that begins with 256 blank
    /// characters and has other text after them now reads as no version,
    /// where the whole value read as malformed.
    /// </para>
    /// </summary>
    private const int AppVersionCharsRead = 256;

    /// <summary>
    /// Written by the request middleware, which never sets an actor. These are
    /// the only types on which <c>props.personId</c> is believed.
    /// </summary>
    private static readonly string[] ServerWrittenTypes =
    [
        AnalyticsEventType.ApiError,
        AnalyticsEventType.ApiSlow,
        AnalyticsEventType.ApiRefused,
        AnalyticsEventType.SyncMutationRejected,
    ];

    // The WHERE clause is two locks. The first is the six event types. The
    // second is who wrote the row, and it is set type by type, because each
    // type has its own doors (plan CR-1a, amendment 4 of 2026-11-14 and its
    // correction):
    //
    //   api.error, api.slow, api.refused, sync.mutation_rejected
    //     Written by the request middleware, which never sets an actor: read
    //     only with NO actor. Before commit 7e496f87 a signed-in account
    //     could post a forged api.error through ingest; ingest stamps the
    //     caller as the actor, so such a row never reads back as a server
    //     failure.
    //
    //   sync.push_outcome
    //     Arrives through the ingest route alone, which requires sign-in and
    //     always sets the sender as the actor: read only WITH one. A report
    //     with no actor has no sender to name.
    //
    //   client.error
    //     Has two doors. Ingest sets the sender as the actor. The app's
    //     failure reporter, POST /telemetry/client-error (Program.cs), is
    //     anonymous and writes the row with no actor: read in EITHER case.
    //
    // The person follows who wrote the row. props.personId is believed on the
    // four server-written types and on no other. There it is text: it is cast
    // only when it has the shape of an id (the 8-4-4-4-12 form the middleware
    // writes), so "not-a-person" gives no person instead of failing the
    // query. The inner CASE evaluates the cast only for rows that passed the
    // pattern. On a row a client wrote the person is the actor column and
    // nothing else, whatever its props say: a client.error row with no actor
    // has no person, because its props are whatever an anonymous caller chose
    // to post.
    //
    // The name is display_name from public.users, key "Id" (quoted, EF's
    // default name; UserConfiguration). That is the only column read from the
    // user record: no phone number. The join is on the primary key, so it
    // can neither drop a row nor repeat one.
    //
    // The limit is applied to the events before the join and the order is
    // stated again after it, because a join does not promise to keep one.
    // event_id breaks ties so the newest 500 are the same 500 every time.
    //
    // The query has three levels, each with one job:
    //
    //   n  WHICH rows: the two locks, newest first, the limit. It hands the
    //      props of those rows to the level above it, inside the database.
    //
    //   b  WHOSE row it is, and which bag may be read from it. A bag is the
    //      props when they are a JSON object, and otherwise NULL:
    //        bag      any row. Only the app version is taken from it.
    //        request  a row the server wrote. The facts of a request (its
    //                 path, route, status, error name, refused saves, the
    //                 server build, the farm it addressed) are the server's:
    //                 on a row the app sent, keys of those names would be
    //                 whatever the sender chose to post, and are not read.
    //        report   the app's own sync report. The three counts are read
    //                 on that row type alone.
    //
    //   the outer SELECT  the values, each from its bag and each behind its
    //      type test, and the person's name. Its list is everything that
    //      leaves the database, in the order ReadRecordedRow reads it. It
    //      runs on the rows n kept, so no more than the limit are opened.
    private static readonly string RecordedSql = $$"""
        SELECT
            b.event_id,
            b.event_type,
            b.occurred_at_utc,
            {{TextAt("b.request", "endpoint")}} AS endpoint,
            {{TextAt("b.request", "route")}} AS route,
            {{WholeNumberAt("b.request", "statusCode")}} AS status_code,
            {{TextAt("b.request", "errorCode")}} AS error_code,
            {{StringsAt("b.request", "rejectedWorkCodes")}} AS rejected_work_codes,
            {{WholeNumberAt("b.request", "rejectedWorkItems")}} AS rejected_work_items,
            left({{TextAt("b.bag", "appVersion")}}, {{AppVersionCharsRead}}) AS app_version,
            {{TextAt("b.request", "serverBuild")}} AS server_build,
            b.person_id,
            u.display_name,
            {{TextAt("b.request", "routeFarmId")}} AS route_farm_id,
            {{WholeNumberAt("b.report", "recoveredCount")}} AS recovered_count,
            {{WholeNumberAt("b.report", "needsReviewCount")}} AS needs_review_count,
            {{WholeNumberAt("b.report", "pendingAfter")}} AS pending_after,
            b.props_are_an_object
        FROM (
            SELECT
                n.event_id,
                n.event_type,
                n.occurred_at_utc,
                jsonb_typeof(n.props) = 'object' AS props_are_an_object,
                CASE
                    WHEN jsonb_typeof(n.props) = 'object' THEN n.props
                END AS bag,
                CASE
                    WHEN n.event_type = ANY(@server_types) AND jsonb_typeof(n.props) = 'object' THEN n.props
                END AS request,
                CASE
                    WHEN n.event_type = @report_type AND jsonb_typeof(n.props) = 'object' THEN n.props
                END AS report,
                CASE
                    WHEN n.event_type = ANY(@server_types) THEN
                        CASE
                            WHEN n.props->>'personId'
                                 ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                                THEN (n.props->>'personId')::uuid
                        END
                    ELSE n.actor_user_id
                END AS person_id
            FROM (
                SELECT
                    e.event_id,
                    e.event_type,
                    e.occurred_at_utc,
                    e.actor_user_id,
                    e.props
                FROM analytics.events e
                WHERE e.occurred_at_utc >= @since
                  AND (
                          (e.event_type = ANY(@server_types) AND e.actor_user_id IS NULL)
                       OR (e.event_type = @report_type       AND e.actor_user_id IS NOT NULL)
                       OR  e.event_type = @client_error_type
                      )
                ORDER BY e.occurred_at_utc DESC, e.event_id DESC
                LIMIT @limit
            ) n
        ) b
        LEFT JOIN public.users u ON u."Id" = b.person_id
        ORDER BY b.occurred_at_utc DESC, b.event_id DESC
        """;

    // The three ways a value is taken out of a bag. The bag and the key are
    // names written in this file, never anything a caller sent.

    /// <summary>
    /// The text of a JSON string. NULL for a missing key, for a value of any
    /// other kind, and when the bag itself is NULL.
    /// </summary>
    private static string TextAt(string bag, string key) =>
        $"CASE WHEN jsonb_typeof({bag}->'{key}') = 'string' THEN {bag}->>'{key}' END";

    /// <summary>
    /// A JSON number that is written with no fraction part and fits a 32-bit
    /// column, as that number; NULL for anything else (a word, a flag, an
    /// object, 1.5, 500.0, a number too large). The inner CASE runs only for
    /// a JSON number, and its cast to a whole number only for one that passed
    /// both tests, so neither cast can fail.
    /// </summary>
    private static string WholeNumberAt(string bag, string key) =>
        $"CASE WHEN jsonb_typeof({bag}->'{key}') = 'number' THEN "
        + $"CASE WHEN scale(({bag}->>'{key}')::numeric) = 0 "
        + $"AND ({bag}->>'{key}')::numeric BETWEEN -2147483648 AND 2147483647 "
        + $"THEN ({bag}->>'{key}')::numeric::int END END";

    /// <summary>
    /// The strings of a JSON array, in its order, as a list of text; an empty
    /// list for a missing key, for a value that is not an array, and when the
    /// bag itself is NULL. Never NULL. jsonb_array_elements raises on
    /// anything that is not an array, so it is only ever given one: the value
    /// when it is an array, and an empty array when it is not.
    /// </summary>
    private static string StringsAt(string bag, string key) =>
        "ARRAY(SELECT c.item #>> '{}' FROM jsonb_array_elements("
        + $"CASE WHEN jsonb_typeof({bag}->'{key}') = 'array' THEN {bag}->'{key}' ELSE '[]'::jsonb END"
        + ") WITH ORDINALITY AS c(item, place) WHERE jsonb_typeof(c.item) = 'string' ORDER BY c.place)";

    public async Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(
        DateTime sinceUtc, CancellationToken ct = default)
    {
        var conn = analyticsContext.Database.GetDbConnection();
        var wasOpen = conn.State == System.Data.ConnectionState.Open;
        if (!wasOpen) await conn.OpenAsync(ct);
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = RecordedSql;
            AddParam(cmd, "@since", AsUtc(sinceUtc));
            AddParam(cmd, "@server_types", ServerWrittenTypes);
            AddParam(cmd, "@report_type", AnalyticsEventType.SyncPushOutcome);
            AddParam(cmd, "@client_error_type", AnalyticsEventType.ClientError);
            AddParam(cmd, "@limit", MaxRecordedRows);

            var rows = new List<OpsRecordedRowDto>();
            var rowsWithUnreadableProps = 0;

            using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                rows.Add(ReadRecordedRow(r, out var propsReadable));
                if (!propsReadable) rowsWithUnreadableProps++;
            }

            if (rowsWithUnreadableProps > 0)
            {
                // Not a failure of the read, and not silent either: these
                // rows were returned with their type, time and person, and
                // null for everything their props would have said.
                logger.LogWarning(
                    "AdminOpsRecordedPropsUnreadable: {Count} of {Total} recorded rows had props that "
                    + "could not be read as a JSON object; their values were returned as null.",
                    rowsWithUnreadableProps, rows.Count);
            }

            return rows;
        }
        finally { if (!wasOpen) await conn.CloseAsync(); }
    }

    /// <summary>
    /// One recorded row. The columns are read in the order of the SELECT
    /// list of <see cref="RecordedSql"/>, which is the order of the DTO.
    ///
    /// <para>
    /// Which values a row may carry (a request's facts on a row the server
    /// wrote, the three counts on the app's report) and what kind each value
    /// must be were decided in the query; a column that is NULL here is a
    /// value the row did not have or could not give. This method decides only
    /// what a value that was read means.
    /// </para>
    /// </summary>
    private static OpsRecordedRowDto ReadRecordedRow(System.Data.Common.DbDataReader r, out bool propsReadable)
    {
        propsReadable = r.GetBoolean(17);

        return new OpsRecordedRowDto(
            EventId: r.GetGuid(0),
            EventType: r.GetString(1),
            OccurredAtUtc: AsUtc(r.GetDateTime(2)),
            Endpoint: ReadText(r, 3),
            Route: ReadText(r, 4),
            StatusCode: ReadWholeNumber(r, 5),
            ErrorCode: ReadText(r, 6),
            RejectedWorkCodes: ReadCodes(r, 7),
            RejectedWorkItems: ReadCount(r, 8),

            // The server's rows went through this sanitiser when they were
            // written, so for them it changes nothing. The app's report
            // arrives through ingest, which does not check what a version
            // looks like; reading it through the same sanitiser keeps one
            // definition of a version on every row.
            AppVersion: RequestObservabilityProps.SanitiseAppVersion(ReadText(r, 9)),

            ServerBuild: ReadText(r, 10),
            PersonId: r.IsDBNull(11) ? null : r.GetGuid(11),

            // No user record, or a blank name: null. Nothing is made up.
            PersonName: ReadText(r, 12),

            RouteFarmId: ReadId(r, 13),
            RecoveredCount: ReadCount(r, 14),
            NeedsReviewCount: ReadCount(r, 15),
            PendingAfter: ReadCount(r, 16));
    }

    /// <summary>Text that is not blank; a NULL column or blank text is null.</summary>
    private static string? ReadText(System.Data.Common.DbDataReader r, int column) =>
        !r.IsDBNull(column) && r.GetString(column) is { } text && !string.IsNullOrWhiteSpace(text)
            ? text
            : null;

    /// <summary>A whole number; a NULL column (the value was not a whole number, or was absent) is null.</summary>
    private static int? ReadWholeNumber(System.Data.Common.DbDataReader r, int column) =>
        r.IsDBNull(column) ? null : r.GetInt32(column);

    /// <summary>A whole number that is zero or more: a count of things cannot be negative.</summary>
    private static int? ReadCount(System.Data.Common.DbDataReader r, int column) =>
        ReadWholeNumber(r, column) is int count && count >= 0 ? count : null;

    /// <summary>An id in the form the middleware writes it (8-4-4-4-12); anything else is null.</summary>
    private static Guid? ReadId(System.Data.Common.DbDataReader r, int column) =>
        ReadText(r, column) is { } text && Guid.TryParseExact(text, "D", out var id) ? id : null;

    /// <summary>The distinct, non-blank strings of the list, in its order; a NULL column is an empty list.</summary>
    private static IReadOnlyList<string> ReadCodes(System.Data.Common.DbDataReader r, int column)
    {
        if (r.IsDBNull(column))
        {
            return [];
        }

        var codes = new List<string>();
        foreach (var code in r.GetFieldValue<string[]>(column))
        {
            if (!string.IsNullOrWhiteSpace(code) && !codes.Contains(code))
            {
                codes.Add(code);
            }
        }

        return codes;
    }

    // Npgsql sends a DateTime to a timestamptz column only when its Kind is Utc.
    private static DateTime AsUtc(DateTime value) =>
        value.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(value, DateTimeKind.Utc)
            : value.ToUniversalTime();

    private static void AddParam(System.Data.IDbCommand cmd, string name, object value)
    {
        var p = cmd.CreateParameter();
        p.ParameterName = name;
        p.Value = value;
        cmd.Parameters.Add(p);
    }
}
