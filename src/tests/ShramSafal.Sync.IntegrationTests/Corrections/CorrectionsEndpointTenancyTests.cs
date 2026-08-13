// spec: dfes-companion-2026-07-11 — POST /shramsafal/corrections tenant-scope fix.
//
// Live founder testing (2026-07-19 09:46) hit:
//   Microsoft.EntityFrameworkCore.DbUpdateException
//    ---> System.InvalidOperationException: TenantConnectionInterceptor: no
//         tenant claim set and not in admin scope.
// on POST /shramsafal/corrections.
//
// CorrectionEvent has NO farm dimension: `ssf.correction_events` has no
// farm_id column, and RecordCorrectionEventHandler takes only UserId +
// OriginalParseId. So this is NOT the DFES engagement/day-understanding/
// question-events shape (ICallerFarmTenantScope.EstablishForCallerAsync,
// which validates MEMBERSHIP of a caller-suppliable farmId — there is no
// farmId here to resolve).
//
// It is ALSO not the /shramsafal/consent or /shramsafal/voice-diary shape
// (admin-elevated via TenantTransactionMiddleware's SkipPathPrefixes): THOSE
// tables (ssf.user_consents, ssf.voice_clips_retained) carry no RLS at all.
// ssf.correction_events is different — it DOES carry RLS, added later to
// resolve an explicit OQ-9 deferral (20260516130000_EnableRowLevelSecurity §
// 74-84 deferred it; 20260517010000_AddDeferredAuditRls resolved it):
//   CREATE POLICY p_user_correction_events ON ssf.correction_events
//     USING/WITH CHECK (user_id = current_setting('agrisync.user_id', true)::uuid);
// Admin elevation sets NO GUC at all, so it would make the INSERT violate
// that WITH CHECK (confirmed live: 42501 "new row violates row-level
// security policy" — an earlier attempt at this fix hit exactly that).
//
// The correct fix (ICallerUserTenantScope.EstablishForCallerAsync, wired into
// CorrectionsEndpoints) is a THIRD shape: user-scoped (not farm-scoped, like
// ICallerFarmTenantScope) AND not the automatic TenantContext.SetUserScoped +
// interceptor-prepend mechanism GET /sync/pull uses either — that prepends
// `SET LOCAL agrisync.user_id = '...'; ` onto the SAME DbCommand as the
// query, which is fine for a SELECT but desyncs EF's rows-affected parsing
// for an INSERT (reference_interceptor_setlocal_desyncs_ef_writes — confirmed
// live: DbUpdateConcurrencyException "expected to affect 1 row(s), but
// actually affected 0 row(s)"). ICallerUserTenantScope instead reuses
// ICallerFarmTenantScope's proven WRITE-safe technique — admin-elevate (so
// the interceptor no-ops) then set the GUC via a SEPARATE preceding command —
// scaled down to user_id only, with no membership-gate read (the scope
// established is always the caller's own validated JWT subject, never a
// caller-suppliable id, so there is nothing to authorize a membership check
// against).
//
// This suite proves the fix over the REAL production pipeline (TestServer +
// TenantTransactionMiddleware + real Npgsql TenantConnectionInterceptor +
// real FORCE-RLS).
//
// [Trait("Category","RequiresPostgres")] — same convention as
// DfesEndpointsTenancyTests: runs on native Postgres :5433 (Docker-free),
// INCLUDED in the CI merge-gate filter, self-skips cleanly when :5433 is
// unreachable.

using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
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
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Corrections;

[Trait("Category", "RequiresPostgres")]
public sealed class CorrectionsEndpointTenancyTests : IClassFixture<CorrectionsEndpointTenancyFixture>
{
    private readonly CorrectionsEndpointTenancyFixture _fx;
    public CorrectionsEndpointTenancyTests(CorrectionsEndpointTenancyFixture fx) => _fx = fx;

    // ── Criterion 1 — the exact founder-reproduced 500, PLUS the two masked
    //    bugs the fix uncovered along the way (a missing snake_case column
    //    mapping in CorrectionEventConfiguration, and the RLS WITH CHECK on
    //    ssf.correction_events). Before the fix, the handler's first DbCommand
    //    fails closed in TenantConnectionInterceptor. After the fix
    //    (CorrectionsEndpoints calls ICallerUserTenantScope.EstablishForCallerAsync
    //    before invoking the handler), the write must actually land. ───────────
    [Fact]
    public async Task Authenticated_caller_can_record_a_correction_and_it_lands_under_their_own_user_id()
    {
        if (_fx.Skip) { Assert.True(true, _fx.SkipReason); return; }

        var originalParseId = Guid.NewGuid();
        using var resp = await PostAsync(CorrectionsEndpointTenancyFixture.UserA, CorrectionBody(originalParseId));

        resp.StatusCode.Should().Be(HttpStatusCode.Created,
            "the caller's own correction write must succeed once the endpoint establishes the user-scoped " +
            "agrisync.user_id GUC (ICallerUserTenantScope) before the handler's first DbCommand, instead of " +
            "fail-closing in TenantConnectionInterceptor");

        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        var correctionId = doc.RootElement.GetGuid();
        correctionId.Should().NotBe(Guid.Empty);

        // Load-bearing readback (as superuser, RLS-bypassed — ground truth) —
        // proves the row is DURABLE and scoped to the caller's OWN validated
        // userId, not a client-supplied one (the request body carries no
        // userId field at all; RecordCorrectionEventCommand.UserId comes only
        // from EndpointActorContext.TryGetUserId on the validated JWT).
        (await _fx.CountCorrectionEventAsync(correctionId, CorrectionsEndpointTenancyFixture.UserA, originalParseId))
            .Should().Be(1, "the POSTed correction must land in ssf.correction_events under the caller's own user_id");
    }

    // ── Criterion 2 (security-regression guard) — an unauthenticated caller
    //    (no valid identity token) is rejected before the handler runs, and
    //    the fix must not weaken this: admin-elevating the ROUTE never
    //    bypasses `.RequireAuthorization()` on the /shramsafal group, and the
    //    endpoint's own EndpointActorContext.TryGetUserId 401-guard is
    //    untouched by this change. Nothing is ever written for a caller whose
    //    identity was never established — the only identity dimension this
    //    user-scoped (farm-less) table has. ──────────────────────────────────
    [Fact]
    public async Task Unauthenticated_caller_is_rejected_and_writes_nothing()
    {
        if (_fx.Skip) { Assert.True(true, _fx.SkipReason); return; }

        var originalParseId = Guid.NewGuid();
        using var req = new HttpRequestMessage(HttpMethod.Post, "/shramsafal/corrections")
        {
            Content = JsonContent.Create(CorrectionBody(originalParseId)),
        };
        // Deliberately NO X-Test-UserId header — the test auth handler fails
        // authentication, so RequireAuthorization on the /shramsafal group
        // must short-circuit to 401 before any DbCommand runs.
        using var resp = await _fx.Client.SendAsync(req);

        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized,
            "an unidentified caller must never reach the handler — the security posture must not regress");

        (await _fx.CountCorrectionEventsByParseIdAsync(originalParseId))
            .Should().Be(0, "an unauthenticated POST must write nothing to ssf.correction_events");
    }

    private async Task<HttpResponseMessage> PostAsync(Guid userId, object body)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/shramsafal/corrections")
        {
            Content = JsonContent.Create(body),
        };
        req.Headers.Add("X-Test-UserId", userId.ToString());
        return await _fx.Client.SendAsync(req);
    }

    private static object CorrectionBody(Guid originalParseId) => new
    {
        originalParseId,
        originalParseRaw = """{"note":"original"}""",
        correctedParse = """{"note":"corrected"}""",
        promptVersion = "v1",
        locale = "mr-IN",
        // CorrectionTrigger has no JsonStringEnumConverter registered, so the
        // wire format is the numeric ordinal: EditUI = 0.
        trigger = 0,
    };
}

/// <summary>
/// Real-Postgres fixture for the corrections-endpoint tenancy proof — same
/// scratch-DB-per-run shape as <c>DfesEndpointsTenancyFixture</c>, but with NO
/// farm/membership seeding: <c>ssf.correction_events</c> is user-scoped only.
/// </summary>
public sealed class CorrectionsEndpointTenancyFixture : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    public static readonly Guid UserA = Guid.Parse("c0eec001-0000-0000-0000-000000000001");

    private WebApplication? _app;
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _rootConn = string.Empty;

    public HttpClient Client { get; private set; } = default!;
    public bool Skip { get; private set; }
    public string SkipReason { get; private set; } = string.Empty;

    public async Task InitializeAsync()
    {
        _rootConn = IntegrationPostgres.ResolveRootConnection();

        // A genuinely ABSENT server self-skips; a server that answers and refuses us
        // throws (IntegrationPostgres.ProbeOrSkipReasonAsync) — a misconfigured
        // credential must never masquerade as a clean skip.
        var skipReason = await IntegrationPostgres.ProbeOrSkipReasonAsync(_rootConn);
        if (skipReason is not null)
        {
            Skip = true;
            SkipReason = skipReason;
            return;
        }

        _scratchDbName = $"ssf_corrections_tenancy_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        var appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        // Full chain — creates agrisync_app + ssf.correction_events (no RLS on
        // this table; it is user-scoped, not farm-scoped).
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _app = await BuildHostAsync(appConn);
        Client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            Client?.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (!Skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_rootConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_rootConn);
                await admin.OpenAsync();
                await using (var terminate = admin.CreateCommand())
                {
                    terminate.CommandText =
                        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                    terminate.Parameters.AddWithValue("db", _scratchDbName);
                    await terminate.ExecuteNonQueryAsync();
                }
                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; a leaked scratch DB is harmless.
            }
        }
    }

    public async Task<long> CountCorrectionEventAsync(Guid id, Guid userId, Guid originalParseId)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText =
            "SELECT COUNT(*) FROM ssf.correction_events WHERE \"Id\" = @id AND user_id = @user AND original_parse_id = @parse";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("parse", originalParseId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<long> CountCorrectionEventsByParseIdAsync(Guid originalParseId)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*) FROM ssf.correction_events WHERE original_parse_id = @parse";
        cmd.Parameters.AddWithValue("parse", originalParseId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-corrections-tenancy", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, CorrectionsTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"corrections-tenancy-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph — registers the Npgsql ShramSafalDbContext
        // WITH the TenantConnectionInterceptor and the ITenantScopedDbContextRegistry
        // the middleware opens a tx on. Not swapped for InMemory: the whole point is
        // real Npgsql + the real interceptor that produced the founder's 500.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // The production tenant-transaction middleware (matches Program.cs order:
        // UseAuthentication → UseAuthorization → TenantTransactionMiddleware).
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

}

/// <summary>
/// Test auth scheme: turns the X-Test-UserId header into a JWT "sub" claim —
/// mirrors ShramSafal.Sync.IntegrationTests.Dfes.DfesTestAuthHandler exactly
/// (kept local rather than shared so this suite has no cross-file coupling to
/// the Dfes fixture).
/// </summary>
internal sealed class CorrectionsTestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-UserId", out var raw)
            || !Guid.TryParse(raw.ToString(), out var userId))
        {
            return Task.FromResult(AuthenticateResult.Fail("missing X-Test-UserId"));
        }

        var id = userId.ToString();
        var claims = new[]
        {
            new Claim("sub", id),
            new Claim(ClaimTypes.NameIdentifier, id),
            new Claim("membership", "shramsafal:PrimaryOwner"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        var ticket = new AuthenticationTicket(principal, Scheme.Name);
        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
