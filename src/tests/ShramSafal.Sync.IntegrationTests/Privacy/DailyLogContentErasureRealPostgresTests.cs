// spec: plr-d10-redesign-real-integration-2026-10-25 (lane F1)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// <b>Lane F1 — account erasure reaches his words inside what Sathi understood</b>
/// (<c>ssf.daily_log_contents</c>), through the PRODUCTION path: the real <see cref="ErasureWorker"/>,
/// whose writes go through the admin factory (<c>ShramSafalAdminDbContextFactory</c>, the migration
/// connection) — the only role the app-role REVOKE leaves able to rewrite a stored row.
///
/// <para>Founder D-40 §3 put his whole sentence in the document; the founder's 2026-08-27 ruling keeps
/// the field reality. So: his words go — every free-text field he says or types (review S2) — on
/// EVERY version of every log he spoke; the values (what, how much, when) stay; observation text and
/// the disturbance reason follow the existing D-FREETEXT-PRESERVE disposition (kept); a log somebody
/// ELSE spoke keeps its words; and the rows he wrote are re-attributed to the erased-farmer sentinel.</para>
///
/// <para><b>Review S3.</b> The words checked are written out HERE (<see cref="HisWordFields"/>), never
/// read from the list under test. <b>N6.</b> Every log the erasure scrubbed (details or task notes)
/// moves its clock forward, so every phone re-pulls it. <b>N7.</b> Run on a connection row-level
/// security filters, the scrub refuses loudly instead of reporting success with nothing changed; run
/// on one it does not filter, it proceeds — whatever the reason (the effect is measured, not the role).
/// Every such assertion names the identity it was measured under (doctrine E3).</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyLogContentErasureRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid FarmId = Guid.Parse("f1e00000-0000-4000-8000-000000000001");
    private static readonly Guid ErasedUser = Guid.Parse("f1e00000-0000-4000-8000-000000000002");
    private static readonly Guid OtherUser = Guid.Parse("f1e00000-0000-4000-8000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("f1e00000-0000-4000-8000-000000000004");
    private static readonly Guid CycleId = Guid.Parse("f1e00000-0000-4000-8000-000000000005");
    private static readonly Guid HisLog = Guid.Parse("f1e00000-0000-4000-8000-000000000010");
    private static readonly Guid OtherLog = Guid.Parse("f1e00000-0000-4000-8000-000000000011");
    private static readonly Guid HisTaskOnlyLog = Guid.Parse("f1e00000-0000-4000-8000-000000000012");
    private static readonly DateTime LongAgo = new(2026, 10, 1, 0, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// HIS WORDS — written out by hand from <c>log.types.ts</c> / <c>observation.types.ts</c> (review
    /// S2/S3). Deliberately NOT <c>LogContentDocument.WordKeys</c>: a test that takes its expectation
    /// from the list under test can only ever agree with it.
    /// </summary>
    private static readonly string[] HisWordFields =
    [
        "fullTranscript",
        "sourceText",
        "spokenText",
        "notes",
        "note",
        "impact",
        "dueHint",
        "rawText",
        "description",
        "systemInterpretation",
    ];

    private const string HisDocument = """
        {"schema":1,"fullTranscript":"आज इथरेल अडीचशे मिली फवारली, पानावर डाग दिसले, दुपारी पाऊस आला",
         "inputs":[{"id":"p1","productName":"इथरेल","quantity":250,"unit":"मिली","sourceText":"इथरेल अडीचशे मिली","notes":"माझी टीप",
                    "systemInterpretation":"इथरेल फवारणी","provenanceVerified":true,
                    "numbers":{"dose":{"certainty":"reported","quantity":250,"spokenText":"अडीचशे मिली"}},
                    "issue":{"issueType":"PEST","reason":"अळी","note":"खालच्या पानांवर","severity":"HIGH"}}],
         "observations":[{"id":"o1","textRaw":"पानावर डाग","noteType":"issue","sourceText":"पानावर डाग दिसले",
                          "extractedTasks":[{"id":"tc1","title":"फवारणी","rawText":"उद्या फवारू"}]}],
         "plannedTasks":[{"id":"t1","title":"फवारणी","description":"उद्या फवारू","dueHint":"उद्या","dueDate":"2026-10-31"}],
         "disturbance":{"scope":"PARTIAL","group":"weather","reason":"पाऊस","note":"दुपारी थांबलो","impact":"अर्धा दिवस गेला",
                        "blockedSegments":["irrigation"]}}
        """;

    private const string OtherDocument = """
        {"schema":1,"fullTranscript":"दुसऱ्याचे शब्द","irrigation":[{"id":"i1","method":"Flood","sourceText":"पाटाने पाणी"}]}
        """;

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_f1_erasure_{Guid.NewGuid():N}";
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
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm, 'F1 Erasure Farm', @other, @other, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farm, 'P', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, modified_at_utc, source, model_version, prompt_version, content_version)
                VALUES (@his, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @erased, CURRENT_DATE, @longAgo, @longAgo, 'Voice', 'unknown', 'unknown', 2),
                       (@otherLog, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @other, CURRENT_DATE, @longAgo, @longAgo, 'Voice', 'unknown', 'unknown', 1),
                       (@taskOnly, @farm, @plot, @cycle, ARRAY[@plot], 'Plot', @erased, CURRENT_DATE, @longAgo, @longAgo, 'Voice', 'unknown', 'unknown', 2);
                -- His log: two versions (his create, then the owner's revision carrying his words on).
                INSERT INTO ssf.daily_log_contents ("Id", daily_log_id, farm_id, content_version, schema_version, document, origin, base_version, written_by_user_id, written_at_utc)
                VALUES (gen_random_uuid(), @his, @farm, 1, 1, @hisDoc::jsonb, 'create', NULL, @erased, NOW()),
                       (gen_random_uuid(), @his, @farm, 2, 1, @hisDoc::jsonb, 'revision', 1, @other, NOW()),
                -- Somebody else's log, a row HE wrote (he revised it): its words are not his and stay.
                       (gen_random_uuid(), @otherLog, @farm, 1, 1, @otherDoc::jsonb, 'revision', 1, @erased, NOW());
                -- An older phone's record of his: task lines only, one with his note.
                INSERT INTO ssf.log_tasks ("Id", daily_log_id, activity_type, notes, deviation_note, occurred_at_utc, execution_status, compliance_outcome)
                VALUES (gen_random_uuid(), @taskOnly, 'Spray इथरेल', 'माझी टीप', NULL, NOW(), 0, 0);
                """,
                ("farm", FarmId), ("plot", PlotId), ("cycle", CycleId), ("erased", ErasedUser), ("other", OtherUser),
                ("his", HisLog), ("otherLog", OtherLog), ("taskOnly", HisTaskOnlyLog), ("longAgo", LongAgo),
                ("hisDoc", HisDocument), ("otherDoc", OtherDocument));
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
    public async Task Erasure_removes_his_words_from_every_version_keeps_the_values_and_leaves_another_speakers_words()
    {
        // The fixture carries EVERY word field, so each "not present" below can actually fail.
        foreach (var word in HisWordFields)
        {
            HisDocument.Should().Contain($"\"{word}\"", $"the fixture must carry '{word}' for this test to mean anything");
        }

        var startedAt = DateTime.UtcNow.AddSeconds(-5);
        await RunOneErasurePassAsync();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        foreach (var version in new[] { 1, 2 })
        {
            var (document, erasedAt, writtenBy) = await ReadRowAsync(db, HisLog, version);
            output.WriteLine($"[EVIDENCE] his log v{version} after erasure: {document}");
            using var doc = JsonDocument.Parse(document);
            foreach (var word in HisWordFields)
            {
                document.Should().NotContain($"\"{word}\"", $"'{word}' is his words (v{version})");
            }

            var input = doc.RootElement.GetProperty("inputs")[0];
            input.GetProperty("productName").GetString().Should().Be("इथरेल");
            input.GetProperty("quantity").GetInt32().Should().Be(250);
            input.GetProperty("unit").GetString().Should().Be("मिली");
            input.GetProperty("numbers").GetProperty("dose").GetProperty("quantity").GetInt32().Should().Be(250);
            input.GetProperty("issue").GetProperty("reason").GetString().Should().Be("अळी");
            doc.RootElement.GetProperty("observations")[0].GetProperty("textRaw").GetString().Should().Be("पानावर डाग",
                "observation text follows D-FREETEXT-PRESERVE");
            doc.RootElement.GetProperty("plannedTasks")[0].GetProperty("dueDate").GetString().Should().Be("2026-10-31");
            doc.RootElement.GetProperty("disturbance").GetProperty("reason").GetString().Should().Be("पाऊस",
                "the disturbance reason follows D-FREETEXT-PRESERVE");
            erasedAt.Should().NotBeNull();
            if (version == 1)
            {
                writtenBy.Should().NotBe(ErasedUser, "the row he wrote is re-attributed to the sentinel");
            }
            else
            {
                writtenBy.Should().Be(OtherUser, "a row somebody else wrote keeps its writer");
            }
        }

        var (otherDocument, otherErasedAt, otherWrittenBy) = await ReadRowAsync(db, OtherLog, 1);
        output.WriteLine($"[EVIDENCE] another speaker's log after erasure: {otherDocument}");
        otherDocument.Should().Contain("दुसऱ्याचे शब्द").And.Contain("पाटाने पाणी", "these are not his words");
        otherErasedAt.Should().BeNull();
        otherWrittenBy.Should().NotBe(ErasedUser, "but the row HE wrote no longer names him");

        // Review N6 — every log the erasure scrubbed moves forward, so every phone re-pulls it and
        // loses his words; a log it did not scrub keeps its clock.
        var hisModified = await ModifiedAtAsync(db, HisLog);
        var taskOnlyModified = await ModifiedAtAsync(db, HisTaskOnlyLog);
        var otherModified = await ModifiedAtAsync(db, OtherLog);
        output.WriteLine($"[EVIDENCE] modified_at_utc after erasure: his={hisModified:O} taskOnly={taskOnlyModified:O} other={otherModified:O}");
        hisModified.Should().BeOnOrAfter(startedAt, "his details were scrubbed");
        taskOnlyModified.Should().BeOnOrAfter(startedAt, "his task notes were scrubbed");
        otherModified.Should().Be(LongAgo, "nothing on another speaker's log was scrubbed");

        await using var notes = db.CreateCommand();
        notes.CommandText = "SELECT COUNT(*) FROM ssf.log_tasks WHERE daily_log_id = @id AND notes IS NOT NULL";
        notes.Parameters.AddWithValue("id", HisTaskOnlyLog);
        ((long)(await notes.ExecuteScalarAsync())!).Should().Be(0);
    }

    [Fact]
    public async Task On_a_connection_row_level_security_filters_the_scrub_refuses_loudly_instead_of_changing_nothing()
    {
        var appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = TestRoleCredentials.AppRoleUser,
            Password = TestRoleCredentials.AppRolePassword,
        }.ConnectionString;

        // The identity, measured on the connection itself (doctrine E3), and what it can see of his stored
        // details with no tenant set: nothing. A scrub that trusted it would read zero rows and "succeed".
        var identity = await IdentityAsync(appConn);
        output.WriteLine($"[EVIDENCE] identity: {identity}");
        identity.User.Should().Be(TestRoleCredentials.AppRoleUser);
        identity.RowSecurityActive.Should().BeTrue($"row-level security filters ssf.daily_log_contents for {identity}");
        identity.Visible.Should().Be(0, $"{identity} sees none of the 3 stored rows");

        await using var appContext = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(appConn).Options);
        var scrub = () => ErasureWorker.ScrubDailyLogContentWordsAsync(
            appContext, ErasedUser, Guid.NewGuid(), DateTime.UtcNow, CancellationToken.None);

        var refused = await scrub.Should().ThrowAsync<InvalidOperationException>(
            $"as {identity} the scrub must refuse loudly, never report success over rows it could not see");
        output.WriteLine($"[EVIDENCE] scrub as {identity.User} -> {refused.Which.Message}");
        refused.Which.Message.Should().Contain("row-level security");

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var (document, erasedAt, _) = await ReadRowAsync(db, HisLog, 1);
        document.Should().Contain("fullTranscript", $"nothing was changed by {identity.User}, and nothing claims it was");
        erasedAt.Should().BeNull();
    }

    [Fact]
    public async Task On_the_local_clusters_privileged_role_the_same_scrub_proceeds_and_removes_his_words()
    {
        // Mechanism-agnostic: the scrub does not ask WHY this identity reads unfiltered (superuser here; prod's
        // agrisync_admin is neither superuser nor BYPASSRLS, but a member of rds_superuser) — only that it does.
        var identity = await IdentityAsync(_superuserConn);
        output.WriteLine($"[EVIDENCE] identity: {identity}");
        identity.RowSecurityActive.Should().BeFalse($"row-level security does not filter ssf.daily_log_contents for {identity}");
        identity.Visible.Should().Be(3, $"{identity} sees all 3 stored rows");

        await using var privileged = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);
        var changed = await ErasureWorker.ScrubDailyLogContentWordsAsync(
            privileged, ErasedUser, Guid.NewGuid(), DateTime.UtcNow, CancellationToken.None);
        output.WriteLine($"[EVIDENCE] scrub as {identity.User} -> {changed} rows changed (2 scrubbed + 2 re-attributed)");
        changed.Should().Be(4, $"as {identity.User} his two versions are scrubbed and the two rows he wrote are re-attributed");

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        foreach (var version in new[] { 1, 2 })
        {
            var (document, erasedAt, _) = await ReadRowAsync(db, HisLog, version);
            foreach (var word in HisWordFields)
            {
                document.Should().NotContain($"\"{word}\"", $"'{word}' is his words (v{version}, scrubbed as {identity.User})");
            }

            erasedAt.Should().NotBeNull();
        }
    }

    private sealed record ConnectionIdentity(string User, bool Superuser, bool BypassRls, bool RowSecurityActive, long Visible)
    {
        public override string ToString() =>
            $"{User} (rolsuper={Superuser}, rolbypassrls={BypassRls}, row_security_active={RowSecurityActive}, rows visible={Visible})";
    }

    private static async Task<ConnectionIdentity> IdentityAsync(string connectionString)
    {
        await using var conn = new NpgsqlConnection(connectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT current_user, r.rolsuper, r.rolbypassrls, row_security_active('ssf.daily_log_contents'),
                   (SELECT COUNT(*) FROM ssf.daily_log_contents)
            FROM pg_roles r WHERE r.rolname = current_user
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        return new ConnectionIdentity(reader.GetString(0), reader.GetBoolean(1), reader.GetBoolean(2), reader.GetBoolean(3), reader.GetInt64(4));
    }

    private async Task RunOneErasurePassAsync()
    {
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await ExecAsync(seed, $"""
                INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES ('{requestId}', '{ErasedUser}', NULL, 0, NOW());
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

    private static async Task<DateTime> ModifiedAtAsync(NpgsqlConnection db, Guid logId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT modified_at_utc FROM ssf.daily_logs WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", logId);
        return DateTime.SpecifyKind((DateTime)(await cmd.ExecuteScalarAsync())!, DateTimeKind.Utc);
    }

    private static async Task<(string Document, DateTime? ErasedAt, Guid WrittenBy)> ReadRowAsync(NpgsqlConnection db, Guid logId, int version)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT document::text, words_erased_at_utc, written_by_user_id
            FROM ssf.daily_log_contents WHERE daily_log_id = @log AND content_version = @v
            """;
        cmd.Parameters.AddWithValue("log", logId);
        cmd.Parameters.AddWithValue("v", version);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        return (reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetDateTime(1), reader.GetGuid(2));
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
