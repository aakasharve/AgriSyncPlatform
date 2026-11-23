// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
// ONE scratch database for the task-format suites (a class fixture: the migration chain runs once per class, not once per fact): the whole migration chain,
// the application role the host really connects as, two farms with their seats, and four schedule versions that carry tasks - one library row (Public) and
// one row each of the three tenants the row policy tells apart. Everything is arranged as superuser (arrangement only); everything under test is read and
// written as agrisync_app (doctrine E3), with the same two settings a request carries (agrisync.farm_id, agrisync.user_id).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Domain.Planning;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public sealed class ScheduleTaskDb : IAsyncLifetime
{
    public const string AppRoleUser = TestRoleCredentials.AppRoleUser;

    // The people: two farm owners, a worker of the first owner's farm, a paused seat on it, a staff reviewer, and a stranger with no farm.
    public static readonly Guid Owner1 = Guid.Parse("5c2d0000-0000-4000-8000-000000000011");
    public static readonly Guid Worker1 = Guid.Parse("5c2d0000-0000-4000-8000-000000000012");
    public static readonly Guid Paused1 = Guid.Parse("5c2d0000-0000-4000-8000-000000000013");
    public static readonly Guid Owner2 = Guid.Parse("5c2d0000-0000-4000-8000-000000000021");
    public static readonly Guid Staff = Guid.Parse("5c2d0000-0000-4000-8000-000000000031");
    public static readonly Guid Stranger = Guid.Parse("5c2d0000-0000-4000-8000-000000000041");
    public static readonly Guid Farm1 = Guid.Parse("5c2d0000-0000-4000-8000-0000000000a1");
    public static readonly Guid Farm2 = Guid.Parse("5c2d0000-0000-4000-8000-0000000000b1");

    // The four versions and the one task each carries.
    public static readonly Guid LibraryId = Guid.Parse("5c2d0000-0000-4000-8000-0000000001a1");
    public static readonly Guid Team1Id = Guid.Parse("5c2d0000-0000-4000-8000-0000000001b1");
    public static readonly Guid Private2Id = Guid.Parse("5c2d0000-0000-4000-8000-0000000001c1");
    public static readonly Guid Team2Id = Guid.Parse("5c2d0000-0000-4000-8000-0000000001d1");

    public const string LibraryTask = "library-task";
    public const string Team1Task = "team1-task";
    public const string Private2Task = "private2-task";
    public const string Team2Task = "team2-task";

    private static readonly DateTime Now = new(2026, 11, 23, 6, 0, 0, DateTimeKind.Utc);

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;

    public string SuperuserConn { get; private set; } = string.Empty;

    public string AppConn { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_sched2_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        SuperuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        AppConn = new NpgsqlConnectionStringBuilder(SuperuserConn)
        {
            Username = AppRoleUser,
            Password = TestRoleCredentials.AppRolePassword,
            Pooling = false,
        }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(SuperuserConn);

        await using (var raw = new NpgsqlConnection(SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm1, 'sched2 शेत १', @owner1, gen_random_uuid(), NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farm2, 'sched2 शेत २', @owner2, gen_random_uuid(), NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                                  permissions, can_manage_labour_records)
                SELECT gen_random_uuid(), f."Id", m.user_id, m.role, NOW() - INTERVAL '30 days', NOW(), f.owner_account_id, m.status, NULL, FALSE
                FROM (VALUES (@farm1::uuid, @owner1::uuid, 'PrimaryOwner', 3),
                             (@farm1::uuid, @worker1::uuid, 'Worker', 3),
                             (@farm1::uuid, @paused1::uuid, 'Worker', 4),
                             (@farm2::uuid, @owner2::uuid, 'PrimaryOwner', 3)) AS m(farm_id, user_id, role, status)
                JOIN ssf.farms f ON f."Id" = m.farm_id;
                """,
                ("farm1", Farm1), ("farm2", Farm2), ("owner1", Owner1), ("owner2", Owner2), ("worker1", Worker1), ("paused1", Paused1));
        }

        await using var db = SuperContext();
        var library = ScheduleTemplate.Import(
            LibraryId, "द्राक्ष (library)", ScheduleOwnerType.Institution, "NRCG", "Grapes", Staff, TenantScope.Public, Now,
            [new StageDefinition("छाटणी", 0, 40)], [new ImportedActivity(null, "Pruning", 0, 0, FrequencyMode.OneTime, 1)], out var problem)!;
        problem.Should().BeNull();
        var team1 = ScheduleTemplate.CreateOwn(Team1Id, "मालक १ चे", "Grapes", new UserId(Owner1), new UserId(Worker1), Now);
        var private2 = ScheduleTemplate.Create(Private2Id, "private २", "Growth", Now, new UserId(Owner2), TenantScope.Private);
        var team2 = ScheduleTemplate.CreateOwn(Team2Id, "मालक २ चे", "Grapes", new UserId(Owner2), new UserId(Owner2), Now);
        foreach (var (template, key) in new[] { (library, LibraryTask), (team1, Team1Task), (private2, Private2Task), (team2, Team2Task) })
        {
            template.SetTasks([Content(key)], [new ScheduleChallengeContent(key + "-c", "आव्हान " + key)], out var setProblem).Should().BeTrue(setProblem?.Message);
            db.ScheduleTemplates.Add(template);
        }

        await db.SaveChangesAsync();
    }

    public async Task DisposeAsync()
    {
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
        catch (NpgsqlException)
        {
            // Best-effort teardown of OUR scratch database only; a leaked one is harmless.
        }
    }

    /// <summary>A small valid task (no timer yet) with this key.</summary>
    public static ScheduleTaskContent Content(string key, ScheduleTaskTiming? timing = null) =>
        new(key, "काम " + key, ScheduleTaskKind.Work, timing ?? ScheduleTaskTiming.None(), ScheduleBasis.Stated);

    public ShramSafalDbContext SuperContext() => new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);

    public ShramSafalDbContext AppContext() => new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);

    /// <summary>Doctrine E3: the host's role is neither superuser nor BYPASSRLS. Asserted FIRST in every fact: a proof run as either proves nothing.</summary>
    public async Task AssertAppRoleIsNotVacuousAsync(ITestOutputHelper output)
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

    /// <summary>Runs <paramref name="work"/> as the application role in ONE transaction carrying the scope a request carries (farm and/or user; null = unset).</summary>
    public async Task<T> AsAppAsync<T>(Guid? user, Guid? farm, Func<NpgsqlConnection, Task<T>> work)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetScopeAsync(db, farm, user);
        var result = await work(db);
        await tx.RollbackAsync();
        return result;
    }

    public static async Task SetScopeAsync(NpgsqlConnection db, Guid? farm, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @farm, true), set_config('agrisync.user_id', @user, true)";
        cmd.Parameters.AddWithValue("farm", farm?.ToString() ?? string.Empty);
        cmd.Parameters.AddWithValue("user", user?.ToString() ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>The task keys (sorted) of <paramref name="table"/> that the scope can see.</summary>
    public Task<List<string>> VisibleKeysAsync(Guid? user, Guid? farm, string table = "ssf.schedule_tasks", string keyColumn = "task_key") =>
        AsAppAsync(user, farm, async db =>
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = $"SELECT {keyColumn} FROM {table} ORDER BY {keyColumn}";
            var keys = new List<string>();
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                keys.Add(reader.GetString(0));
            }

            return keys;
        });

    /// <summary>INSERTs one task row as the application role under a scope; returns the SQLSTATE of a refusal, or null when the row went in (it is rolled back either way).</summary>
    public Task<string?> TryInsertTaskAsync(Guid? user, Guid? farm, Guid templateId, int tenantScope, Guid? owner, string key) =>
        AsAppAsync<string?>(user, farm, async db =>
        {
            var content = Content(key);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.schedule_tasks (id, schedule_template_id, tenant_scope, owner_user_id, task_key, stage_index, order_index, name,
                                                kind, timer_kind, content, content_hash)
                VALUES (gen_random_uuid(), @template, @scope, @owner, @key, 0, 0, @name, 'work', 'none', @content::jsonb, @hash)
                """;
            cmd.Parameters.AddWithValue("template", templateId);
            cmd.Parameters.AddWithValue("scope", (short)tenantScope);
            cmd.Parameters.AddWithValue("owner", owner is { } o ? o : DBNull.Value);
            cmd.Parameters.AddWithValue("key", key);
            cmd.Parameters.AddWithValue("name", content.Name);
            cmd.Parameters.AddWithValue("content", content.ToCanonicalJson());
            cmd.Parameters.AddWithValue("hash", content.ContentHash());
            try
            {
                await cmd.ExecuteNonQueryAsync();
                return null;
            }
            catch (PostgresException ex)
            {
                return ex.SqlState;
            }
        });

    public static async Task<long> CountAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<long> SuperCountAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        return await CountAsync(db, sql, args);
    }

    internal static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }
}
