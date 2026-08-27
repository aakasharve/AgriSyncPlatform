// spec: 2026-08-25-prod-cutover-waves (B1) — POST /shramsafal/consent-gate/link, proved
// end-to-end over the REAL pipeline instead of over a fake.
//
// WHY THIS FILE HAD TO EXIST. Every layer of this endpoint was green and the endpoint was
// dead. LinkConsentGateToUserHandlerTests drives a fake repository, which evaluates no RLS
// policy and runs no interceptor. ConsentGateLedgerRlsTests talks to real Postgres but sets
// its GUC with set_config(..., false) on a session it owns — deliberately, to AVOID the
// interceptor. TenantTransactionMiddlewareConsentGateTests observes middleware posture with
// no database at all. So the one thing nobody exercised was the combination, and that is
// exactly where the defect lived:
//
//   DbUpdateConcurrencyException: expected to affect 1 row(s), but actually affected 0 row(s)
//     at LinkConsentGateToUserHandler.HandleAsync  (repository.SaveChangesAsync)
//     at ConsentGateEndpoints  (POST /shramsafal/consent-gate/link)
//     at TenantTransactionMiddleware  (the IsConsentGateLinkPath user-scoped branch)
//
// The route had been given TenantTransactionMiddleware's user-scoped mode, which is a READ
// posture: TenantConnectionInterceptor prepends `SET LOCAL agrisync.user_id = '…'; ` onto
// the SAME CommandText as the caller's own statement. Harmless for a SELECT; for an EF
// INSERT batch it desyncs NpgsqlModificationCommandBatch's rows-affected accounting and the
// write dies. The consequence in plain terms: a farmer's Terms/DPDP acceptance could never
// be attached to their account — the precise defect the endpoint exists to fix.
//
// This suite therefore runs the PRODUCTION pipeline: TestServer + the real
// TenantTransactionMiddleware + the real production DI graph (Npgsql ShramSafalDbContext
// WITH TenantConnectionInterceptor) + a real Postgres carrying FORCE-RLS, connected as the
// non-superuser agrisync_app role the API actually uses. Nothing here is stubbed. If the
// posture regresses in either direction — back to the interceptor prepend, or forward to
// bare admin elevation — a proof below fails.
//
// [Trait("Category","RequiresPostgres")] — native :5433, Docker-free, in the CI merge-gate
// filter, self-skipping when the server is genuinely absent. A skip prints [SKIPPED] and
// proves nothing; it does not pass quietly.

using System;
using System.Collections.Generic;
using System.Data.Common;
using System.IO;
using System.Net;
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
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Consent;

[Trait("Category", "RequiresPostgres")]
public sealed class ConsentGateLinkEndpointTenancyTests(
    ConsentGateLinkEndpointFixture fx,
    ITestOutputHelper output) : IClassFixture<ConsentGateLinkEndpointFixture>
{
    private const string TermsLinkedEventType = "TERMS_ACCEPTANCE_LINKED";
    private const string GrantLinkedEventType = "CORE_DPDP_CONSENT_LINKED";

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 0 — E3 GUARD, asserted before anything else and again at the head of
    // every proof below. A role holding rolsuper or rolbypassrls ignores the
    // policies and the REVOKEs outright, so a suite taken through one reports
    // green while proving the opposite of what it claims. A filtered run can
    // also drop a standalone guard, which is why it is not ONLY standalone.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_0_the_role_the_endpoint_writes_as_is_neither_superuser_nor_bypassrls()
    {
        SkipIfPostgresUnavailable();

        var (currentUser, isSuper, bypassesRls) = await fx.ReadRolePowersOfTheHostConnectionAsync();

        currentUser.Should().Be(
            IntegrationPostgres.AppRoleUser,
            "the proofs must run as the role the API actually connects as");
        isSuper.Should().BeFalse(
            "a superuser is exempt from the WITH CHECK these proofs turn on (doctrine E3)");
        bypassesRls.Should().BeFalse(
            "a BYPASSRLS role sidesteps the policy under test, so a proof taken through it is void");

        output.WriteLine(
            $"[EVIDENCE] current_user={currentUser} rolsuper=false rolbypassrls=false");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — THE WRITE ACTUALLY LANDS. The whole point.
    //
    // A 200 alone would not be enough: the handler could report success on rows
    // that never reached disk. So the response is checked AND the two rows are
    // read back as superuser (RLS-bypassed, so this is ground truth rather than
    // a second look through the same policy that could hide a missing row).
    //
    // The user_id on both rows must be the JWT subject. The request body carries
    // no user id field at all — that is structural, not a check — so a row naming
    // the caller is a row the token named.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_1_an_authenticated_link_lands_two_rows_under_the_callers_own_user_id()
    {
        SkipIfPostgresUnavailable();
        await AssertOrdinaryRoleAsync();

        var session = $"sess-{Guid.NewGuid():N}";

        using var resp = await fx.PostLinkAsync(ConsentGateLinkEndpointFixture.FarmerA, session);
        var payload = await resp.Content.ReadAsStringAsync();

        resp.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the linking write must actually succeed over the real interceptor + real RLS; "
            + $"body was: {payload}");

        using var doc = JsonDocument.Parse(payload);
        var termsId = doc.RootElement.GetProperty("termsAcceptanceEventId").GetGuid();
        var grantId = doc.RootElement.GetProperty("consentGrantEventId").GetGuid();
        doc.RootElement.GetProperty("alreadyLinked").GetBoolean().Should().BeFalse(
            "this is the first link for this session, so it was written, not replayed");

        termsId.Should().NotBe(Guid.Empty);
        grantId.Should().NotBe(Guid.Empty);

        // Ground truth. Read as superuser so neither the policy nor a rolled-back
        // transaction can make an absent row look present.
        (await fx.CountLinkedAsync("terms_acceptance_events", termsId, ConsentGateLinkEndpointFixture.FarmerA, session, TermsLinkedEventType))
            .Should().Be(1, "the Terms linking row must be on disk, naming the caller and its session");
        (await fx.CountLinkedAsync("consent_grant_events", grantId, ConsentGateLinkEndpointFixture.FarmerA, session, GrantLinkedEventType))
            .Should().Be(1, "the DPDP consent linking row must be on disk beside it — never one without the other");

        output.WriteLine(
            $"[EVIDENCE] HTTP 200; ssf.terms_acceptance_events {termsId} and "
            + $"ssf.consent_grant_events {grantId} both present, user_id={ConsentGateLinkEndpointFixture.FarmerA}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — IDEMPOTENT ON (user_id, pre_registration_session_id, event_type).
    //
    // This is what makes doctrine P9 hold. A client that loses the response must
    // be free to call again on the next app start, for ever, and a retry must be
    // a no-op that returns the same two ids — never a second pair of legal rows
    // recording one acceptance twice, and never an error the farmer has to see.
    // Both ledgers are append-only BY PRIVILEGE (REVOKE UPDATE, DELETE), so the
    // idempotency is a check-then-insert read, which only works because the
    // linking rows — unlike the orphaned accepting row — are readable by the user
    // they name. That read runs under the same scope as the write, so if the
    // scope were lost the read would silently return nothing and the retry would
    // duplicate. This proof is what catches that.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_2_a_replayed_link_writes_nothing_more_and_returns_the_same_two_rows()
    {
        SkipIfPostgresUnavailable();
        await AssertOrdinaryRoleAsync();

        var session = $"sess-{Guid.NewGuid():N}";

        Guid firstTerms, firstGrant;
        using (var first = await fx.PostLinkAsync(ConsentGateLinkEndpointFixture.FarmerA, session))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await first.Content.ReadAsStringAsync());
            firstTerms = doc.RootElement.GetProperty("termsAcceptanceEventId").GetGuid();
            firstGrant = doc.RootElement.GetProperty("consentGrantEventId").GetGuid();
        }

        using (var replay = await fx.PostLinkAsync(ConsentGateLinkEndpointFixture.FarmerA, session))
        {
            var body = await replay.Content.ReadAsStringAsync();
            replay.StatusCode.Should().Be(
                HttpStatusCode.OK,
                $"a retry must be a 200, never an error the client has to interpret; body was: {body}");

            using var doc = JsonDocument.Parse(body);
            doc.RootElement.GetProperty("termsAcceptanceEventId").GetGuid().Should().Be(
                firstTerms, "the replay must name the row that already exists, not mint a new id");
            doc.RootElement.GetProperty("consentGrantEventId").GetGuid().Should().Be(firstGrant);
            doc.RootElement.GetProperty("alreadyLinked").GetBoolean().Should().BeTrue(
                "'we wrote it' and 'it was already there' are different facts and the client is told which");
        }

        (await fx.CountBySessionAndTypeAsync("terms_acceptance_events", session, TermsLinkedEventType))
            .Should().Be(1, "one acceptance, one Terms linking row — a replay must not double a legal record");
        (await fx.CountBySessionAndTypeAsync("consent_grant_events", session, GrantLinkedEventType))
            .Should().Be(1, "and one consent linking row");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — an unidentified caller writes nothing. The fix must not weaken
    // this: the route now takes the admin-elevated skip-list (elevation silences
    // the interceptor, it is not an identity), and elevation must never become a
    // way past .RequireAuthorization() on the /shramsafal group. Identity is the
    // only dimension these two farm-less tables have.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_3_an_unauthenticated_link_is_rejected_and_writes_nothing()
    {
        SkipIfPostgresUnavailable();
        await AssertOrdinaryRoleAsync();

        var session = $"sess-{Guid.NewGuid():N}";

        using var resp = await fx.PostLinkAsync(userId: null, session);

        resp.StatusCode.Should().Be(
            HttpStatusCode.Unauthorized,
            "a caller with no validated subject must never reach the handler");

        (await fx.CountBySessionAsync("terms_acceptance_events", session))
            .Should().Be(0, "and nothing was written to the Terms ledger");
        (await fx.CountBySessionAsync("consent_grant_events", session))
            .Should().Be(0, "nor to the consent ledger");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4 — the row a farmer links is invisible to another farmer, observed
    // through the endpoint's own pipeline rather than a hand-set GUC.
    // ConsentGateLedgerRlsTests proves the policy; this proves the endpoint is
    // actually standing on it — that the scope the endpoint establishes is the
    // caller's and not something wider that happens to let the write through.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Proof_4_one_farmers_link_is_not_readable_under_another_farmers_scope()
    {
        SkipIfPostgresUnavailable();
        await AssertOrdinaryRoleAsync();

        var session = $"sess-{Guid.NewGuid():N}";

        using (var mine = await fx.PostLinkAsync(ConsentGateLinkEndpointFixture.FarmerA, session))
        {
            mine.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        // B links the SAME pre-registration session id. If B's scope could see A's
        // row, the handler's idempotency read would report alreadyLinked and B would
        // be handed A's row ids — one farmer reading another's DPDP record.
        using var theirs = await fx.PostLinkAsync(ConsentGateLinkEndpointFixture.FarmerB, session);
        var body = await theirs.Content.ReadAsStringAsync();
        theirs.StatusCode.Should().Be(HttpStatusCode.OK, $"body was: {body}");

        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("alreadyLinked").GetBoolean().Should().BeFalse(
            "B must not see A's linking row — if B is told 'already linked' then the scope "
            + "under which the idempotency read ran was not B's");

        (await fx.CountBySessionAndTypeAsync("terms_acceptance_events", session, TermsLinkedEventType))
            .Should().Be(2, "two farmers, two rows, one session id — each naming its own owner");
        (await fx.OwnersOfAsync("terms_acceptance_events", session, TermsLinkedEventType))
            .Should().BeEquivalentTo(
                new[] { ConsentGateLinkEndpointFixture.FarmerA, ConsentGateLinkEndpointFixture.FarmerB },
                "each row names the token that wrote it, and the body carries no user id to forge");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private void SkipIfPostgresUnavailable()
    {
        if (fx.Skip)
        {
            output.WriteLine($"[SKIPPED] {fx.SkipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(fx.Skip, fx.SkipReason);
    }

    /// <summary>
    /// Doctrine E3, inline at the head of every proof — before any other assertion.
    /// </summary>
    private async Task AssertOrdinaryRoleAsync()
    {
        var (currentUser, isSuper, bypassesRls) = await fx.ReadRolePowersOfTheHostConnectionAsync();
        isSuper.Should().BeFalse($"'{currentUser}' must not be a superuser for this proof to mean anything");
        bypassesRls.Should().BeFalse($"'{currentUser}' must not hold BYPASSRLS for this proof to mean anything");
    }
}

/// <summary>
/// Scratch-DB-per-run fixture running the REAL production pipeline for
/// <c>POST /shramsafal/consent-gate/link</c>: TestServer, the production
/// <see cref="TenantTransactionMiddleware"/>, the production DI graph (Npgsql
/// <c>ShramSafalDbContext</c> WITH <see cref="TenantConnectionInterceptor"/>), on the
/// non-superuser <c>agrisync_app</c> role against a database carrying FORCE-RLS.
///
/// <para>No farm or membership seeding: the two consent ledgers have no <c>farm_id</c>
/// column at all — consent belongs to a person, not a field.</para>
/// </summary>
public sealed class ConsentGateLinkEndpointFixture : IAsyncLifetime
{
    public static readonly Guid FarmerA = Guid.Parse("c04e11c0-0000-0000-0000-00000000000a");
    public static readonly Guid FarmerB = Guid.Parse("c04e11c0-0000-0000-0000-00000000000b");

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
        // throws — a misconfigured credential must never masquerade as a clean skip.
        var skipReason = await IntegrationPostgres.ProbeOrSkipReasonAsync(_rootConn);
        if (skipReason is not null)
        {
            Skip = true;
            SkipReason = skipReason;
            return;
        }

        _scratchDbName = $"ssf_consent_link_ep_{Guid.NewGuid():N}";
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
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

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

    /// <summary>
    /// <paramref name="userId"/> null ⇒ no <c>X-Test-UserId</c> header at all, so the test
    /// auth scheme fails authentication and <c>.RequireAuthorization()</c> answers 401.
    /// </summary>
    public async Task<HttpResponseMessage> PostLinkAsync(Guid? userId, string sessionId)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, "/shramsafal/consent-gate/link")
        {
            Content = JsonContent.Create(new
            {
                preRegistrationSessionId = sessionId,
                noticeVersion = "notice-test.1",
                privacyPolicyVersion = "privacy-test.1",
                termsVersion = "terms-test.1",
                displayedLanguage = "mr",
                acceptedPurposeCodes = new[] { "ACCOUNT_AUTHENTICATION" },
                dataCategoryCodes = new[] { "IDENTITY_AND_CONTACT" },
                source = "web",
                appVersion = "0.0.0-test",
                displayedNoticeText = "अटी व नियम आणि गोपनीयता सूचना — चाचणी मजकूर.",
            }),
        };

        if (userId is { } id)
        {
            req.Headers.Add("X-Test-UserId", id.ToString());
        }

        return await Client.SendAsync(req);
    }

    /// <summary>
    /// Doctrine E3, taken on the connection the ENDPOINT writes through — the host's own
    /// request-scoped <c>ShramSafalDbContext</c>, not a connection the test opened for
    /// itself. Issued as a raw command on that context's connection rather than through EF,
    /// because EF would route it via <see cref="TenantConnectionInterceptor"/> and an
    /// observation must not be altered by the thing it observes.
    /// </summary>
    public async Task<(string CurrentUser, bool IsSuper, bool BypassesRls)> ReadRolePowersOfTheHostConnectionAsync()
    {
        using var scope = _app!.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var connection = db.Database.GetDbConnection();
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(CancellationToken.None);
        }

        await using DbCommand cmd = connection.CreateCommand();
        cmd.CommandText = "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("current_user must resolve to a real role row");
        return (reader.GetString(0), reader.GetBoolean(1), reader.GetBoolean(2));
    }

    /// <summary>Ground truth — superuser, RLS-bypassed, so no policy can hide a landed row.</summary>
    public async Task<long> CountLinkedAsync(
        string table, Guid id, Guid userId, string sessionId, string eventType)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText =
            $"SELECT count(*) FROM ssf.{table} WHERE \"Id\" = @id AND user_id = @user "
            + "AND pre_registration_session_id = @session AND event_type = @type";
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("session", sessionId);
        cmd.Parameters.AddWithValue("type", eventType);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<long> CountBySessionAndTypeAsync(string table, string sessionId, string eventType)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText =
            $"SELECT count(*) FROM ssf.{table} WHERE pre_registration_session_id = @session AND event_type = @type";
        cmd.Parameters.AddWithValue("session", sessionId);
        cmd.Parameters.AddWithValue("type", eventType);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<long> CountBySessionAsync(string table, string sessionId)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM ssf.{table} WHERE pre_registration_session_id = @session";
        cmd.Parameters.AddWithValue("session", sessionId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    public async Task<IReadOnlyList<Guid>> OwnersOfAsync(string table, string sessionId, string eventType)
    {
        await using var c = new NpgsqlConnection(_superuserConn);
        await c.OpenAsync();
        await using var cmd = c.CreateCommand();
        cmd.CommandText =
            $"SELECT user_id FROM ssf.{table} WHERE pre_registration_session_id = @session AND event_type = @type";
        cmd.Parameters.AddWithValue("session", sessionId);
        cmd.Parameters.AddWithValue("type", eventType);

        var owners = new List<Guid>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            owners.Add(reader.GetGuid(0));
        }
        return owners;
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-consent-link-ep", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, ConsentGateLinkTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"consent-link-ep-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph — Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor whose prepend broke this endpoint, and the
        // ITenantScopedDbContextRegistry the middleware opens transactions on. Swapping
        // in InMemory here would delete the entire point of the suite.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // Production order, from Program.cs.
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }
}

/// <summary>
/// Turns <c>X-Test-UserId</c> into a JWT <c>sub</c> claim; no header ⇒ authentication FAILS
/// (not "anonymous succeeds"), which is what lets PROOF 3 mean what it says.
/// </summary>
internal sealed class ConsentGateLinkTestAuthHandler(
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
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
    }
}
