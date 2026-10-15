// spec: 2026-08-25-prod-cutover-waves (voice archive path)
//
// The SERVER half of "saved to the cloud means the server said so".
//
// Real Postgres, connected as the NON-SUPERUSER application role
// (agrisync_app), the real S3RetainedBlobStore over an in-memory S3, the real
// ConsentEnforcer and the real persist/range handlers. Nothing about the
// archive is mocked except the S3 wire.
//
// WHAT IT PINS
//  1. The acknowledgement is real: the id returned by persist is returned only
//     after the metadata row AND the sealed object exist, and the stored bytes
//     are exactly what the phone sent (the server holds ciphertext, not audio).
//  2. Persist is idempotent for the OWNER (a retry after a dropped reply does
//     not double-write) and REFUSES another account that presents the same
//     client-minted clip id. Before this change that second call came back as
//     SUCCESS, i.e. an acknowledgement for a recording that was never stored
//     for the caller and which the caller could never read back.
//  3. Tenant isolation: another account cannot read, list or overwrite it.
//  4. Consent: declined or revoked => nothing is stored, nothing acknowledged.
//  5. D9: nothing in this path deletes or expires a recording.
//
// Native Postgres (REQUIRES_POSTGRES_ROOT_CONN), self-skipping when the
// server is genuinely absent, loud when it answers and refuses.

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Threading;
using System.Threading.Tasks;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Application.UseCases.VoiceDiary.GetVoiceDiaryByRange;
using ShramSafal.Application.UseCases.VoiceDiary.PersistVoiceClipRetained;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.VoiceDiary;

[Trait("Category", "RequiresPostgres")]
public sealed class VoiceArchiveAckRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid UserA = Guid.Parse("a0a00000-0000-0000-0000-000000000001");
    private static readonly Guid UserB = Guid.Parse("b0b00000-0000-0000-0000-000000000002");
    private static readonly Guid ClipA1 = Guid.Parse("a0a00000-0000-0000-0000-0000000000c1");
    private static readonly Guid ClipA2 = Guid.Parse("a0a00000-0000-0000-0000-0000000000c2");

    // 64 recognisable bytes standing in for AES-GCM output the phone produced.
    private static readonly byte[] SealedBytes = Enumerable.Range(0, 64).Select(i => (byte)(0xC0 + i % 16)).ToArray();
    private static readonly byte[] OtherBytes = Enumerable.Range(0, 64).Select(i => (byte)(0x10 + i % 16)).ToArray();

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _root;
    private readonly InMemoryS3 _s3 = new();

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();
        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_voice_ack_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();

        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<TimeProvider>(TimeProvider.System);
        services.AddSingleton<IClock>(new FixedClock(DateTime.UtcNow));
        services.AddScoped<IConsentEnforcer, ConsentEnforcer>();
        services.AddScoped<UpdateConsentHandler>();
        _root = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_root is not null) await _root.DisposeAsync();
        _s3.Dispose();
        if (_skip || string.IsNullOrEmpty(_scratchDbName)) return;
        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // best-effort teardown
        }
    }

    private void SkipIfPostgresUnavailable()
    {
        if (_skip) output.WriteLine($"[SKIPPED] {_skipReason} - NO DATABASE WAS EXERCISED; this run proves nothing.");
        Skip.If(_skip, _skipReason);
    }

    // ── helpers ──────────────────────────────────────────────────────────

    private async Task GrantAsync(Guid user, bool granted)
    {
        await using var scope = Scope();
        var update = scope.ServiceProvider.GetRequiredService<UpdateConsentHandler>();
        var result = await update.HandleAsync(new UpdateConsentCommand(
            UserId: user, FullHistoryJournal: granted, CrossFarmAggregation: null, ResearchCorpusExport: null,
            LanguageShown: "mr-IN", ConsentTextVersion: 1, ClientAppVersion: "test-1.0",
            AuditDeviceId: "test-device", AuditIpHash: "sha256:test"));
        result.IsSuccess.Should().BeTrue();
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<PersistVoiceClipRetainedResult>> PersistAsync(
        Guid user, Guid clip, byte[] cipher, DateTime? recordedAtUtc = null)
    {
        await using var scope = Scope();
        var store = NewStore(scope);
        var handler = new PersistVoiceClipRetainedHandler(
            scope.ServiceProvider.GetRequiredService<IConsentEnforcer>(),
            store,
            scope.ServiceProvider.GetRequiredService<IShramSafalRepository>(),
            scope.ServiceProvider.GetRequiredService<IClock>());
        return await handler.HandleAsync(new PersistVoiceClipRetainedCommand(
            ClipId: clip, UserId: user,
            RecordedAtUtc: recordedAtUtc ?? DateTime.UtcNow.AddMinutes(1),
            CipherBase64: Convert.ToBase64String(cipher),
            DekId: "dek-owner-a-v1",
            IvBase64: Convert.ToBase64String(new byte[12]),
            AuthTagBase64: Convert.ToBase64String(new byte[16]),
            DurationSeconds: 5,
            Language: "mr-IN"));
    }

    private async Task<RetainedClipResult?> GetByIdAsync(Guid caller, Guid clip)
    {
        await using var scope = Scope();
        return await NewStore(scope).GetByIdAsync(clip, caller, CancellationToken.None);
    }

    private async Task<int> RangeCountAsync(Guid user)
    {
        await using var scope = Scope();
        var handler = new GetVoiceDiaryByRangeHandler(NewStore(scope));
        var result = await handler.HandleAsync(new GetVoiceDiaryByRangeQuery(
            user, DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-2)), DateOnly.FromDateTime(DateTime.UtcNow.AddDays(2))));
        result.IsSuccess.Should().BeTrue();
        return result.Value!.Clips.Count;
    }

    private S3RetainedBlobStore NewStore(AsyncServiceScope scope) => new(
        _s3,
        Options.Create(new RetainedBlobStoreOptions { BucketName = "test-retained" }),
        scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>());

    private AsyncServiceScope Scope()
    {
        // user_consent_state / consent_audit / voice_clips_retained are RLS-exempt
        // (user-keyed). Admin-cross-tenant scope is the documented escape for
        // work done outside the HTTP middleware.
        var scope = _root!.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    private async Task<long> ScalarAsync(string sql)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    // ── the proofs ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_clip_recorded_in_a_revoked_gap_is_refused_after_the_regrant_and_nothing_is_stored()
    {
        SkipIfPostgresUnavailable();
        await GrantAsync(UserA, true);
        await Task.Delay(30);
        await GrantAsync(UserA, false);
        await Task.Delay(30);
        var recordedInGap = DateTime.UtcNow; // consent is OFF at this instant
        await Task.Delay(30);
        await GrantAsync(UserA, true);       // possibly from another device; the server only sees the ledger

        var refused = await PersistAsync(UserA, ClipA1, SealedBytes, recordedInGap);

        refused.IsSuccess.Should().BeFalse("consent covers recordings made while it was granted");
        refused.Error.Code.Should().Be(ShramSafalErrors.RecordedBeforeConsent.Code);
        (await ScalarAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(0);
        _s3.PutCount.Should().Be(0);

        // A clip recorded after the regrant is accepted as before.
        (await PersistAsync(UserA, ClipA2, SealedBytes, DateTime.UtcNow.AddSeconds(1))).IsSuccess.Should().BeTrue();
    }

    [SkippableFact]
    public async Task The_application_role_is_not_a_superuser()
    {
        SkipIfPostgresUnavailable();
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        ((bool)(await cmd.ExecuteScalarAsync())!).Should().BeFalse(
            "these proofs are only meaningful as the role production runs as");
    }

    [SkippableFact]
    public async Task Ack_is_real_row_and_sealed_object_exist_and_the_server_holds_exactly_what_was_sent()
    {
        SkipIfPostgresUnavailable();
        await GrantAsync(UserA, true);

        var result = await PersistAsync(UserA, ClipA1, SealedBytes);

        result.IsSuccess.Should().BeTrue();
        result.Value!.ClipId.Should().Be(ClipA1, "the echoed id IS the acknowledgement");
        (await ScalarAsync($"SELECT count(*) FROM ssf.voice_clips_retained WHERE clip_id = '{ClipA1}' AND user_id = '{UserA}'"))
            .Should().Be(1);
        _s3.Objects.Should().ContainKey($"retained/{UserA:D}/{ClipA1:D}.bin");
        _s3.Objects[$"retained/{UserA:D}/{ClipA1:D}.bin"].Should().Equal(SealedBytes,
            "the server stores the ciphertext it was given, byte for byte");
        (await ScalarAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'VoiceClipRetained' AND action = 'Persisted'"))
            .Should().Be(1);

        var back = await GetByIdAsync(UserA, ClipA1);
        back.Should().NotBeNull();
        back!.CipherBytes.Should().Equal(SealedBytes);
    }

    [SkippableFact]
    public async Task A_retry_by_the_owner_is_idempotent_one_row_one_object()
    {
        SkipIfPostgresUnavailable();
        await GrantAsync(UserA, true);

        (await PersistAsync(UserA, ClipA1, SealedBytes)).IsSuccess.Should().BeTrue();
        var retry = await PersistAsync(UserA, ClipA1, SealedBytes);

        retry.IsSuccess.Should().BeTrue("the phone retrying after a dropped reply must still get its acknowledgement");
        retry.Value!.ClipId.Should().Be(ClipA1);
        (await ScalarAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(1);
        _s3.PutCount.Should().Be(1, "the second POST must not write the object again");
    }

    [SkippableFact]
    public async Task Another_account_presenting_the_same_clip_id_is_REFUSED_not_acknowledged()
    {
        SkipIfPostgresUnavailable();
        await GrantAsync(UserA, true);
        await GrantAsync(UserB, true);
        (await PersistAsync(UserA, ClipA1, SealedBytes)).IsSuccess.Should().BeTrue();

        var hostile = await PersistAsync(UserB, ClipA1, OtherBytes);

        hostile.IsSuccess.Should().BeFalse(
            "answering success would tell B's phone a recording is saved when the server holds A's row, not B's");
        hostile.Error.Code.Should().Be(ShramSafalErrors.RetainedClipIdTaken.Code);
        // A's recording is untouched: same owner, same bytes, nothing overwritten.
        (await ScalarAsync($"SELECT count(*) FROM ssf.voice_clips_retained WHERE clip_id = '{ClipA1}' AND user_id = '{UserA}'"))
            .Should().Be(1);
        (await ScalarAsync($"SELECT count(*) FROM ssf.voice_clips_retained WHERE user_id = '{UserB}'")).Should().Be(0);
        _s3.Objects[$"retained/{UserA:D}/{ClipA1:D}.bin"].Should().Equal(SealedBytes);
        _s3.Objects.Keys.Should().NotContain(k => k.Contains(UserB.ToString("D")));
        (await ScalarAsync($"SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'VoiceClipRetained' AND actor_user_id = '{UserB}'"))
            .Should().Be(0, "a refused persist is not audited as a persisted clip");
    }

    [SkippableFact]
    public async Task Tenant_isolation_another_account_cannot_read_or_list_the_clip()
    {
        SkipIfPostgresUnavailable();
        await GrantAsync(UserA, true);
        await GrantAsync(UserB, true);
        (await PersistAsync(UserA, ClipA1, SealedBytes)).IsSuccess.Should().BeTrue();
        (await PersistAsync(UserB, ClipA2, OtherBytes)).IsSuccess.Should().BeTrue();

        (await GetByIdAsync(UserB, ClipA1)).Should().BeNull("by-id conflates not-found and not-yours");
        (await GetByIdAsync(UserA, ClipA2)).Should().BeNull();
        (await RangeCountAsync(UserA)).Should().Be(1);
        (await RangeCountAsync(UserB)).Should().Be(1);
        (await GetByIdAsync(UserA, ClipA1))!.CipherBytes.Should().Equal(SealedBytes);
        (await GetByIdAsync(UserB, ClipA2))!.CipherBytes.Should().Equal(OtherBytes);
    }

    [SkippableFact]
    public async Task Declined_or_revoked_consent_stores_nothing_and_acknowledges_nothing_and_never_removes_what_was_saved()
    {
        SkipIfPostgresUnavailable();

        // Never granted.
        var declined = await PersistAsync(UserA, ClipA1, SealedBytes);
        declined.IsSuccess.Should().BeFalse();
        declined.Error.Code.Should().Be(ShramSafalErrors.ConsentRequired.Code);
        (await ScalarAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(0);
        _s3.Objects.Should().BeEmpty();

        // Granted, saved, then revoked: stop FUTURE saving only (D9 / ADR-DS-017).
        await GrantAsync(UserA, true);
        (await PersistAsync(UserA, ClipA1, SealedBytes)).IsSuccess.Should().BeTrue();
        await GrantAsync(UserA, false);
        var afterRevoke = await PersistAsync(UserA, ClipA2, OtherBytes);
        afterRevoke.IsSuccess.Should().BeFalse();
        afterRevoke.Error.Code.Should().Be(ShramSafalErrors.ConsentRequired.Code);

        (await ScalarAsync("SELECT count(*) FROM ssf.voice_clips_retained")).Should().Be(1,
            "the already-saved clip stays; the revoked one was never stored");
        (await GetByIdAsync(UserA, ClipA1))!.CipherBytes.Should().Equal(SealedBytes,
            "revoking consent never deletes a saved recording");
        _s3.DeleteCount.Should().Be(0, "nothing in the persist / read / revoke path deletes an object");
    }

    // ── doubles ──────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>S3 over a dictionary. Counts puts and deletes so tests can assert on them.</summary>
    private sealed class InMemoryS3 : AmazonS3Client
    {
        public Dictionary<string, byte[]> Objects { get; } = new();
        public int PutCount { get; private set; }
        public int DeleteCount { get; private set; }

        public InMemoryS3()
            : base("no-access-key", "no-secret-key", new AmazonS3Config
            {
                ServiceURL = "http://127.0.0.1:1",
                ForcePathStyle = true,
                MaxErrorRetry = 0,
            })
        {
        }

        private static AmazonS3Exception NotFound() =>
            new("not found", ErrorType.Sender, "NoSuchKey", "req-1", HttpStatusCode.NotFound);

        public override Task<GetObjectMetadataResponse> GetObjectMetadataAsync(
            string bucketName, string key, CancellationToken cancellationToken = default)
            => Objects.ContainsKey(key)
                ? Task.FromResult(new GetObjectMetadataResponse())
                : throw NotFound();

        public override async Task<PutObjectResponse> PutObjectAsync(
            PutObjectRequest request, CancellationToken cancellationToken = default)
        {
            using var ms = new MemoryStream();
            await request.InputStream.CopyToAsync(ms, cancellationToken);
            Objects[request.Key] = ms.ToArray();
            PutCount++;
            return new PutObjectResponse();
        }

        public override Task<GetObjectResponse> GetObjectAsync(
            string bucketName, string key, CancellationToken cancellationToken = default)
            => Objects.TryGetValue(key, out var bytes)
                ? Task.FromResult(new GetObjectResponse { ResponseStream = new MemoryStream(bytes) })
                : throw NotFound();

        public override Task<DeleteObjectResponse> DeleteObjectAsync(
            string bucketName, string key, CancellationToken cancellationToken = default)
        {
            DeleteCount++;
            Objects.Remove(key);
            return Task.FromResult(new DeleteObjectResponse());
        }
    }
}
