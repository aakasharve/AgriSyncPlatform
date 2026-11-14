// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D3 fix round 1 (P004): erasure of the author of a reason, through the PRODUCTION entry point.
//
// The real ErasureWorker takes a request that has waited its 30 days and runs ProcessOneAsync, whose writes go through the admin factory (the migration
// role, the only role the append-only REVOKE leaves able to rewrite a row). Here: a person who wrote reasons on a farm is erased; his WORDS leave the
// reason rows (and the voice flag), the KIND, the item, the record, the time and his opaque id stay, and another person's words on the same record are
// untouched. A test of the scrub function alone cannot fail if the call is dead; this one can.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class LogPracticeReasonErasureRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid Farm = Guid.Parse("c3d30000-0000-4000-8000-000000000001");
    private static readonly Guid ErasedUser = Guid.Parse("c3d30000-0000-4000-8000-000000000002");
    private static readonly Guid OtherUser = Guid.Parse("c3d30000-0000-4000-8000-000000000003");
    private static readonly Guid Log = Guid.Parse("c3d30000-0000-4000-8000-000000000010");
    private static readonly Guid HisFirst = Guid.Parse("c3d30000-0000-4000-8000-000000000021");
    private static readonly Guid HisSecond = Guid.Parse("c3d30000-0000-4000-8000-000000000022");
    private static readonly Guid HisPictureOnly = Guid.Parse("c3d30000-0000-4000-8000-000000000023");
    private static readonly Guid Theirs = Guid.Parse("c3d30000-0000-4000-8000-000000000024");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_c3d_erasure_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var db = new NpgsqlConnection(_superuserConn))
        {
            await db.OpenAsync();
            await ExecAsync(db, """
                INSERT INTO ssf.log_practice_reasons ("Id", farm_id, daily_log_id, work_key, kind, words, said_by_voice, author_user_id, created_at_utc, supersedes_id)
                VALUES (@a, @farm, @log, 'work:op_tying', 'Weather', 'पाऊस आला म्हणून', true, @erased, NOW() - INTERVAL '3 days', NULL),
                       (@b, @farm, @log, 'work:op_tying', 'Extra', 'जास्त काम होतं', false, @erased, NOW() - INTERVAL '2 days', @a),
                       (@c, @farm, @log, 'spray', 'Practice', NULL, false, @erased, NOW() - INTERVAL '2 days', NULL),
                       (@d, @farm, @log, 'irrigation', 'Practice', 'दुसऱ्याचे शब्द', true, @other, NOW() - INTERVAL '1 days', NULL);
                """,
                ("farm", Farm), ("log", Log), ("erased", ErasedUser), ("other", OtherUser),
                ("a", HisFirst), ("b", HisSecond), ("c", HisPictureOnly), ("d", Theirs));
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _superuserConn,
                // The production admin factory's connection: the migration role.
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _superuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        await _provider.DisposeAsync();
        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{_scratchDbName}' AND pid <> pg_backend_pid()");
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    [Fact]
    public async Task The_real_erasure_pass_removes_the_authors_words_keeps_the_kind_and_leaves_another_authors_words()
    {
        await using (var before = new NpgsqlConnection(_superuserConn))
        {
            await before.OpenAsync();
            (await ReadAsync(before)).Should().Contain(r => r.Id == HisFirst && r.Words == "पाऊस आला म्हणून" && r.Voice, "the precondition: his words are stored");
        }

        await RunOneErasurePassAsync();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var rows = await ReadAsync(db);
        rows.Should().HaveCount(4, "no row is removed (P6: anonymise the person, never the work)");
        foreach (var id in new[] { HisFirst, HisSecond, HisPictureOnly })
        {
            var row = rows.Find(r => r.Id == id)!;
            row.Words.Should().BeNull($"his words are gone from {id}");
            row.Voice.Should().BeFalse();
            row.Author.Should().Be(ErasedUser, "his opaque id stays, as on every other append-only table");
        }

        rows.Find(r => r.Id == HisFirst)!.Kind.Should().Be("Weather");
        rows.Find(r => r.Id == HisSecond)!.Kind.Should().Be("Extra");
        rows.Find(r => r.Id == HisSecond)!.Supersedes.Should().Be(HisFirst, "the chain stays");
        rows.Find(r => r.Id == HisPictureOnly)!.Kind.Should().Be("Practice");
        var theirs = rows.Find(r => r.Id == Theirs)!;
        theirs.Words.Should().Be("दुसऱ्याचे शब्द", "another person's words on the same record are not his to erase");
        theirs.Voice.Should().BeTrue();

        // the pass says which table it scrubbed and which columns (the audit row of the erasure)
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureAnonymize' AND payload::text LIKE '%log_practice_reasons%'";
        Convert.ToInt64(await cmd.ExecuteScalarAsync()).Should().Be(1, "the erasure's own audit row names the table and its scrubbed columns");
    }

    private sealed record Row(Guid Id, string Kind, string? Words, bool Voice, Guid Author, Guid? Supersedes);

    private static async Task<List<Row>> ReadAsync(NpgsqlConnection db)
    {
        var rows = new List<Row>();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT \"Id\", kind, words, said_by_voice, author_user_id, supersedes_id FROM ssf.log_practice_reasons ORDER BY created_at_utc, \"Id\"";
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new Row(
                reader.GetGuid(0), reader.GetString(1), reader.IsDBNull(2) ? null : reader.GetString(2), reader.GetBoolean(3),
                reader.GetGuid(4), reader.IsDBNull(5) ? null : reader.GetGuid(5)));
        }

        return rows;
    }

    private async Task RunOneErasurePassAsync()
    {
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await ExecAsync(seed, $"""
                -- a request that has already waited its 30 days, so the worker takes it.
                INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES ('{requestId}', '{ErasedUser}', NULL, 0, NOW() - INTERVAL '31 days');
                """);
        }

        var worker = new ErasureWorker(_provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var workerTask = worker.StartAsync(cts.Token);

        var status = (int)ErasureStatus.Requested;
        var deadline = DateTime.UtcNow.AddSeconds(60);
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        while (DateTime.UtcNow < deadline)
        {
            await using var cmd = raw.CreateCommand();
            cmd.CommandText = $"SELECT status FROM ssf.erasure_requests WHERE id = '{requestId}'";
            status = (int)(await cmd.ExecuteScalarAsync())!;
            if (status == (int)ErasureStatus.Completed || status == (int)ErasureStatus.Failed)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), CancellationToken.None);
        }

        cts.Cancel();
        try { await workerTask; } catch (OperationCanceledException) { }

        output.WriteLine($"[EVIDENCE] erasure request status = {(ErasureStatus)status}");
        status.Should().Be((int)ErasureStatus.Completed, "ErasureWorker must complete the request within one pass");
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
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
