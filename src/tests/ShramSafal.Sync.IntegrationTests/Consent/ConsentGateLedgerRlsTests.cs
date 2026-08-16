// spec: dfes-companion-2026-07-11 (wave-4.2)
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Consent;

/// <summary>
/// The two append-only consent ledgers, proved against a REAL Postgres under FORCE-RLS.
///
/// <para><b>Why none of this can be a unit test.</b> Every guarantee here is a database
/// guarantee. "Append-only" is <c>REVOKE UPDATE, DELETE</c> — a privilege, not a code
/// path; an in-memory repository will happily let you mutate an entity and prove nothing.
/// "A farmer cannot read another farmer's consent" is an RLS policy evaluated by the
/// server against a GUC. And the policy has an unusual clause — a pre-registration row
/// with <c>user_id IS NULL</c> must be INSERTABLE (the gate runs before login) while being
/// readable by nobody — which is exactly the kind of asymmetry that is easy to write and
/// easy to get backwards.</para>
///
/// <para><b>Connects as <c>agrisync_app</c>, deliberately.</b> The superuser bypasses both
/// RLS and the revokes, so a proof run as superuser proves the opposite of what it claims.
/// GUCs are set with <c>set_config(..., false)</c> on a session the test owns, rather than
/// through the interceptor, to avoid the SET LOCAL rows-affected desync documented on
/// <c>TenantConnectionInterceptor</c>.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping</b> — same posture as
/// <c>QuestionEventIdempotencyTests</c>. A skipped run prints <c>[SKIPPED]</c> and proves
/// nothing; it does not pass quietly.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ConsentGateLedgerRlsTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private static readonly Guid FarmerA = Guid.Parse("c04e5a7e-0000-0000-0000-00000000000a");
    private static readonly Guid FarmerB = Guid.Parse("c04e5a7e-0000-0000-0000-00000000000b");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;

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
        _scratchDbName = $"ssf_consent_gate_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        output.WriteLine($"[PROVISIONED] scratch database '{_scratchDbName}' on the real :5433 cluster.");

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (_skip || string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn)) return;

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
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — the tenant boundary. Farmer A's consent is invisible to farmer B.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task One_farmers_consent_is_invisible_to_another()
    {
        SkipIfPostgresUnavailable();

        await using var app = await OpenAppAsync(FarmerA);
        await InsertAsync(app, "terms_acceptance_events", TermsAcceptanceEventType, FarmerA, "sess-a");
        await InsertAsync(app, "consent_grant_events", CoreGrantEventType, FarmerA, "sess-a");

        (await CountAsync(app, "terms_acceptance_events")).Should().Be(1, "A reads his own terms row");
        (await CountAsync(app, "consent_grant_events")).Should().Be(1, "A reads his own consent row");

        await SetUserAsync(app, FarmerB);
        (await CountAsync(app, "terms_acceptance_events")).Should().Be(0, "B must not see A's terms row");
        (await CountAsync(app, "consent_grant_events")).Should().Be(0, "B must not see A's consent row");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — the pre-registration window. The gate runs BEFORE login, so a row
    // with no user id must be insertable; and being ownerless, it must be readable
    // by no user through the self policy.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_pre_registration_row_is_insertable_and_owned_by_nobody()
    {
        SkipIfPostgresUnavailable();

        await using var app = await OpenAppAsync(userId: null);
        await InsertAsync(app, "terms_acceptance_events", TermsAcceptanceEventType, null, "sess-prereg");
        await InsertAsync(app, "consent_grant_events", CoreGrantEventType, null, "sess-prereg");

        // Written — the superuser can see both, so the INSERT genuinely landed.
        await using (var su = new NpgsqlConnection(_superuserConn))
        {
            await su.OpenAsync();
            (await CountAsync(su, "terms_acceptance_events")).Should().Be(1);
            (await CountAsync(su, "consent_grant_events")).Should().Be(1);
        }

        // …and unreadable through the self policy by anybody, because it has no owner yet.
        await SetUserAsync(app, FarmerA);
        (await CountAsync(app, "terms_acceptance_events")).Should().Be(0);
        await SetUserAsync(app, FarmerB);
        (await CountAsync(app, "consent_grant_events")).Should().Be(0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — a consent decision cannot be rewritten or erased. This is what makes
    // "granted on the 3rd, withdrawn on the 9th" a truthful record rather than a claim.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("terms_acceptance_events")]
    [InlineData("consent_grant_events")]
    public async Task A_recorded_consent_can_never_be_updated_or_deleted(string table)
    {
        SkipIfPostgresUnavailable();

        await using var app = await OpenAppAsync(FarmerA);
        var eventType = table == "terms_acceptance_events" ? TermsAcceptanceEventType : CoreGrantEventType;
        await InsertAsync(app, table, eventType, FarmerA, "sess-a");

        var update = async () =>
        {
            await using var cmd = app.CreateCommand();
            cmd.CommandText = $"UPDATE ssf.{table} SET status = 'Withdrawn'";
            await cmd.ExecuteNonQueryAsync();
        };
        var delete = async () =>
        {
            await using var cmd = app.CreateCommand();
            cmd.CommandText = $"DELETE FROM ssf.{table}";
            await cmd.ExecuteNonQueryAsync();
        };

        // 42501 insufficient_privilege — the REVOKE, not an application check.
        (await update.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        (await delete.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");

        (await CountAsync(app, table)).Should().Be(1, "the row is still there, unchanged");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4 — a farmer cannot write a consent record in someone else's name.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_row_cannot_be_written_for_another_user()
    {
        SkipIfPostgresUnavailable();

        await using var app = await OpenAppAsync(FarmerA);

        var forge = async () =>
            await InsertAsync(app, "consent_grant_events", CoreGrantEventType, FarmerB, "sess-forged");

        // 42501 — the RLS WITH CHECK refusing the row, not a validation message.
        (await forge.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private const string TermsAcceptanceEventType = "TERMS_ACCEPTED";
    private const string CoreGrantEventType = "CORE_DPDP_CONSENT_GRANTED";

    private async Task<NpgsqlConnection> OpenAppAsync(Guid? userId)
    {
        var conn = new NpgsqlConnection(_appConn);
        await conn.OpenAsync();
        await SetUserAsync(conn, userId);
        return conn;
    }

    /// <summary>
    /// Session-scoped (<c>is_local := false</c>) so it survives across the statements
    /// below without an explicit transaction — the interceptor's per-command SET LOCAL
    /// prepend is exactly what these proofs must NOT depend on.
    /// </summary>
    private static async Task SetUserAsync(NpgsqlConnection conn, Guid? userId)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.user_id', @v, false)";
        cmd.Parameters.AddWithValue("v", userId?.ToString() ?? string.Empty);
        await cmd.ExecuteScalarAsync();
    }

    private static async Task InsertAsync(
        NpgsqlConnection conn, string table, string eventType, Guid? userId, string sessionId)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $@"
INSERT INTO ssf.{table} (
    ""Id"", event_type, user_id, pre_registration_session_id, notice_version,
    privacy_policy_version, terms_version, displayed_language, accepted_purpose_codes,
    data_category_codes, source, app_version, notice_hash, status, recorded_at_utc)
VALUES (
    @id, @type, @user, @session, 'notice-test.1',
    'privacy-test.1', 'terms-test.1', 'mr', 'ACCOUNT_AUTHENTICATION',
    'IDENTITY_AND_CONTACT', 'web', '0.0.0-test', 'deadbeef', 'Granted', now())";
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("type", eventType);
        cmd.Parameters.AddWithValue("user", (object?)userId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("session", sessionId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<long> CountAsync(NpgsqlConnection conn, string table)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM ssf.{table}";
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
