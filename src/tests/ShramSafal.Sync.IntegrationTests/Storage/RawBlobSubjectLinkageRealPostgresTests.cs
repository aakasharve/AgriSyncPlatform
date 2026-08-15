// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN (P0.9-blob-linkage)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Storage;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Storage;

/// <summary>
/// §P0.9 — <c>ssf.raw_blob_subjects</c> against a REAL Postgres, driven through
/// the real production write path
/// (<c>ShramSafalRepository.UpsertRawBlobIndexAsync</c>).
///
/// <para>
/// <b>Why real Postgres is mandatory and an in-memory provider would be
/// worthless.</b> The ShramSafal context configures NO snake_case naming
/// convention. A property without an explicit <c>HasColumnName</c> is addressed
/// in PascalCase against a snake_case table and every statement throws
/// <c>42703 column … does not exist</c>. An in-memory provider has no column
/// names at all, so it happily "passes" the exact bug that matters.
/// <c>ssf.correction_events</c> shipped with precisely this defect and never
/// held a single row in its entire production life, because the failure was
/// silent at the call site.
/// </para>
///
/// <para>
/// <b>Read this before changing the harness: writes run ADMIN-ELEVATED, and
/// that is not a convenience.</b> Under a tenant-scoped
/// <see cref="TenantContext"/> the pre-existing
/// <c>TenantConnectionInterceptor</c> prepends <c>SET LOCAL …;</c> to every
/// command, which desyncs EF's rows-affected accounting on WRITES and makes
/// <c>SaveChangesAsync</c> throw <c>DbUpdateConcurrencyException: expected to
/// affect 1 row(s), but actually affected 0</c>. That is a known, documented,
/// deliberately-deferred systemic defect (spec
/// <c>interceptor-write-rowsaffected-desync-2026-06-06</c>), it predates this
/// task, and admin elevation is the repo's own established workaround. It is
/// pinned here by <see cref="KNOWN_DEFECT_TenantScopedWrite_StillBreaksBeforeTheLinkageIsReached"/>
/// rather than left as prose, because it currently prevents this linkage from
/// being written on the live voice path.
/// </para>
///
/// <para>
/// <b>Verification reads use a superuser connection</b> so RLS does not hide
/// the rows under test. The policy itself is asserted separately, on its text,
/// in <see cref="RlsPolicy_IsUserKeyed_AndDoesNotDependOnAiJobs"/>.
/// </para>
///
/// <para>
/// <b>Fails, never skips.</b> <see cref="RequiresPostgresConnection"/> throws
/// when Postgres is unreachable, and the superuser probe below throws when the
/// verification connection could not actually bypass RLS — so an unrunnable
/// suite reports FAILED rather than a green "0 assertions".
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class RawBlobSubjectLinkageRealPostgresTests : IAsyncLifetime
{
    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _scratchConn = string.Empty;
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await ResolveRlsBypassingConnectionOrThrowAsync();

        _scratchDbName = $"ssf_p09_blob_subject_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _scratchConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;

        // The FULL migration chain, including this task's
        // 20260815102440_AddRawBlobSubjects. A malformed migration kills the
        // suite here rather than surfacing as a confusing assertion failure.
        await IntegrationMigrationChain.ApplyAsync(_scratchConn);

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _scratchConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _scratchConn,
                ["ConnectionStrings:UserDb"] = _scratchConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        await _provider.DisposeAsync();
        NpgsqlConnection.ClearAllPools();

        await using var admin = new NpgsqlConnection(_rootConn);
        await admin.OpenAsync();
        await using var drop = admin.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
        await drop.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// THE named red→green test. A blob written by user X is linked to X, and
    /// the linkage round-trips back through the EF model — which is what proves
    /// the snake_case mapping, in both directions, against a real engine.
    /// </summary>
    [Fact]
    public async Task BlobWrittenByUserX_IsLinkedToUserX_AndRoundTripsThroughEf()
    {
        var userX = Guid.NewGuid();
        var blob = BlobRef("11");

        await UpsertAsync(userX, blob);

        // ── Read 1: through the EF model. A PascalCase-vs-snake_case mapping
        //    error on the READ side surfaces here as 42703.
        var viaEf = await QueryAsync(db => db.RawBlobSubjects
            .AsNoTracking()
            .Where(x => x.Sha256 == blob.Sha256)
            .ToListAsync());

        var linkage = viaEf.Should().ContainSingle().Subject;
        linkage.UserId.Should().Be(userX);
        linkage.Sha256.Should().Be(blob.Sha256);
        linkage.FirstSeenUtc.Should().NotBe(default);

        // ── Read 2: raw SQL against the physical columns by their literal
        //    snake_case names. If the EF model and the physical table had
        //    drifted apart, exactly one of these two reads would fail.
        var rows = await RawQueryAsync(
            "SELECT user_id::text FROM ssf.raw_blob_subjects WHERE sha256 = @sha",
            ("sha", blob.Sha256));
        rows.Should().ContainSingle().Which.Should().Be(userX.ToString());
    }

    /// <summary>
    /// The linkage survives the erasure cascade's central act. This is the whole
    /// point of §P0.9: <c>ErasureWorker</c> deletes
    /// <c>ai_jobs WHERE user_id = X</c>, and before this table that DELETE
    /// destroyed the only user→audio pointer, leaving the S3 object permanently
    /// unattributable.
    ///
    /// <para>
    /// Note what this deliberately does NOT assert: that the audio is deleted,
    /// or retained for any period. Raw-audio retention and erasure design is
    /// deferred to counsel (§17). This proves only that the question stays
    /// ANSWERABLE afterwards.
    /// </para>
    /// </summary>
    [Fact]
    public async Task LinkageSurvives_WhenTheAiJobsRowIsDeleted()
    {
        var userX = Guid.NewGuid();
        var blob = BlobRef("22");

        await UpsertAsync(userX, blob);

        // Stand in for the cascade: the ai_jobs pointer disappears.
        await ExecuteRawAsync("DELETE FROM ssf.ai_jobs WHERE user_id = @uid", ("uid", userX));

        var survivors = await RawQueryAsync(
            "SELECT user_id::text FROM ssf.raw_blob_subjects WHERE sha256 = @sha",
            ("sha", blob.Sha256));

        survivors.Should().ContainSingle().Which.Should().Be(userX.ToString(),
            because: "the blob's subject must still be knowable after the erasure cascade " +
                     "deletes ai_jobs — otherwise the S3 object is orphaned forever");
    }

    /// <summary>
    /// Idempotency on <c>(sha256, user_id)</c>: the same farmer persisting the
    /// same clip repeatedly must not accumulate linkage rows.
    ///
    /// <para>
    /// It MUST, however, still increment <c>ref_count</c> — that column counts
    /// persist events, not subjects, and this task does not change its
    /// behaviour. Asserting both in one test is deliberate: it pins the two
    /// quantities as INDEPENDENT, so a future change that "simplifies" one into
    /// the other breaks here rather than in production.
    /// </para>
    /// </summary>
    [Fact]
    public async Task RepeatPersistBySameUser_IsANoOpForLinkage_ButStillCountsAsARef()
    {
        var userX = Guid.NewGuid();
        var blob = BlobRef("33");

        await UpsertAsync(userX, blob);
        await UpsertAsync(userX, blob);
        await UpsertAsync(userX, blob);

        var linkageRows = await RawQueryAsync(
            "SELECT user_id::text FROM ssf.raw_blob_subjects WHERE sha256 = @sha",
            ("sha", blob.Sha256));
        linkageRows.Should().ContainSingle("the linkage is keyed on (sha256, user_id)");

        var refCount = await RawQueryAsync(
            "SELECT ref_count::text FROM ssf.raw_blob_index WHERE sha256 = @sha",
            ("sha", blob.Sha256));
        refCount.Should().ContainSingle().Which.Should().Be("3",
            because: "ref_count counts persist events and is unchanged by this task; " +
                     "it is NOT a count of distinct subjects");
    }

    /// <summary>
    /// Two different users referencing the same sha256 produce TWO linkage rows
    /// and a <c>ref_count</c> of 2.
    ///
    /// <para>
    /// This is the case that makes a scalar <c>user_id</c> column on
    /// <c>raw_blob_index</c> unsafe: with a column, farmer B would either
    /// overwrite farmer A or be dropped, and a later erasure for one of them
    /// would then destroy the other's evidence or spare it invisibly.
    /// </para>
    /// </summary>
    [Fact]
    public async Task TwoUsersSameSha_ProduceTwoLinkageRows_AndRefCountTwo()
    {
        var farmerA = Guid.NewGuid();
        var farmerB = Guid.NewGuid();
        var blob = BlobRef("44");

        await UpsertAsync(farmerA, blob);
        await UpsertAsync(farmerB, blob);

        var subjects = await RawQueryAsync(
            "SELECT user_id::text FROM ssf.raw_blob_subjects WHERE sha256 = @sha ORDER BY user_id",
            ("sha", blob.Sha256));
        subjects.Should().BeEquivalentTo(new[] { farmerA.ToString(), farmerB.ToString() });

        var refCount = await RawQueryAsync(
            "SELECT ref_count::text FROM ssf.raw_blob_index WHERE sha256 = @sha",
            ("sha", blob.Sha256));
        refCount.Should().ContainSingle().Which.Should().Be("2");
    }

    /// <summary>
    /// A null subject writes NO linkage row. An unknown owner is recorded as the
    /// ABSENCE of a row — never <see cref="Guid.Empty"/>, never a minted GUID.
    /// The blob index row is still written, so the bytes stay accounted for;
    /// only the ownership claim is withheld, because there is none to make.
    /// </summary>
    [Fact]
    public async Task NullSubject_WritesNoLinkageRow_AndFabricatesNoOwner()
    {
        var blob = BlobRef("55");

        await UpsertAsync(subjectUserId: null, blob);

        var indexRows = await RawQueryAsync(
            "SELECT sha256 FROM ssf.raw_blob_index WHERE sha256 = @sha", ("sha", blob.Sha256));
        indexRows.Should().ContainSingle("the blob itself is still indexed");

        var linkageRows = await RawQueryAsync(
            "SELECT user_id::text FROM ssf.raw_blob_subjects WHERE sha256 = @sha",
            ("sha", blob.Sha256));
        linkageRows.Should().BeEmpty("absence is how 'unknown owner' is recorded");

        // And specifically: no all-zero sentinel crept in anywhere.
        var sentinels = await RawQueryAsync(
            "SELECT sha256 FROM ssf.raw_blob_subjects WHERE user_id = '00000000-0000-0000-0000-000000000000'::uuid");
        sentinels.Should().BeEmpty();
    }

    /// <summary>
    /// The physical table is exactly the shape the linkage needs: snake_case
    /// columns, a composite PK that IS the idempotency key, and an index on
    /// <c>user_id</c> for the only query that will ever matter ("every blob
    /// belonging to this subject").
    /// </summary>
    [Fact]
    public async Task PhysicalTable_HasSnakeCaseColumns_CompositeKey_AndUserIndex()
    {
        var columns = await RawQueryAsync(
            @"SELECT column_name FROM information_schema.columns
               WHERE table_schema = 'ssf' AND table_name = 'raw_blob_subjects'
               ORDER BY column_name");
        columns.Should().BeEquivalentTo(new[] { "first_seen_utc", "sha256", "user_id" });

        var pk = await RawQueryAsync(
            @"SELECT a.attname
                FROM pg_index i
                JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
               WHERE i.indrelid = 'ssf.raw_blob_subjects'::regclass AND i.indisprimary
               ORDER BY a.attname");
        pk.Should().BeEquivalentTo(new[] { "sha256", "user_id" });

        var indexes = await RawQueryAsync(
            "SELECT indexname FROM pg_indexes WHERE schemaname='ssf' AND tablename='raw_blob_subjects'");
        indexes.Should().Contain("ix_raw_blob_subjects_user_id");
    }

    /// <summary>
    /// The RLS policy must NOT be expressed in terms of <c>ssf.ai_jobs</c>.
    ///
    /// <para>
    /// The sibling policy <c>p_tenant_raw_blob_index</c> EXISTS-joins to
    /// <c>ai_jobs</c>, which means that once an erasure deletes the job rows the
    /// index row becomes invisible as well as unattributable. Copying that shape
    /// onto this table would silently reintroduce the exact defect §P0.9 exists
    /// to remove, and no data assertion would catch it — the rows would be
    /// there, just permanently unreadable. So the policy text itself is the
    /// assertion.
    /// </para>
    /// </summary>
    [Fact]
    public async Task RlsPolicy_IsUserKeyed_AndDoesNotDependOnAiJobs()
    {
        // Npgsql surfaces bool as CLR bool, so ToString() gives "True"; psql
        // would give "true". Compare case-insensitively rather than pinning a
        // driver formatting detail.
        var forced = await RawQueryAsync(
            "SELECT relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.raw_blob_subjects'::regclass");
        forced.Should().ContainSingle().Which.Should().BeEquivalentTo("true");

        var quals = await RawQueryAsync(
            "SELECT qual FROM pg_policies WHERE schemaname='ssf' AND tablename='raw_blob_subjects'");

        var qual = quals.Should().ContainSingle().Subject;
        qual.Should().Contain("user_id", "the policy keys on this table's own subject column");
        qual.Should().NotContain("ai_jobs",
            because: "a policy that depends on ai_jobs would make the linkage invisible the " +
                     "moment the erasure cascade deletes those rows — the very failure this " +
                     "table was added to prevent");

        // ADR 0020 — every tenant-GUC cast is NULLIF-wrapped so an empty GUC
        // fails closed instead of raising 22P02.
        qual.Should().Contain("NULLIF");
    }

    /// <summary>
    /// TRIPWIRE for a PRE-EXISTING defect that this task did not introduce and
    /// deliberately does not fix — recorded as an executable assertion rather
    /// than a paragraph, because it currently stops the §P0.9 linkage from ever
    /// being written on the live voice path.
    ///
    /// <para>
    /// Under a tenant-scoped <see cref="TenantContext"/> the
    /// <c>TenantConnectionInterceptor</c> prepends <c>SET LOCAL …;</c> to the
    /// command text, which desyncs EF's rows-affected accounting on writes.
    /// <c>UpsertRawBlobIndexAsync</c> therefore throws at its ORIGINAL
    /// <c>SaveChangesAsync</c> — before any code added by this task runs — and
    /// <c>AiOrchestrator.TryPersistRawBlobAsync</c> swallows the exception by
    /// design (a cold-tier failure must not fail the farmer's voice parse). Net
    /// effect: no linkage row.
    /// </para>
    ///
    /// <para>
    /// <c>/shramsafal/ai/voice-parse</c>, <c>/ai/receipt-extract</c> and
    /// <c>/ai/patti-extract</c> are NOT in
    /// <c>TenantTransactionMiddleware.SkipPathPrefixes</c>, so they run
    /// tenant-scoped and hit this. Tracked as
    /// <c>interceptor-write-rowsaffected-desync-2026-06-06</c>; the fix touches
    /// a high-trust shared file and needs its own brief.
    /// </para>
    ///
    /// <para>
    /// <b>When that defect is fixed, this test will fail.</b> That is the
    /// intended signal: delete it, and re-point the suite's writes at a
    /// tenant-scoped context.
    /// </para>
    /// </summary>
    [Fact]
    public async Task KNOWN_DEFECT_TenantScopedWrite_StillBreaksBeforeTheLinkageIsReached()
    {
        var userX = Guid.NewGuid();
        var blob = BlobRef("66");

        await using var scope = _provider.CreateAsyncScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.SetUserScoped(userX); // exactly what the middleware does

        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var repo = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();

        await using var tx = await db.Database.BeginTransactionAsync();

        var act = async () => await repo.UpsertRawBlobIndexAsync(blob, userX, CancellationToken.None);

        (await act.Should().ThrowAsync<DbUpdateConcurrencyException>(
                because: "the pre-existing SET LOCAL prepend desyncs EF's rows-affected " +
                         "accounting on writes; see interceptor-write-rowsaffected-desync-2026-06-06"))
            .WithMessage("*affected 0 row(s)*");
    }

    // ── helpers ──────────────────────────────────────────────────────────

    /// <summary>
    /// A real content-addressed <see cref="RawBlobRef"/> derived from a marker,
    /// so each test owns a distinct sha256 and the value is a genuine 64-char
    /// lowercase-hex hash rather than a hand-made string.
    /// </summary>
    private static RawBlobRef BlobRef(string marker) =>
        RawBlobRef.FromBytes(System.Text.Encoding.UTF8.GetBytes($"p09-blob-{marker}"), "audio/webm");

    /// <summary>
    /// Drives the REAL production write path — a scoped
    /// <see cref="IShramSafalRepository"/> from the real DI graph, inside a
    /// transaction. Admin-elevated for the interceptor reason documented on the
    /// class and pinned by the tripwire test above.
    /// </summary>
    private async Task UpsertAsync(Guid? subjectUserId, RawBlobRef blob)
    {
        await using var scope = _provider.CreateAsyncScope();

        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.ElevateToAdminCrossTenant();

        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var repo = scope.ServiceProvider.GetRequiredService<IShramSafalRepository>();

        await using var tx = await db.Database.BeginTransactionAsync();
        await repo.UpsertRawBlobIndexAsync(blob, subjectUserId, CancellationToken.None);
        await tx.CommitAsync();
    }

    private async Task<T> QueryAsync<T>(Func<ShramSafalDbContext, Task<T>> query)
    {
        await using var scope = _provider.CreateAsyncScope();
        var tenant = scope.ServiceProvider.GetRequiredService<TenantContext>();
        tenant.ElevateToAdminCrossTenant();

        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        return await query(db);
    }

    private async Task<List<string>> RawQueryAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var conn = new NpgsqlConnection(_scratchConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var results = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            results.Add(reader.IsDBNull(0) ? string.Empty : reader.GetValue(0).ToString() ?? string.Empty);
        }
        return results;
    }

    private async Task ExecuteRawAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var conn = new NpgsqlConnection(_scratchConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Resolves a connection whose role can actually READ the FORCE-RLS tables
    /// under test, and PROVES it — every table in <c>ssf</c> is
    /// <c>FORCE ROW LEVEL SECURITY</c>, so a non-superuser verification
    /// connection would return zero rows and every assertion here would be
    /// vacuous rather than wrong. Throws instead of degrading.
    /// </summary>
    private static async Task<string> ResolveRlsBypassingConnectionOrThrowAsync()
    {
        // 1. CI's explicitly-provisioned root connection (same convention the
        //    rest of the RequiresPostgres suites use).
        // 2. Local dev: the migration connection, which by repo convention runs
        //    as the superuser role.
        var candidates = new[]
        {
            Environment.GetEnvironmentVariable("REQUIRES_POSTGRES_ROOT_CONN"),
            ReadConnectionStringOrNull("ShramSafalDb_Migration"),
        };

        foreach (var candidate in candidates.Where(c => !string.IsNullOrWhiteSpace(c)))
        {
            try
            {
                await using var probe = new NpgsqlConnection(candidate);
                await probe.OpenAsync();
                await using var cmd = probe.CreateCommand();
                cmd.CommandText =
                    "SELECT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname = current_user";
                if (await cmd.ExecuteScalarAsync() is true)
                {
                    return candidate!;
                }
            }
            catch
            {
                // Try the next candidate; the throw below reports the outcome.
            }
        }

        throw new InvalidOperationException(
            "RequiresPostgres/§P0.9: no reachable Postgres connection whose role can bypass RLS. " +
            "Every ssf table is FORCE ROW LEVEL SECURITY, so a non-superuser verification connection " +
            "would read zero rows and every assertion in this suite would pass vacuously. This suite " +
            "must FAIL rather than silently prove nothing. Set REQUIRES_POSTGRES_ROOT_CONN to a " +
            "superuser/BYPASSRLS connection, or provide ConnectionStrings:ShramSafalDb_Migration in " +
            "src/AgriSync.Bootstrapper/appsettings.Development.json.");
    }

    private static string? ReadConnectionStringOrNull(string name)
    {
        var path = Path.Combine(
            RequiresPostgresConnection.RepoRoot(), "src", "AgriSync.Bootstrapper", "appsettings.Development.json");
        if (!File.Exists(path))
        {
            return null;
        }

        var cfg = new ConfigurationBuilder().AddJsonFile(path, optional: true).Build();
        var conn = cfg.GetConnectionString(name);
        return string.IsNullOrWhiteSpace(conn) ? null : conn;
    }
}
