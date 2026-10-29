// spec: pre-launch-repair L2b (R-1, R-5; founder D-41 phase A)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Finance;

/// <summary>
/// spec: pre-launch-repair L2b — money identity on REAL Postgres, through the real <c>/sync/push</c> handler and
/// production DI, connected as the non-superuser, no-BYPASSRLS <c>agrisync_app</c> role so FORCE RLS applies.
/// <list type="bullet">
///   <item>R-1: the same entry pushed twice — from two devices, so the sync store cannot collapse it — is ONE
///   row, and the second push is answered with the stored entry;</item>
///   <item>R-1: the same id from ANOTHER farm (invisible under RLS: reaches the write as a primary-key clash) or
///   from another person on the same farm is the typed <c>ShramSafal.CostEntry.Conflict</c>, nothing stored;</item>
///   <item>P11: an old phone's random ids still save exactly as before — which is how the LIVE duplicates came
///   to exist;</item>
///   <item>R-5: <c>Scripts/count-money-duplicate-keys.sql</c>, run byte for byte, counts those duplicates per farm
///   (rows made through the same old-phone path) and refuses to report as a role that cannot see every farm.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AddCostEntryIdentityRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = "agrisync_app";
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid MukadamA = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");
    private static readonly Guid FarmB = Guid.Parse("bbbb2221-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountB = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("bbbb2223-2222-2222-2222-222222222222");

    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _appConn = string.Empty;
    private string _adminConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_money_identity_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;
        _adminConn = baseConn;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await Exec(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@a, 'Money Farm A', @oa, @acA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@b, 'Money Farm B', @ob, @acB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @a, @oa, 'PrimaryOwner', NOW(), NOW(), @acA, 3),
                       (gen_random_uuid(), @a, @ma, 'Mukadam', NOW(), NOW(), @acA, 3),
                       (gen_random_uuid(), @b, @ob, 'PrimaryOwner', NOW(), NOW(), @acB, 3);
                """,
                ("a", FarmA), ("b", FarmB), ("oa", OwnerA), ("ma", MukadamA), ("ob", OwnerB), ("acA", OwnerAccountA), ("acB", OwnerAccountB));
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();
        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (!string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_adminConn);
                await admin.OpenAsync();
                await Exec(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", _scratchDbName));
                await Exec(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
            }
            catch
            {
                // Best-effort teardown; the whole throwaway cluster is deleted afterwards anyway.
            }
        }
    }

    [Fact]
    public async Task The_same_entry_pushed_twice_is_one_row_and_the_repeat_is_answered_with_the_stored_entry()
    {
        AssertNonSuperuserAppRole();
        var id = Guid.NewGuid();

        var first = await Push(OwnerA, "device-1", id, FarmA, 600m, "bill-1:line-1");
        var again = await Push(OwnerA, "device-1", id, FarmA, 600m, "bill-1:line-1");   // same device: the sync store
        var reinstalled = await Push(OwnerA, "device-2", id, FarmA, 999m, "bill-1:line-1"); // new device id: the handler

        first.Status.Should().Be("applied");
        again.Status.Should().Be("duplicate", "the same device's own earlier send, answered by the sync store as before");
        reinstalled.Status.Should().Be("applied", "a repeat of a stored id from the same farm and person is that entry again");
        JsonSerializer.Serialize(reinstalled.Data).Should().Contain(id.ToString()).And.Contain("600");
        (await CountRows(id)).Should().Be(1);
        (await Scalar("SELECT amount FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", id))).Should().Be(600m);
        Log("same entry ×3 (2 devices)", reinstalled);
    }

    [Fact]
    public async Task The_same_id_from_another_farm_is_the_typed_conflict_even_though_RLS_hides_the_row()
    {
        AssertNonSuperuserAppRole();
        var id = Guid.NewGuid();
        (await Push(OwnerA, "device-A", id, FarmA, 600m, "bill-2:line-1")).Status.Should().Be("applied");

        var clash = await Push(OwnerB, "device-B", id, FarmB, 600m, "bill-2:line-1");

        clash.Status.Should().Be(PushSyncBatchHandler.RejectedStatus);
        clash.ErrorCode.Should().Be("ShramSafal.CostEntry.Conflict");
        (await CountRows(id)).Should().Be(1);
        (await Scalar("SELECT farm_id FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", id))).Should().Be(FarmA);
        Log("cross-farm clash", clash);
    }

    [Fact]
    public async Task The_same_id_from_another_person_on_the_same_farm_is_the_typed_conflict()
    {
        AssertNonSuperuserAppRole();
        var id = Guid.NewGuid();
        (await Push(OwnerA, "device-A", id, FarmA, 600m, "bill-3:line-1")).Status.Should().Be("applied");

        var clash = await Push(MukadamA, "device-M", id, FarmA, 600m, "bill-3:line-1");

        clash.Status.Should().Be(PushSyncBatchHandler.RejectedStatus);
        clash.ErrorCode.Should().Be("ShramSafal.CostEntry.Conflict");
        (await CountRows(id)).Should().Be(1);
        Log("same farm, other person", clash);
    }

    [Fact]
    public async Task R5_the_read_only_count_finds_exactly_the_old_phone_resends_and_refuses_a_role_that_cannot_see_every_farm()
    {
        AssertNonSuperuserAppRole();
        // The OLD phone path (APK 1.0.15–1.0.17): every send a new random id, the bill line's key as the description.
        var k1 = $"{Guid.NewGuid()}:{Guid.NewGuid()}";
        var k2 = $"{Guid.NewGuid()}:{Guid.NewGuid()}";
        var k3 = $"{Guid.NewGuid()}:{Guid.NewGuid()}";
        var k4 = $"{Guid.NewGuid()}:total";
        var k1Copies = new List<Guid>();
        foreach (var _ in Enumerable.Range(0, 3))
        {
            var copy = Guid.NewGuid();
            k1Copies.Add(copy);
            (await Push(OwnerA, "old-phone", copy, FarmA, 100m, k1)).Status.Should().Be("applied");
        }
        (await Push(OwnerA, "old-phone", Guid.NewGuid(), FarmA, 50m, k2)).Status.Should().Be("applied");
        (await Push(OwnerA, "old-phone", Guid.NewGuid(), FarmA, 70m, k2)).Status.Should().Be("applied"); // copies differ
        (await Push(OwnerA, "old-phone", Guid.NewGuid(), FarmA, 30m, k3)).Status.Should().Be("applied"); // once only
        (await Push(OwnerA, "old-phone", Guid.NewGuid(), FarmA, 20m, "Urea")).Status.Should().Be("applied");
        (await Push(OwnerA, "old-phone", Guid.NewGuid(), FarmA, 20m, "Urea")).Status.Should().Be("applied"); // words: not counted
        (await Push(OwnerB, "old-phone-B", Guid.NewGuid(), FarmB, 40m, k4)).Status.Should().Be("applied");
        (await Push(OwnerB, "old-phone-B", Guid.NewGuid(), FarmB, 40m, k4)).Status.Should().Be("applied");
        var correction = await RunSyncPushAsync(OwnerA, "old-phone", $"req-{Guid.NewGuid():N}", "correct_cost_entry", new()
        {
            ["costEntryId"] = k1Copies[2],
            ["correctedAmount"] = 90m,
            ["currencyCode"] = "INR",
            ["reason"] = "farmer fixed it",
        });
        correction.Status.Should().Be("applied");

        var sql = await File.ReadAllTextAsync(ScriptPath());
        var before = await Scalar("SELECT count(*) FROM ssf.cost_entries");

        await using (var su = new NpgsqlConnection(_superuserConn))
        {
            await su.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, su);
            await using var reader = await cmd.ExecuteReaderAsync();

            var perFarm = new Dictionary<Guid, (long Keys, long Extra, decimal Amount, long Differ, long Corrected)>();
            while (await reader.ReadAsync())
            {
                perFarm[reader.GetGuid(0)] = (reader.GetInt64(1), reader.GetInt64(2), reader.GetDecimal(3), reader.GetInt64(4), reader.GetInt64(5));
            }
            perFarm.Should().HaveCount(2);
            perFarm[FarmA].Should().Be((2L, 3L, 270m, 1L, 1L), "k1 ×3 (+200), k2 ×2 differing (+70); k3 once; 'Urea' is words");
            perFarm[FarmB].Should().Be((1L, 1L, 40m, 0L, 0L));

            (await reader.NextResultAsync()).Should().BeTrue();
            var proposals = new List<(string Key, long CopyNo, Guid Id, string Proposal)>();
            while (await reader.ReadAsync())
            {
                proposals.Add((reader.GetString(1), reader.GetInt64(2), reader.GetGuid(4), reader.GetString(12)));
            }
            proposals.Should().HaveCount(7);
            proposals.Where(p => p.Key == k1).Select(p => p.Id).Should().Equal(k1Copies, "earliest first");
            proposals.Single(p => p.Key == k1 && p.CopyNo == 1).Proposal.Should().Be("keep (earliest)");
            proposals.Single(p => p.Key == k1 && p.CopyNo == 3).Proposal.Should().Be($"duplicate of {k1Copies[0]}");
            foreach (var row in proposals)
            {
                output.WriteLine($"[EVIDENCE] R-5 {row.Key} #{row.CopyNo} {row.Id} → {row.Proposal}");
            }
        }

        (await Scalar("SELECT count(*) FROM ssf.cost_entries")).Should().Be(before, "the count changes nothing");

        // As the app role (no BYPASSRLS) the guard refuses — it never reports a false "no duplicates".
        await using (var app = new NpgsqlConnection(_appConn))
        {
            await app.OpenAsync();
            await using var cmd = new NpgsqlCommand(sql, app);
            var act = async () => { await using var r = await cmd.ExecuteReaderAsync(); while (await r.NextResultAsync()) { } };
            (await act.Should().ThrowAsync<PostgresException>()).Which.MessageText.Should().Contain("Nothing was counted");
        }
    }

    // ---- helpers ----

    private Task<SyncMutationResultDto> Push(Guid actor, string deviceId, Guid costEntryId, Guid farmId, decimal amount, string description) =>
        RunSyncPushAsync(actor, deviceId, $"add_cost_entry:{costEntryId}", "add_cost_entry", new()
        {
            ["costEntryId"] = costEntryId,
            ["farmId"] = farmId,
            ["categoryId"] = "fertilizer",
            ["description"] = description,
            ["amount"] = amount,
            ["currencyCode"] = "INR",
            ["entryDate"] = "2026-10-20",
            ["direction"] = "Expense",
            ["attachments"] = Array.Empty<string>(),
        });

    private async Task<SyncMutationResultDto> RunSyncPushAsync(
        Guid actorUserId, string deviceId, string clientRequestId, string mutationType, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var handler = sp.GetRequiredService<PushSyncBatchHandler>();
        var command = new PushSyncBatchCommand(
            DeviceId: deviceId,
            AuthenticatedUserId: actorUserId,
            ActorRole: "owner",
            Mutations: new[] { new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)) },
            AppVersion: "1.0.18");
        var response = await handler.HandleAsync(command);
        response.IsSuccess.Should().BeTrue();
        return Assert.Single(response.Value!.Results);
    }

    private Task<long> CountRows(Guid id) =>
        Scalar("SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", id)).ContinueWith(t => Convert.ToInt64(t.Result));

    private async Task<object?> Scalar(string sql, params (string Name, object Value)[] args)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, read);
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task Exec(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = new NpgsqlCommand(sql, db);
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        await cmd.ExecuteNonQueryAsync();
    }

    private void AssertNonSuperuserAppRole()
    {
        using var appCheck = new NpgsqlConnection(_appConn);
        appCheck.Open();
        using var cmd = appCheck.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(cmd.ExecuteScalar()).Should().BeFalse("the app connection must be a NON-superuser, no-BYPASSRLS role so FORCE RLS is real");
    }

    private void Log(string label, SyncMutationResultDto r) =>
        output.WriteLine($"[EVIDENCE] {label}: status='{r.Status}' errorCode='{r.ErrorCode}' errorMessage='{r.ErrorMessage}'");

    private static string ScriptPath() =>
        Path.Combine(RequiresPostgresConnection.RepoRoot(), "src", "AgriSync.Bootstrapper", "Scripts", "count-money-duplicate-keys.sql");

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
