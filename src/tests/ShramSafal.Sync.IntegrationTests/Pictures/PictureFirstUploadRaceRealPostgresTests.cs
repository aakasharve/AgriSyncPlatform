// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-ID-S2; founder D-146; follow-up to lane SCH-ID-S; E3, E8)
//
// The FIRST-UPLOAD RACE on a REAL Postgres, as the real application role (agrisync_app), through the REAL SetPictureHandler, PictureStore,
// ShramSafalRepository and CallerUserTenantScope: two requests make the first picture of the same person at the same moment. Both find no row,
// both stage an insert, the second meets the unique index ux_pictures_kind_subject. Before this lane that second request ended as a 500.
// Now BOTH answer success, exactly one row exists, no file is left orphaned, and the audit trail tells the truth.
//
// WRITTEN BY LANE SCH-ID-S2 AND NOT RUN BY IT (the lane may touch no database): the orchestrator's gate runs this class on its own cluster.
// RequiresPostgres, fail-loud: every fact builds its own scratch database from the full migration chain and drops it afterwards.
//
// HOW THE RACE IS FORCED (not left to luck): the file store holds each request inside SaveAsync until BOTH have reached it. The handler reads
// the existing row BEFORE it writes the file and stages its insert AFTER it, so once both are inside SaveAsync both have already read "no
// row"; releasing them together makes both insert. Postgres makes the second insert wait for the first transaction and then refuse it with
// 23505, which is the path under test (the savepoint, the detach, the re-read, the replace-or-no-op).
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Pictures;
using ShramSafal.Domain.Pictures;
using ShramSafal.Infrastructure.Auth;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Pictures;

[Trait("Category", "RequiresPostgres")]
public sealed class PictureFirstUploadRaceRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string RoleVacuityGuardSql = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid Anna = Guid.Parse("b1b10000-1111-4111-8111-000000000001");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_pictures_race_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch database is harmless.
        }
    }

    [Fact]
    public async Task Two_concurrent_first_uploads_of_the_same_file_both_succeed_leave_one_row_and_one_file_and_one_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var storage = new RendezvousStorage(parties: 2);
        var bytes = Jpeg(1000, 'a');

        var both = await Task.WhenAll(PutAsync(Anna, bytes, storage), PutAsync(Anna, bytes, storage));

        storage.BothArrived.Should().BeTrue("the race was forced: both requests had read 'no row yet' before either inserted");
        both.Should().OnlyContain(r => r.IsSuccess, "the loser of the unique index is not an error");
        both.Select(r => r.Value!.Sha256).Distinct().Should().ContainSingle().Which.Should().Be(PictureRules.Sha256Hex(bytes));
        both.Select(r => r.Value!.Id).Distinct().Should().ContainSingle("both answers describe the one row that exists");

        var rows = await RowsAsync();
        var row = rows.Should().ContainSingle("exactly one row exists for (PERSON, Anna)").Subject;
        row.SubjectId.Should().Be(Anna);
        row.Sha256.Should().Be(PictureRules.Sha256Hex(bytes));
        storage.Keys.Should().Equal(row.StorageKey);                      // same bytes = same key: the loser's file IS the winner's file, not an orphan
        storage.Deleted.Should().BeEmpty("a no-op deletes nothing it did not clear before writing");

        var audits = await AuditsAsync();
        audits.Should().ContainSingle("the winner wrote one; the loser's no-op wrote none");
        audits[0].Payload.Should().Contain("\"replaced\":false");

        // and the row can be read again: a third request with the same file is a plain no-op
        var third = await PutAsync(Anna, bytes, new RendezvousStorage(parties: 1, files: storage.Snapshot()));
        third.IsSuccess.Should().BeTrue();
        (await RowsAsync()).Should().ContainSingle();
        (await AuditsAsync()).Should().ContainSingle("the same file again writes no audit row");
    }

    [Fact]
    public async Task Two_concurrent_first_uploads_of_different_files_both_succeed_the_later_one_replaces_and_no_file_is_orphaned()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var storage = new RendezvousStorage(parties: 2);
        var one = Jpeg(1000, 'a');
        var two = Jpeg(1500, 'b');

        var both = await Task.WhenAll(PutAsync(Anna, one, storage), PutAsync(Anna, two, storage));

        storage.BothArrived.Should().BeTrue("the race was forced");
        both.Should().OnlyContain(r => r.IsSuccess);

        var row = (await RowsAsync()).Should().ContainSingle("exactly one row exists").Subject;
        var shas = new[] { PictureRules.Sha256Hex(one), PictureRules.Sha256Hex(two) };
        shas.Should().Contain(row.Sha256, "the row holds one of the two files: the loser replaced the winner's");

        // no orphan: the only file in storage is the one the row names; the replaced file was deleted
        storage.Keys.Should().Equal(row.StorageKey);

        // the trail: the winner's first save and the loser's replace, no more, no less
        var audits = await AuditsAsync();
        audits.Should().HaveCount(2);
        audits.Count(a => a.Payload.Contains("\"replaced\":false")).Should().Be(1);
        audits.Count(a => a.Payload.Contains("\"replaced\":true")).Should().Be(1);
        both.Select(r => r.Value!.Id).Distinct().Should().ContainSingle();
        output.WriteLine($"[EVIDENCE] one row, sha256 {row.Sha256[..8]}.., files {string.Join(",", storage.Keys.Select(k => k[^20..]))}, audits {audits.Count}");
    }

    [Fact]
    public async Task One_after_another_set_then_the_same_file_then_a_different_file_is_row_no_op_replace_on_the_real_role()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var storage = new RendezvousStorage(parties: 1);
        var first = Jpeg(800, 'a');
        var second = Jpeg(900, 'b');

        (await PutAsync(Anna, first, storage)).IsSuccess.Should().BeTrue();
        (await PutAsync(Anna, first, storage)).IsSuccess.Should().BeTrue();
        (await AuditsAsync()).Should().ContainSingle("the same file again is a no-op");

        (await PutAsync(Anna, second, storage)).IsSuccess.Should().BeTrue("the UPDATE passes the update policy for the setter");

        var row = (await RowsAsync()).Should().ContainSingle().Subject;
        row.Sha256.Should().Be(PictureRules.Sha256Hex(second));
        storage.Keys.Should().ContainSingle("the replaced file was deleted").Which.Should().Be(row.StorageKey);
        (await AuditsAsync()).Should().HaveCount(2);
    }

    // ---- harness ------------------------------------------------------------------------------------------------------------------

    private static byte[] Jpeg(int size, char fill)
    {
        var bytes = new byte[size];
        new byte[] { 0xFF, 0xD8, 0xFF, 0xE0 }.CopyTo(bytes, 0);
        Array.Fill(bytes, (byte)fill, 4, size - 4);
        return bytes;
    }

    /// <summary>
    /// One request, as the API serves it: its own DbContext on the application role, the caller's own user scope (which opens the request
    /// transaction the savepoint lives in), the real handler. Each call is its own connection, so two calls really are two requests.
    /// </summary>
    private async Task<Result<PictureDto>> PutAsync(Guid caller, byte[] bytes, IAttachmentStorageService storage)
    {
        await using var db = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_appConn).Options);
        var handler = new SetPictureHandler(
            new ShramSafalRepository(db), new PictureStore(db), storage, new SystemClock(), NullLogger<SetPictureHandler>.Instance);
        var command = new SetPictureCommand(PictureKind.Person, null, new MemoryStream(bytes), caller, "1.0.17", "device-1", "sha256:ip");
        var scope = new CallerUserTenantScope(new TenantContext(), db);

        return await scope.RunForCallerAsync(caller, token => handler.HandleAsync(command, token));
    }

    private ShramSafalDbContext SuperuserContext() =>
        new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);

    private async Task<List<Picture>> RowsAsync()
    {
        await using var db = SuperuserContext();
        return await db.Pictures.AsNoTracking().ToListAsync();
    }

    private async Task<List<(string Action, string Payload)>> AuditsAsync()
    {
        await using var db = SuperuserContext();
        var audits = await db.AuditEvents.AsNoTracking().Where(a => a.EntityType == "Picture").ToListAsync();
        return audits.Select(a => (a.Action, a.Payload)).ToList();
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT current_user";
        var role = Convert.ToString(await cmd.ExecuteScalarAsync());
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());

        role.Should().Be(AppRoleUser, "the proofs must run as the role the API actually connects as");
        superOrBypass.Should().BeFalse("doctrine E3 - an RLS proof taken as a superuser or BYPASSRLS role passes for the wrong reason");
        output.WriteLine($"[EVIDENCE] role guard: current_user='{role}' rolsuper OR rolbypassrls={superOrBypass} (required False)");
    }

    private sealed class SystemClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    /// <summary>
    /// An in-memory picture storage that holds each of the first <c>parties</c> callers inside <c>SaveAsync</c> until all of them have arrived
    /// (30 seconds at most: the fact then fails loudly instead of hanging). Thread-safe: two requests use it at once.
    /// </summary>
    private sealed class RendezvousStorage(int parties, IDictionary<string, byte[]>? files = null) : IAttachmentStorageService
    {
        private readonly ConcurrentDictionary<string, byte[]> _files = new(files ?? new Dictionary<string, byte[]>());
        private readonly ConcurrentQueue<string> _deleted = new();
        private readonly TaskCompletionSource _allArrived = new(TaskCreationOptions.RunContinuationsAsynchronously);
        private int _arrived;

        public bool BothArrived => _allArrived.Task.IsCompletedSuccessfully;
        public IReadOnlyList<string> Keys => _files.Keys.OrderBy(k => k, StringComparer.Ordinal).ToList();
        public IReadOnlyList<string> Deleted => _deleted.ToList();
        public IDictionary<string, byte[]> Snapshot() => new Dictionary<string, byte[]>(_files);

        public async Task<long> SaveAsync(string relativePath, Stream content, string? contentType = null, CancellationToken ct = default)
        {
            using var copy = new MemoryStream();
            await content.CopyToAsync(copy, ct);

            if (Interlocked.Increment(ref _arrived) >= parties)
            {
                _allArrived.TrySetResult();
            }

            await _allArrived.Task.WaitAsync(TimeSpan.FromSeconds(30), ct);
            _files[relativePath] = copy.ToArray();
            return copy.Length;
        }

        public Task<Stream?> OpenReadAsync(string relativePath, CancellationToken ct = default) =>
            Task.FromResult<Stream?>(_files.TryGetValue(relativePath, out var bytes) ? new MemoryStream(bytes) : null);

        public Task DeleteAsync(string relativePath, CancellationToken ct = default)
        {
            if (_files.TryRemove(relativePath, out _))
            {
                _deleted.Enqueue(relativePath);
            }

            return Task.CompletedTask;
        }
    }
}
