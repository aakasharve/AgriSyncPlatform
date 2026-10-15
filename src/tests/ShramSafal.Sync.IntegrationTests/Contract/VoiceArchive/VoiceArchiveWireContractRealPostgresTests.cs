// spec: 2026-08-25-prod-cutover-waves (voice archive path, defect D2)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth.Jwt;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Security;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Infrastructure.Privacy;
using User.Application.Ports;
using User.Infrastructure;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Contract.VoiceArchive;

/// <summary>
/// <b>D2 - the voice-archive wire contract, client bytes against the real server.</b>
///
/// <para>Every <c>POST /shramsafal/voice-diary/persist</c> answered 500 on the real
/// AWS-backed run: the client's clip id was a 64-hex string, the server's
/// <c>PersistVoiceDiaryRequest.ClipId</c> is a <c>Guid</c>. Every earlier test seamed over
/// it - the TS suites mocked the API, the C# suites called the handlers with a Guid - so
/// nothing ever put the CLIENT'S bytes through the SERVER'S binder.</para>
///
/// <para>This suite takes the JSON file that the real TypeScript client code path produced
/// (<c>persist-request.json</c>, pinned and drift-checked by the vitest
/// <c>voiceArchive.wireContract.test.ts</c>) and POSTs those exact bytes through the real
/// ASP.NET pipeline: real JWT (<see cref="IJwtTokenService"/>), real JwtBearer scheme, real
/// <c>TenantTransactionMiddleware</c>, real Npgsql context as the non-superuser
/// <c>agrisync_app</c>, real <see cref="S3RetainedBlobStore"/> over an in-memory S3, real
/// consent enforcer reached through the real <c>PUT /consent/me</c>. The only substitutes
/// are the S3 wire and the KMS (not used by these routes at all).</para>
///
/// <para>Also pinned: the server's response key sets against <c>responses.json</c>, which
/// the vitest suite validates with the client's own zod schemas - so the contract is checked
/// in BOTH directions and a one-sided change cannot pass CI.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class VoiceArchiveWireContractRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid Owner = Guid.Parse("d2000001-0000-0000-0000-0000000000a1");
    private static readonly Guid Other = Guid.Parse("d2000001-0000-0000-0000-0000000000a2");
    private const string JwtSigningKey = "d2-test-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz";
    private const string OldLocalHexId = "a3f5c9d17b2e48a0916c5d3e2f1a0b7c8d9e4f5a6b7c8d9e0f1a2b3c4d5e6f70";

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;
    private readonly InMemoryS3 _s3 = new();

    private string _requestJson = string.Empty;
    private JsonElement _request;
    private JsonElement _responses;

    public async Task InitializeAsync()
    {
        var dir = Path.Combine(AppContext.BaseDirectory, "Contract", "VoiceArchive");
        _requestJson = await File.ReadAllTextAsync(Path.Combine(dir, "persist-request.json"));
        _request = JsonDocument.Parse(_requestJson).RootElement.Clone();
        _responses = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(dir, "responses.json"))).RootElement.Clone();

        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_voicewire_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = TestRoleCredentials.AppRoleUser,
            Password = TestRoleCredentials.AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
        _app = await BuildHostAsync(_appConn, _s3);
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        _s3.Dispose();
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    private Guid FixtureClipId => Guid.Parse(_request.GetProperty("clipId").GetString()!);

    [Fact]
    public async Task The_host_connects_as_a_role_that_is_neither_superuser_nor_bypassrls()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    [Fact]
    public void The_fixture_is_what_the_client_really_sends_a_guid_clip_id_and_a_kms_sized_dek_id()
    {
        // Guards the guard: the fixture must exercise the two things that broke or would break.
        Guid.TryParse(_request.GetProperty("clipId").GetString(), out var id).Should().BeTrue();
        id.Should().NotBe(Guid.Empty);
        _request.GetProperty("clipId").GetString().Should().Be(id.ToString("D"), "lower-case canonical, as ASP.NET writes a Guid");
        _request.GetProperty("dekId").GetString()!.Length.Should().BeGreaterThan(128,
            "a real KMS-wrapped DEK id is ~248 chars; the column used to be varchar(128)");
        _request.GetProperty("language").GetString().Should().BeOneOf("mr-IN", "en-IN");
    }

    [Fact]
    public async Task The_exact_client_body_persists_stores_the_ciphertext_and_reads_back_by_range_and_by_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantConsentAsync(Owner);

        using var persisted = await PostPersistAsync(Owner, _requestJson);
        var body = await persisted.Content.ReadAsStringAsync();
        persisted.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var ack = JsonDocument.Parse(body);
        ack.RootElement.GetProperty("clipId").GetGuid().Should().Be(FixtureClipId, "the ack the client trusts is the server echoing THAT Guid");
        SameShape(ack.RootElement, _responses.GetProperty("persist"));

        // Row stored for the owner, with every field the client sent.
        var row = await ReadRowAsync(FixtureClipId);
        row.Should().NotBeNull();
        row!.UserId.Should().Be(Owner);
        row.S3Key.Should().Be($"retained/{Owner:D}/{FixtureClipId:D}.bin");
        row.DekId.Should().Be(_request.GetProperty("dekId").GetString());
        row.Iv.Should().Be(_request.GetProperty("ivBase64").GetString());
        row.Tag.Should().Be(_request.GetProperty("authTagBase64").GetString());
        row.Duration.Should().Be(_request.GetProperty("durationSeconds").GetInt32());
        row.Language.Should().Be(_request.GetProperty("language").GetString());
        row.RecordedAtUtc.Should().Be(DateTime.Parse(_request.GetProperty("recordedAtUtc").GetString()!, null, System.Globalization.DateTimeStyles.AdjustToUniversal));

        // Object stored: exactly the sealed bytes the phone sent - ciphertext, never the audio.
        var cipher = Convert.FromBase64String(_request.GetProperty("cipherBase64").GetString()!);
        _s3.PutCount.Should().Be(1);
        _s3.Objects.Should().ContainKey(row.S3Key);
        _s3.Objects[row.S3Key].Should().Equal(cipher);
        var plaintext = Enumerable.Range(0, 96).Select(i => (byte)((i * 5 + 1) & 0xff)).ToArray();
        _s3.Objects[row.S3Key].Should().NotEqual(plaintext, "the server holds ciphertext, not audio");

        // GET by-range lists it under the same Guid.
        using var range = await SendAsync(HttpMethod.Get, "/shramsafal/voice-diary/by-range?from=2026-10-10&to=2026-10-10", Owner);
        var rangeBody = await range.Content.ReadAsStringAsync();
        range.StatusCode.Should().Be(HttpStatusCode.OK, rangeBody);
        using var rangeDoc = JsonDocument.Parse(rangeBody);
        var clips = rangeDoc.RootElement.GetProperty("clips").EnumerateArray().ToList();
        clips.Should().HaveCount(1);
        clips[0].GetProperty("clipId").GetGuid().Should().Be(FixtureClipId);
        SameShape(rangeDoc.RootElement, _responses.GetProperty("byRange"));

        // GET by-id returns it, same Guid, same envelope, same bytes.
        using var byId = await SendAsync(HttpMethod.Get, $"/shramsafal/voice-diary/by-id/{FixtureClipId}", Owner);
        var byIdBody = await byId.Content.ReadAsStringAsync();
        byId.StatusCode.Should().Be(HttpStatusCode.OK, byIdBody);
        using var byIdDoc = JsonDocument.Parse(byIdBody);
        var r = byIdDoc.RootElement;
        r.GetProperty("clipId").GetGuid().Should().Be(FixtureClipId);
        r.GetProperty("cipherBase64").GetString().Should().Be(_request.GetProperty("cipherBase64").GetString());
        r.GetProperty("ivBase64").GetString().Should().Be(_request.GetProperty("ivBase64").GetString());
        r.GetProperty("authTagBase64").GetString().Should().Be(_request.GetProperty("authTagBase64").GetString());
        r.GetProperty("dekId").GetString().Should().Be(_request.GetProperty("dekId").GetString());
        r.GetProperty("durationSeconds").GetInt32().Should().Be(4);
        SameShape(r, _responses.GetProperty("byId"));
    }

    [Fact]
    public async Task The_owner_retrying_the_same_body_is_idempotent_and_writes_nothing_twice()
    {
        await GrantConsentAsync(Owner);
        using var first = await PostPersistAsync(Owner, _requestJson);
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        using var retry = await PostPersistAsync(Owner, _requestJson);
        var body = await retry.Content.ReadAsStringAsync();
        retry.StatusCode.Should().Be(HttpStatusCode.OK, body);
        JsonDocument.Parse(body).RootElement.GetProperty("clipId").GetGuid().Should().Be(FixtureClipId);

        (await CountRowsAsync()).Should().Be(1);
        _s3.PutCount.Should().Be(1, "a retry after a dropped reply must not write the object again");
    }

    [Fact]
    public async Task Another_account_presenting_the_same_clip_id_is_refused_409_and_cannot_read_or_list_it()
    {
        await GrantConsentAsync(Owner);
        await GrantConsentAsync(Other);
        using var first = await PostPersistAsync(Owner, _requestJson);
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        using var stolen = await PostPersistAsync(Other, _requestJson);
        var body = await stolen.Content.ReadAsStringAsync();
        stolen.StatusCode.Should().Be(HttpStatusCode.Conflict, body);
        body.Should().Contain("RetainedClipIdTaken");

        (await ReadRowAsync(FixtureClipId))!.UserId.Should().Be(Owner, "the owner's row is untouched");
        _s3.PutCount.Should().Be(1);

        using var byId = await SendAsync(HttpMethod.Get, $"/shramsafal/voice-diary/by-id/{FixtureClipId}", Other);
        byId.StatusCode.Should().Be(HttpStatusCode.NotFound);
        using var range = await SendAsync(HttpMethod.Get, "/shramsafal/voice-diary/by-range?from=2026-10-01&to=2026-10-31", Other);
        JsonDocument.Parse(await range.Content.ReadAsStringAsync()).RootElement.GetProperty("clips").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Without_consent_nothing_is_stored_and_nothing_is_acknowledged()
    {
        using var refused = await PostPersistAsync(Owner, _requestJson);
        var body = await refused.Content.ReadAsStringAsync();
        refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, body);
        body.Should().Contain("ConsentRequired");
        (await CountRowsAsync()).Should().Be(0);
        _s3.PutCount.Should().Be(0);
    }

    [Fact]
    public async Task The_pre_fix_body_with_the_raw_64_hex_local_id_never_succeeds_and_stores_nothing()
    {
        await GrantConsentAsync(Owner);
        var oldBody = _requestJson.Replace(_request.GetProperty("clipId").GetString()!, OldLocalHexId);
        oldBody.Should().Contain(OldLocalHexId);

        HttpStatusCode? status = null;
        try
        {
            using var response = await PostPersistAsync(Owner, oldBody);
            status = response.StatusCode;
            output.WriteLine($"old hex clipId body -> HTTP {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        }
        catch (Exception ex)
        {
            // Under an exception-throwing host the binder FormatException surfaces here; either way: not stored.
            output.WriteLine($"old hex clipId body -> exception {ex.GetType().Name}: {ex.Message} / inner: {ex.InnerException?.GetType().Name}: {ex.InnerException?.Message}");
        }

        status.Should().NotBe(HttpStatusCode.OK, "a non-Guid clip id cannot bind to PersistVoiceDiaryRequest.ClipId (the D2 failure)");
        (await CountRowsAsync()).Should().Be(0);
        _s3.PutCount.Should().Be(0);

        // And the by-id route has a :guid constraint: a hex id could never be fetched.
        using var byHex = await SendAsync(HttpMethod.Get, $"/shramsafal/voice-diary/by-id/{OldLocalHexId}", Owner);
        byHex.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Theory]
    [InlineData("dekId", 513)]
    [InlineData("ivBase64", 65)]
    [InlineData("authTagBase64", 65)]
    [InlineData("language", 17)]
    public async Task A_field_longer_than_its_column_is_a_400_never_a_500_and_leaves_no_object_behind(string field, int length)
    {
        await GrantConsentAsync(Owner);
        var obj = JsonSerializer.Deserialize<Dictionary<string, object?>>(_requestJson)!;
        obj[field] = new string('A', length);

        using var response = await PostPersistAsync(Owner, JsonSerializer.Serialize(obj));
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.BadRequest, body);
        (await CountRowsAsync()).Should().Be(0);
        _s3.PutCount.Should().Be(0, "validation runs before the S3 write");
    }

    [Fact]
    public async Task A_dek_id_at_the_new_limit_persists()
    {
        await GrantConsentAsync(Owner);
        var obj = JsonSerializer.Deserialize<Dictionary<string, object?>>(_requestJson)!;
        obj["dekId"] = new string('B', 512);
        using var response = await PostPersistAsync(Owner, JsonSerializer.Serialize(obj));
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        (await ReadRowAsync(FixtureClipId))!.DekId.Length.Should().Be(512);
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401()
    {
        using var response = await PostPersistAsync(null, _requestJson);
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // -- helpers ---------------------------------------------------------------

    /// <summary>Same property names and same JSON value kinds as the shared sample.</summary>
    private static void SameShape(JsonElement actual, JsonElement sample)
    {
        actual.ValueKind.Should().Be(sample.ValueKind);
        if (sample.ValueKind == JsonValueKind.Object)
        {
            actual.EnumerateObject().Select(p => p.Name).OrderBy(n => n)
                .Should().Equal(sample.EnumerateObject().Select(p => p.Name).OrderBy(n => n));
            foreach (var p in sample.EnumerateObject())
            {
                SameShape(actual.GetProperty(p.Name), p.Value);
            }
        }
        else if (sample.ValueKind == JsonValueKind.Array && sample.GetArrayLength() > 0)
        {
            actual.GetArrayLength().Should().BeGreaterThan(0);
            SameShape(actual[0], sample[0]);
        }
    }

    private Task<HttpResponseMessage> PostPersistAsync(Guid? user, string json)
        => SendAsync(HttpMethod.Post, "/shramsafal/voice-diary/persist", user,
            new StringContent(json, Encoding.UTF8, "application/json"));

    private async Task GrantConsentAsync(Guid user)
    {
        using var put = await SendAsync(HttpMethod.Put, "/shramsafal/consent/me", user,
            new StringContent(
                """{"fullHistoryJournal":true,"languageShown":"mr-IN","consentTextVersion":1}""",
                Encoding.UTF8, "application/json"));
        put.StatusCode.Should().Be(HttpStatusCode.OK, await put.Content.ReadAsStringAsync());

        // The fixture clip was recorded on 2026-10-10; consent covers recordings made while it was
        // granted, so the grant is dated before it (as it would be for a clip a farmer really made).
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, "UPDATE ssf.consent_audit SET occurred_at_utc = '2026-01-01T00:00:00Z' WHERE user_id = @u",
            ("u", user));
    }

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid? userId, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url) { Content = content };
        if (userId is { } id)
        {
            var tokens = _app!.Services.GetRequiredService<IJwtTokenService>().GenerateIdentityTokens(id, phoneVerified: true);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        }

        return await _client.SendAsync(request);
    }

    private sealed record Row(Guid UserId, string S3Key, string DekId, string Iv, string Tag, int Duration, string Language, DateTime RecordedAtUtc);

    private async Task<Row?> ReadRowAsync(Guid clipId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT user_id, s3_key, dek_id, iv_b64, auth_tag_b64, duration_seconds, language, recorded_at_utc FROM ssf.voice_clips_retained WHERE clip_id = @c";
        cmd.Parameters.AddWithValue("c", clipId);
        await using var r = await cmd.ExecuteReaderAsync();
        return await r.ReadAsync()
            ? new Row(r.GetGuid(0), r.GetString(1), r.GetString(2), r.GetString(3), r.GetString(4), r.GetInt32(5), r.GetString(6), r.GetDateTime(7).ToUniversalTime())
            : null;
    }

    private async Task<long> CountRowsAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.voice_clips_retained";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(await cmd.ExecuteScalarAsync()).Should().BeFalse(
            "doctrine E3 - a proof executed as a superuser or BYPASSRLS role proves nothing");
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

    private static async Task<WebApplication> BuildHostAsync(string appConn, InMemoryS3 s3)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = Path.Combine(Path.GetTempPath(), "agrisync-voicewire", Guid.NewGuid().ToString("N")),
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            ["Jwt:SigningKey"] = JwtSigningKey,
            ["Jwt:AccessTokenMinutes"] = "15",
        });

        builder.Services.AddJwtTokenValidation(builder.Configuration);
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"voicewire-analytics-{Guid.NewGuid()}"));
        builder.Services.AddUserInfrastructure(builder.Configuration);
        builder.Services.AddShramSafalApi(builder.Configuration);

        // Exactly what Program.cs adds for the retained tier, with the S3 wire swapped for memory.
        builder.Services.AddSingleton(Options.Create(new RetainedBlobStoreOptions { BucketName = "test-retained" }));
        builder.Services.AddSingleton<IAmazonS3>(s3);
        builder.Services.AddScoped<IRetainedBlobStore, S3RetainedBlobStore>();

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    /// <summary>S3 over a dictionary. Counts puts so a test can prove a refusal wrote nothing.</summary>
    private sealed class InMemoryS3 : AmazonS3Client
    {
        public Dictionary<string, byte[]> Objects { get; } = new();
        public int PutCount { get; private set; }

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
    }
}
