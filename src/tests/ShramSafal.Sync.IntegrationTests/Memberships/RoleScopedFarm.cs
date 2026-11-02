// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — the ONE seeded farm the
// role-scoped download, push and REST-door suites read: one farm, its owner, a सहमालक whose money the owner
// switched off, a मुकादम holding take हजेरी, two कामगार, a paused member, and a second farm. Everything is
// written through the production write path (/sync/push as agrisync_app) except what has no farmer write
// path (a day-ledger row, a job card, a test record, a planned step), which is inserted as superuser.
// Reads go through the real host (routes, middleware, tenant scoping) on a real Postgres as agrisync_app.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public abstract class RoleScopedFarm(ITestOutputHelper output) : IAsyncLifetime
{
    protected const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    protected static readonly Guid FarmA = Guid.Parse("3d030000-0000-4000-8000-0000000000a1");
    protected static readonly Guid AccountA = Guid.Parse("3d030000-0000-4000-8000-0000000000a2");
    protected static readonly Guid PlotA = Guid.Parse("3d030000-0000-4000-8000-0000000000a3");
    protected static readonly Guid CycleA = Guid.Parse("3d030000-0000-4000-8000-0000000000a4");
    protected static readonly Guid FarmB = Guid.Parse("3d030000-0000-4000-8000-0000000000b1");
    protected static readonly Guid AccountB = Guid.Parse("3d030000-0000-4000-8000-0000000000b2");
    protected static readonly Guid PlotB = Guid.Parse("3d030000-0000-4000-8000-0000000000b3");
    protected static readonly Guid CycleB = Guid.Parse("3d030000-0000-4000-8000-0000000000b4");

    protected static readonly Guid Owner = Guid.Parse("3d030000-0000-4000-8000-000000000011");
    protected static readonly Guid CoOwner = Guid.Parse("3d030000-0000-4000-8000-000000000012");
    protected static readonly Guid Mukadam = Guid.Parse("3d030000-0000-4000-8000-000000000013");
    protected static readonly Guid Worker = Guid.Parse("3d030000-0000-4000-8000-000000000014");
    protected static readonly Guid Worker2 = Guid.Parse("3d030000-0000-4000-8000-000000000015");
    protected static readonly Guid Paused = Guid.Parse("3d030000-0000-4000-8000-000000000016");
    protected static readonly Guid OwnerB = Guid.Parse("3d030000-0000-4000-8000-000000000017");

    protected const string OwnerName = "मालक-अशोक";
    protected const string CoOwnerName = "सहमालक-सीमा";
    protected const string MukadamName = "मुकादम-गणेश";
    protected const string WorkerName = "कामगार-रवी";
    protected const string Worker2Name = "कामगार-सुनील";
    protected const string PausedName = "थांबवलेला-विजय";
    protected const string OwnerBName = "दुसरे-शेत-पाटील";
    protected const string CrewName = "मजूर-अनिल";

    protected static readonly Guid FieldOperator = Guid.Parse("3d030000-0000-4000-8000-000000000021");
    protected static readonly Guid OwnerLog = Guid.Parse("3d030000-0000-4000-8000-000000000031");
    protected static readonly Guid MukadamLog = Guid.Parse("3d030000-0000-4000-8000-000000000032");
    protected static readonly Guid WorkerLog = Guid.Parse("3d030000-0000-4000-8000-000000000033");
    protected static readonly Guid Worker2Log = Guid.Parse("3d030000-0000-4000-8000-000000000034");
    protected static readonly Guid FarmBLog = Guid.Parse("3d030000-0000-4000-8000-000000000035");
    protected static readonly Guid OwnerCrew = Guid.Parse("3d030000-0000-4000-8000-000000000041");
    protected static readonly Guid MukadamCrew = Guid.Parse("3d030000-0000-4000-8000-000000000042");
    protected static readonly Guid WorkerCrew = Guid.Parse("3d030000-0000-4000-8000-000000000043");
    protected static readonly Guid Worker2Crew = Guid.Parse("3d030000-0000-4000-8000-000000000044");
    protected static readonly Guid Cost = Guid.Parse("3d030000-0000-4000-8000-000000000051");
    protected static readonly Guid CostB = Guid.Parse("3d030000-0000-4000-8000-000000000052");
    protected static readonly Guid Ledger = Guid.Parse("3d030000-0000-4000-8000-000000000053");
    protected static readonly Guid JobCard = Guid.Parse("3d030000-0000-4000-8000-000000000054");
    protected static readonly Guid Mark = Guid.Parse("3d030000-0000-4000-8000-000000000055");
    protected static readonly Guid Protocol = Guid.Parse("3d030000-0000-4000-8000-000000000056");
    protected static readonly Guid TestRecord = Guid.Parse("3d030000-0000-4000-8000-000000000057");
    protected static readonly Guid Planned = Guid.Parse("3d030000-0000-4000-8000-000000000058");
    protected static readonly Guid FarmPhoto = Guid.Parse("3d030000-0000-4000-8000-000000000061");
    protected static readonly Guid OwnerLogPhoto = Guid.Parse("3d030000-0000-4000-8000-000000000062");
    protected static readonly Guid Receipt = Guid.Parse("3d030000-0000-4000-8000-000000000063");
    protected static readonly Guid WorkerLogPhoto = Guid.Parse("3d030000-0000-4000-8000-000000000064");

    // Every amount the farm holds, chosen so none can occur by accident in a JSON body.
    protected const decimal CostAmount = 9876.54m;
    protected const decimal CostBAmount = 5555.67m;
    protected const decimal OwnerWage = 432.17m;
    protected const decimal OwnerCrewTotal = 3457.36m;
    protected const decimal OwnerInputCost = 777.73m;
    protected const decimal MukadamWage = 211.19m;
    protected const decimal MukadamCrewTotal = 1689.52m;
    protected const decimal MukadamInputCost = 333.37m;
    protected const decimal WorkerWage = 155.53m;
    protected const decimal Worker2Wage = 166.61m;
    protected const decimal JobRate = 6129.37m;

    protected static readonly string[] FarmAMoney =
    [
        "9876.54", "432.17", "3457.36", "777.73", "211.19", "1689.52", "333.37", "166.61", "6129.37",
    ];

    protected const string WorkDay = "2026-10-30";

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    protected string SuperuserConn { get; private set; } = string.Empty;
    protected string AppConn { get; private set; } = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    protected ITestOutputHelper Output => output;

    /// <summary>lane F99 — the real host's services (its route table, for the route sweep).</summary>
    protected IServiceProvider HostServices => _app!.Services;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_mu3_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        SuperuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        AppConn = new NpgsqlConnectionStringBuilder(SuperuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(SuperuserConn);

        await using (var raw = new NpgsqlConnection(SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            var phone = 9_300_000_001L;
            foreach (var (id, name) in new[]
                     {
                         (Owner, OwnerName), (CoOwner, CoOwnerName), (Mukadam, MukadamName), (Worker, WorkerName),
                         (Worker2, Worker2Name), (Paused, PausedName), (OwnerB, OwnerBName),
                     })
            {
                await ExecAsync(raw, """
                    INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc,
                                              created_at_utc, is_active, auth_mode, preferred_language)
                    VALUES (@id, @phone, @name, 'x', NOW(), NOW(), TRUE, 0, 'mr');
                    """, ("id", id), ("phone", (phone++).ToString()), ("name", name));
            }

            // Seats granted 30 days ago (they predate everything the farm holds).
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'MU-3 शेत A', @owner, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'MU-3 शेत B', @ownerB, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                                  permissions, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @owner,   'PrimaryOwner',   NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, FALSE),
                       -- the सहमालक as the 2b upgrade left him (see money, see wages, farm setup, हजेरी) with MONEY SWITCHED OFF:
                       (gen_random_uuid(), @farmA, @coOwner, 'SecondaryOwner', NOW() - INTERVAL '30 days', NOW(), @accountA, 3, 256, TRUE),
                       (gen_random_uuid(), @farmA, @mukadam, 'Mukadam',        NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, TRUE),
                       (gen_random_uuid(), @farmA, @worker,  'Worker',         NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, FALSE),
                       (gen_random_uuid(), @farmA, @worker2, 'Worker',         NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, FALSE),
                       -- paused, though every power is stored on his seat:
                       (gen_random_uuid(), @farmA, @paused,  'SecondaryOwner', NOW() - INTERVAL '30 days', NOW(), @accountA, 4, 1 | 2 | 256, TRUE),
                       (gen_random_uuid(), @farmB, @ownerB,  'PrimaryOwner',   NOW() - INTERVAL '30 days', NOW(), @accountB, 3, NULL, FALSE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA, @farmA, 'प्लॉट A', 1.0, NOW(), NOW()),
                       (@plotB, @farmB, 'प्लॉट B', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA, @farmA, @plotA, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleB, @farmB, @plotB, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                INSERT INTO ssf.field_operators ("Id", display_name, display_name_normalized, full_name, originating_farm_id,
                                                 created_by_user_id, created_at_utc, is_active)
                VALUES (@operator, 'हजेरी-शंकर', 'हजेरी-शंकर', NULL, @farmA, @owner, NOW(), TRUE);
                """,
                ("farmA", FarmA), ("accountA", AccountA), ("owner", Owner), ("coOwner", CoOwner), ("mukadam", Mukadam),
                ("worker", Worker), ("worker2", Worker2), ("paused", Paused), ("farmB", FarmB), ("accountB", AccountB),
                ("ownerB", OwnerB), ("plotA", PlotA), ("plotB", PlotB), ("cycleA", CycleA), ("cycleB", CycleB),
                ("operator", FieldOperator));
        }

        _app = await BuildHostAsync(AppConn);
        _client = _app.GetTestClient();

        // ── The farm's records, money, attendance and photos, through the real write path ──
        await PushAppliedAsync(Owner, "create_daily_log", "mu3-owner-log",
            LogPayload(OwnerLog, Owner, OwnerCrew, 8, OwnerWage, OwnerCrewTotal, [CrewName], OwnerInputCost));
        await PushAppliedAsync(Mukadam, "create_daily_log", "mu3-mukadam-log",
            LogPayload(MukadamLog, Mukadam, MukadamCrew, 8, MukadamWage, MukadamCrewTotal, [], MukadamInputCost));
        await PushAppliedAsync(Worker, "create_daily_log", "mu3-worker-log",
            LogPayload(WorkerLog, Worker, WorkerCrew, 2, WorkerWage, null, [], null));
        await PushAppliedAsync(Worker2, "create_daily_log", "mu3-worker2-log",
            LogPayload(Worker2Log, Worker2, Worker2Crew, 3, Worker2Wage, null, [], null));
        await PushAppliedAsync(Owner, "add_cost_entry", "mu3-cost", CostPayload(Cost, FarmA, PlotA, CycleA, CostAmount));
        await PushAppliedAsync(Owner, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:{WorkDay}:Full:-:-:-",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Mark,
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = WorkDay,
                ["dayMark"] = "Full",
            });
        await PushAppliedAsync(Owner, "create_attachment", "mu3-photo-farm", AttachmentPayload(FarmPhoto, FarmA, "Farm"));
        await PushAppliedAsync(Owner, "create_attachment", "mu3-photo-log", AttachmentPayload(OwnerLogPhoto, OwnerLog, "DailyLog"));
        await PushAppliedAsync(Owner, "create_attachment", "mu3-photo-receipt", AttachmentPayload(Receipt, Cost, "CostEntry"));
        await PushAppliedAsync(Worker, "create_attachment", "mu3-photo-worker-log", AttachmentPayload(WorkerLogPhoto, WorkerLog, "DailyLog"));

        // Farm B — another farmer's farm, with its own record and money.
        await PushAppliedAsync(OwnerB, "create_daily_log", "mu3-farmb-log", new Dictionary<string, object?>
        {
            ["dailyLogId"] = FarmBLog,
            ["farmId"] = FarmB,
            ["plotId"] = PlotB,
            ["cropCycleId"] = CycleB,
            ["operatorUserId"] = OwnerB,
            ["logDate"] = WorkDay,
        });
        await PushAppliedAsync(OwnerB, "add_cost_entry", "mu3-cost-b", CostPayload(CostB, FarmB, PlotB, CycleB, CostBAmount));

        // No farmer write path makes these directly: the day ledger of the cost, a job card with its rate,
        // a test record and a planned step.
        await using (var raw = new NpgsqlConnection(SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                             created_at_utc, modified_at_utc)
                VALUES (@ledger, @farmA, @cost, DATE '2026-10-30', 'equal', @owner, NOW(), NOW());
                INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status,
                                           created_at_utc, modified_at_utc, line_items)
                VALUES (@jc, @farmA, @plotA, @cycleA, @owner, DATE '2026-10-30', 'Draft', NOW(), NOW(),
                        '[{"activityType":"spray","expectedHours":4,"rateAmount":6129.37,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
                INSERT INTO ssf.test_protocols (id, name, crop_type, kind, periodicity, created_by_user_id, created_at_utc)
                VALUES (@protocol, 'माती चाचणी', 'Grapes', 0, 0, @owner, NOW());
                INSERT INTO ssf.test_instances (id, test_protocol_id, protocol_kind, crop_cycle_id, farm_id, plot_id, stage_name,
                                                planned_due_date, created_at_utc, modified_at_utc, status)
                VALUES (@test, @protocol, 0, @cycleA, @farmA, @plotA, 'Vegetative', DATE '2026-10-01', NOW(), NOW(), 0);
                INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
                VALUES (@planned, @cycleA, 'फवारणी', 'Vegetative', DATE '2026-10-01', NOW(), NOW());
                """,
                ("ledger", Ledger), ("farmA", FarmA), ("cost", Cost), ("owner", Owner), ("jc", JobCard), ("plotA", PlotA),
                ("cycleA", CycleA), ("protocol", Protocol), ("test", TestRecord), ("planned", Planned));
        }
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await ExecAsync(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch (NpgsqlException ex)
        {
            // Best-effort teardown of OUR scratch database only; a leaked one is harmless, and said.
            output.WriteLine($"[teardown] scratch DB not dropped: {ex.GetType().Name}");
        }
    }

    // ── E3 ───────────────────────────────────────────────────────────────────────────────

    /// <summary>Doctrine E3 — asserted FIRST in every fact: the host connects as a role that is neither superuser nor BYPASSRLS.</summary>
    protected async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        reader.GetString(0).Should().Be(AppRoleUser);
        reader.GetBoolean(1).Should().BeFalse("doctrine E3 - a proof run as a superuser or BYPASSRLS role proves nothing");
        output.WriteLine($"[PROVISIONING] role={reader.GetString(0)} superuser_or_bypassrls={reader.GetBoolean(1)}");
    }

    // ── Reads through the real host ──────────────────────────────────────────────────────

    /// <summary>
    /// GET /sync/pull as <paramref name="user"/>; the raw JSON body and the parsed root. MU-3 fix 1 (review F1): the
    /// cursor is sent the way EVERY phone sends it — rounded DOWN to the whole second (<c>transport.ts</c>
    /// <c>toISOString().replace(/\.\d{3}Z$/, 'Z')</c>; 1.0.17 has the same line) — never with fractions no phone
    /// sends. <paramref name="farms"/>: the farms the phone says it holds (<c>farms=</c>, fix 1 F9).
    /// </summary>
    protected async Task<(string Body, JsonElement Root)> PullAsync(Guid user, DateTime? since = null, IEnumerable<Guid>? farms = null)
    {
        var cursor = PhoneCursor(since ?? DateTime.UnixEpoch);
        var held = farms is null ? string.Empty : "&farms=" + Uri.EscapeDataString(string.Join(',', farms));
        using var response = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(cursor)}{held}", user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"the pull must succeed for {user}: {(int)response.StatusCode} {body}");
        return (body, JsonDocument.Parse(body).RootElement.Clone());
    }

    /// <summary>A cursor exactly as a phone sends it back: rounded down to the whole second, "Z".</summary>
    protected static string PhoneCursor(DateTime cursor)
    {
        var utc = cursor.ToUniversalTime();
        return new DateTime(utc.Ticks - (utc.Ticks % TimeSpan.TicksPerSecond), DateTimeKind.Utc).ToString("yyyy-MM-ddTHH:mm:ssZ");
    }

    /// <summary>The owner's switches on one seat, through the real domain decision (as the owner's page sets them).</summary>
    protected async Task SetAuthoritiesAsync(Guid farmId, Guid user, params FarmAuthority[] authorities)
    {
        await using var db = NewSuperuserContext();
        var seat = await db.FarmMemberships.SingleAsync(m => m.FarmId == new FarmId(farmId) && m.UserId == new UserId(user));
        seat.SetAuthorities(authorities.ToDictionary(a => a, _ => (DateTime?)null), DateTime.UtcNow);
        await db.SaveChangesAsync();
    }

    protected ShramSafalDbContext NewSuperuserContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(SuperuserConn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options);

    /// <summary>
    /// Runs <paramref name="body"/> in a request scope of the real host, user-scoped as <paramref name="user"/>
    /// (only <c>agrisync.user_id</c> set, the posture of every multi-farm read): for a door whose ROUTE cannot
    /// be opened in a test (see the REST-door suite), its handler or rule is asked exactly as the route asks it.
    /// </summary>
    protected async Task<T> AsUserAsync<T>(Guid user, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _app!.Services.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().SetUserScoped(user);
        return await body(scope.ServiceProvider);
    }

    /// <summary>
    /// lane PRV — runs <paramref name="body"/> in a request scope of the real host, inside one transaction (the
    /// middleware's posture), with <paramref name="user"/>'s farm scope opened on <paramref name="farmId"/> exactly as a
    /// farm route opens it (<c>ICallerFarmTenantScope.EstablishForCallerAsync</c>): for a door whose ROUTE cannot run in
    /// this host, its handler is asked as the route asks it. Rolled back: nothing it does is kept.
    /// </summary>
    protected async Task<T> AsFarmMemberAsync<T>(Guid farmId, Guid user, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _app!.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        await using var transaction = await db.Database.BeginTransactionAsync();
        var opened = await scope.ServiceProvider.GetRequiredService<ShramSafal.Application.Ports.ICallerFarmTenantScope>()
            .EstablishForCallerAsync(farmId, user);
        opened.IsSuccess.Should().BeTrue("{0} is a member of {1}", user, farmId);
        try
        {
            return await body(scope.ServiceProvider);
        }
        finally
        {
            await transaction.RollbackAsync();
        }
    }

    /// <summary>
    /// A request as <paramref name="user"/>. <paramref name="appVersion"/>: what the phone says it is (MU-3 fix 2, N1) —
    /// the new phone by default; <c>null</c> sends no version at all, as 1.0.17's job-card and worker-page calls do.
    /// </summary>
    protected async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid user, object? body = null, string? appVersion = "1.0.18")
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Add("X-Test-UserId", user.ToString());
        if (appVersion is not null)
        {
            request.Headers.Add("X-App-Version", appVersion);
        }
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await _client.SendAsync(request);
    }

    protected static IReadOnlyList<JsonElement> ArrayOf(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array
            ? value.EnumerateArray().ToList()
            : [];

    protected static IReadOnlyList<Guid> IdsOf(JsonElement root, string name, string idProperty = "id") =>
        ArrayOf(root, name).Select(e => e.GetProperty(idProperty).GetGuid()).ToList();

    // ── Writes through the real push path ────────────────────────────────────────────────

    protected async Task<SyncMutationResultDto> PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var result = await PushAsync(actor, mutationType, clientRequestId, payload);
        result.Status.Should().Be("applied", "{0} by {1}: error='{2}: {3}'", mutationType, actor, result.ErrorCode, result.ErrorMessage);
        return result;
    }

    protected async Task<SyncMutationResultDto> PushAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _app!.Services.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var command = new PushSyncBatchCommand(
            DeviceId: $"device-mu3-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "Worker",
            Mutations: [new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload, Web))],
            AppVersion: "1.0.18");
        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
        push.IsSuccess.Should().BeTrue("the batch itself is answered: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[PUSH] {mutationType} {clientRequestId} by {actor} -> {result.Status} {result.ErrorCode}");
        return result;
    }

    protected static Dictionary<string, object?> LogPayload(
        Guid logId, Guid operatorId, Guid crewId, int workers, decimal? wage, decimal? total, string[] names, decimal? inputCost,
        Guid? farmId = null)
    {
        var crew = new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = crewId,
            ["engagementType"] = "hired_daily",
            ["workerCount"] = workers,
        };
        if (wage is { } w) crew["wagePerPerson"] = w;
        if (total is { } t) crew["totalCost"] = t;
        if (names.Length > 0) crew["workerNames"] = names;

        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["farmId"] = farmId ?? FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = operatorId,
            ["logDate"] = WorkDay,
            ["labour"] = new object[] { crew },
        };
        if (inputCost is { } cost)
        {
            payload["content"] = new
            {
                schema = 1,
                inputs = new object[]
                {
                    new
                    {
                        id = "in-1",
                        productName = "युरिया",
                        quantity = 2,
                        unit = "kg",
                        cost,
                        numbers = new { cost = new { certainty = "reported", spokenText = "खर्च सांगितला" } },
                    },
                },
            };
        }

        return payload;
    }

    protected static Dictionary<string, object?> CostPayload(Guid id, Guid farm, Guid plot, Guid cycle, decimal amount) => new()
    {
        ["costEntryId"] = id,
        ["farmId"] = farm,
        ["categoryId"] = "fertilizer",
        ["description"] = "खत खरेदी",
        ["amount"] = amount,
        ["currencyCode"] = "INR",
        ["entryDate"] = WorkDay,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["direction"] = "Expense",
    };

    private static Dictionary<string, object?> AttachmentPayload(Guid id, Guid parent, string parentType) => new()
    {
        ["attachmentId"] = id,
        ["farmId"] = FarmA,
        ["linkedEntityId"] = parent,
        ["linkedEntityType"] = parentType,
        ["fileName"] = $"{parentType}.jpg",
        ["mimeType"] = "image/jpeg",
    };

    protected async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    protected static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>lane F99 — what the production host registers outside the module (Program.cs), for a subclass that needs it.</summary>
    protected virtual void AddHostServices(IServiceCollection services)
    {
    }

    private async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-mu3", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"mu3-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);
        builder.Services.AddScoped<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        AddHostServices(builder.Services);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();
        await app.StartAsync();
        return app;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    /// <summary>The test sign-in: the subject from X-Test-UserId.</summary>
    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue("X-Test-UserId", out var raw) || !Guid.TryParse(raw.ToString(), out var userId))
            {
                return Task.FromResult(AuthenticateResult.Fail("missing X-Test-UserId"));
            }

            var id = userId.ToString();
            var identity = new ClaimsIdentity(
                [new Claim("sub", id), new Claim(ClaimTypes.NameIdentifier, id), new Claim("phone_verified", "true")],
                Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme.Name)));
        }
    }
}
