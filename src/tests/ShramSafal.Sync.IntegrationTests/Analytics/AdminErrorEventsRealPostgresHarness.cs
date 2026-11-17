// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Tasks 1 and 2)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// Shared set-up of the CR-2e real-database classes that write
/// <c>analytics.events</c> rows: the CR-2a harness (scratch database per test,
/// production connection shape, doctrine E3 guard) plus a raw event writer, the
/// previous month's partition (the migration creates only this month and the
/// next, so a row 8 days old would have no partition early in a month), the two
/// admin repositories in their production shape, and an admin factory that
/// counts how often it is opened.
///
/// <para><c>analytics.events</c> has DO INSTEAD NOTHING rules on DELETE and
/// UPDATE, so every test starts from its own fresh scratch database.</para>
///
/// Made-up GUIDs, obviously fake names and phone numbers only.
/// </summary>
public abstract class AdminErrorEventsRealPostgresHarness(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    protected const string ApiError = "api.error";
    protected const string ClientError = "client.error";
    protected const string AiInvocation = "ai.invocation";
    protected const string ApiSlow = "api.slow";
    protected const string ApiRefused = "api.refused";

    /// <summary>The moment the test started, truncated to the microsecond Postgres keeps.</summary>
    protected DateTime Now { get; } = Micro(DateTime.UtcNow);

    protected static DateTime Micro(DateTime value) =>
        new(value.Ticks - (value.Ticks % 10), DateTimeKind.Utc);

    protected static Task EnsurePreviousMonthPartitionAsync(NpgsqlConnection db) =>
        ExecAsync(db, """
            DO $$
            DECLARE
                cur_start  date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
                prev_start date := (date_trunc('month', now() AT TIME ZONE 'UTC') - INTERVAL '1 month')::date;
            BEGIN
                EXECUTE format(
                    'CREATE TABLE IF NOT EXISTS analytics.%I PARTITION OF analytics.events FOR VALUES FROM (%L) TO (%L);',
                    to_char(prev_start, '"events_p_"YYYY_MM'), prev_start, cur_start);
            END
            $$;
            """);

    /// <summary>One analytics.events row, written as the superuser.</summary>
    protected static Task EventAsync(
        NpgsqlConnection db, string eventType, DateTime occurredAtUtc,
        Guid? farmId = null, Guid? actorUserId = null, string props = "{}") =>
        ExecAsync(db, """
            INSERT INTO analytics.events
                (event_id, event_type, occurred_at_utc, actor_user_id, farm_id,
                 actor_role, trigger, schema_version, props)
            VALUES
                (@id, @type, @at, @actor, @farm, 'system', 'middleware', 'v1', @props::jsonb);
            """,
            ("id", Guid.NewGuid()), ("type", eventType), ("at", occurredAtUtc),
            ("actor", actorUserId), ("farm", farmId), ("props", props));

    /// <summary>A props object; a null value leaves the key out.</summary>
    protected static string Props(params (string Key, object? Value)[] pairs) =>
        JsonSerializer.Serialize(pairs
            .Where(p => p.Value is not null)
            .ToDictionary(p => p.Key, p => p.Value));

    protected async Task<NpgsqlConnection> OpenSuperuserAsync()
    {
        var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        return db;
    }

    protected static AdminOpsRepository OpsRepository(
        IServiceProvider sp, IAdminDbContextFactory<ShramSafalDbContext>? factory = null) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            factory ?? sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    protected static AdminMisRepository MisRepository(
        IServiceProvider sp, IAdminDbContextFactory<ShramSafalDbContext>? factory = null) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            factory ?? sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());

    protected static DateTime AsUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
    };

    /// <summary>The real admin factory, counting every open (each open writes one audit row).</summary>
    protected sealed class CountingAdminFactory(IAdminDbContextFactory<ShramSafalDbContext> inner)
        : IAdminDbContextFactory<ShramSafalDbContext>
    {
        private int _opens;

        public int Opens => Volatile.Read(ref _opens);

        public List<string> Reasons { get; } = new();

        public Task<ShramSafalDbContext> CreateAsync(string reason, Guid actorUserId, CancellationToken ct)
        {
            Interlocked.Increment(ref _opens);
            lock (Reasons)
            {
                Reasons.Add(reason);
            }

            return inner.CreateAsync(reason, actorUserId, ct);
        }
    }
}
