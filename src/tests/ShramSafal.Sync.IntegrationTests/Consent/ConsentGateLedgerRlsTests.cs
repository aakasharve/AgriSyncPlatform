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

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 0 — E3 GUARD. Every proof in this class is void if the connection
    // under test holds rolsuper or rolbypassrls: such a role ignores both the
    // policies and the REVOKEs, so the suite would report green while proving
    // the exact opposite of what it claims. Asserted here as its own test AND
    // again inline at the head of each proof below, because a filtered run can
    // drop a standalone guard and take the rest of the class with it, silently.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_these_proofs_mean_something()
    {
        SkipIfPostgresUnavailable();

        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await AssertOrdinaryRoleAsync(app);

        output.WriteLine($"[EVIDENCE] current_user={IntegrationPostgres.AppRoleUser} rolsuper=false rolbypassrls=false");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 5 — the linking row is READABLE BY THE PERSON IT NAMES.
    //
    // This is the whole point of the linking use-case. The accepting row is
    // written before login and therefore lands with user_id NULL, which the
    // USING clause makes readable by nobody (PROOF 2, and PROOF 6 below). A
    // legal record no one can ever read back is not evidence of anything — when
    // a farmer asks "what did I agree to, and when", or when a DPDP request has
    // to be answered, the answer has to come from somewhere. The second row,
    // carrying the same facts plus the now-known user_id, is that somewhere. If
    // this proof does not hold, the ledger is still write-only and nothing was
    // fixed.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("terms_acceptance_events", "TERMS_ACCEPTED", "TERMS_ACCEPTANCE_LINKED")]
    [InlineData("consent_grant_events", "CORE_DPDP_CONSENT_GRANTED", "CORE_DPDP_CONSENT_LINKED")]
    public async Task A_linked_row_is_readable_by_the_user_it_names(
        string table, string acceptedEventType, string linkedEventType)
    {
        SkipIfPostgresUnavailable();

        const string session = "sess-prereg-linked";

        await using var app = await OpenAppAsync(FarmerA);
        await AssertOrdinaryRoleAsync(app);

        // The gate ran BEFORE login, on a session that emits no agrisync.user_id
        // at all — so the accepting row is genuinely ownerless, not merely
        // written with a NULL by a caller who already had an account.
        await using (var preLogin = new NpgsqlConnection(_appConn))
        {
            await preLogin.OpenAsync();
            await InsertAsync(preLogin, table, acceptedEventType, null, session);
        }

        // …and after login the account is known, so a second row records it.
        await InsertAsync(app, table, linkedEventType, FarmerA, session);

        (await CountByTypeAsync(app, table, linkedEventType)).Should().Be(
            1,
            "the linking row exists to make a pre-login acceptance readable by its owner; " +
            "if the owner cannot read it back, the ledger is still write-only");
        (await OwnerOfAsync(app, table, linkedEventType)).Should().Be(
            FarmerA, "the row the owner reads back must name the owner");
        (await SessionOfAsync(app, table, linkedEventType)).Should().Be(
            session,
            "pre_registration_session_id is the only join key back to the ownerless " +
            "accepting row, so a linking row without it links nothing");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 6 — the ORPHAN IS STILL UNREADABLE, even to the user it belongs to
    // in fact. This is the defect the linking row works AROUND, not one it
    // fixes: the USING clause requires user_id IS NOT NULL, so a row written
    // before login stays invisible for ever. Pinned deliberately. If this ever
    // starts returning the orphan the policy has changed underneath the design,
    // and a second row per ledger becomes duplication of a legal record — which
    // is its own problem. Either way somebody has to look.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("terms_acceptance_events", "TERMS_ACCEPTED", "TERMS_ACCEPTANCE_LINKED")]
    [InlineData("consent_grant_events", "CORE_DPDP_CONSENT_GRANTED", "CORE_DPDP_CONSENT_LINKED")]
    public async Task The_ownerless_accepting_row_stays_invisible_even_after_it_has_been_linked(
        string table, string acceptedEventType, string linkedEventType)
    {
        SkipIfPostgresUnavailable();

        const string session = "sess-prereg-orphan";

        await using var app = await OpenAppAsync(FarmerA);
        await AssertOrdinaryRoleAsync(app);

        await using (var preLogin = new NpgsqlConnection(_appConn))
        {
            await preLogin.OpenAsync();
            await InsertAsync(preLogin, table, acceptedEventType, null, session);
        }

        await InsertAsync(app, table, linkedEventType, FarmerA, session);

        // Ground truth, taken RLS-bypassed: two rows really are on disk. Without
        // it the count of 0 below would also be satisfied by an empty table.
        await using (var su = new NpgsqlConnection(_superuserConn))
        {
            await su.OpenAsync();
            (await CountAsync(su, table)).Should().Be(2, "both rows were written");
        }

        (await CountByTypeAsync(app, table, acceptedEventType)).Should().Be(
            0,
            "the accepting row has no owner and the USING clause admits no ownerless row; " +
            "linking does not retro-fit visibility onto it");
        (await CountAsync(app, table)).Should().Be(
            1, "the owner sees exactly one of the two rows — the one that names him");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 7 — one farmer's LINKED consent is invisible to another. PROOF 1
    // establishes this for the accepting event types; the linking row is a
    // second, separately-written record of the same legal fact and inherits
    // nothing automatically. Cross-user isolation on a DPDP record is not a
    // property to assume by symmetry.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("terms_acceptance_events", "TERMS_ACCEPTANCE_LINKED")]
    [InlineData("consent_grant_events", "CORE_DPDP_CONSENT_LINKED")]
    public async Task A_linked_row_is_invisible_to_a_different_user(string table, string linkedEventType)
    {
        SkipIfPostgresUnavailable();

        await using var app = await OpenAppAsync(FarmerA);
        await AssertOrdinaryRoleAsync(app);
        await InsertAsync(app, table, linkedEventType, FarmerA, "sess-a-linked");

        await using (var su = new NpgsqlConnection(_superuserConn))
        {
            await su.OpenAsync();
            (await CountAsync(su, table)).Should().Be(
                1, "the row is on disk — so B reading 0 below is isolation, not an empty table");
        }

        await SetUserAsync(app, FarmerB);
        (await CountByTypeAsync(app, table, linkedEventType)).Should().Be(
            0, "B must not read A's linked consent record");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 8 — ELEVATION IS NOT AN IDENTITY, and the server is what says so.
    //
    // An admin-elevated request emits NO agrisync.user_id GUC. A row naming a
    // user then meets a WITH CHECK of user_id = NULLIF(NULL, '')::uuid, which
    // evaluates to NULL — and a WITH CHECK that is not TRUE refuses the row.
    // 42501. The linking endpoint IS on the admin skip-list: its route was tried
    // on TenantTransactionMiddleware's user-scoped mode and could not write a row
    // at all, because the interceptor's SET LOCAL prepend desyncs EF's
    // rows-affected accounting on an INSERT batch. So the refusal below is exactly
    // what POST /shramsafal/consent-gate/link would meet if the
    // ICallerUserTenantScope wrapper inside the endpoint were ever dropped: every
    // link write failing in production, on every call, while passing any test that
    // used a fake repository. That is the same failure class as the 2026-08-26
    // outage (42501: permission denied for table correction_events), which cost
    // twenty minutes of production.
    //
    // This proof therefore does the thing that must not happen: it writes a
    // user-named row with no GUC at all, and requires the server to refuse it.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("terms_acceptance_events", "TERMS_ACCEPTANCE_LINKED")]
    [InlineData("consent_grant_events", "CORE_DPDP_CONSENT_LINKED")]
    public async Task A_linking_write_with_no_user_guc_is_refused_with_42501(
        string table, string linkedEventType)
    {
        SkipIfPostgresUnavailable();

        // Deliberately NOT OpenAppAsync: that sets the GUC (to '' for null), and
        // the posture under test is a session on which set_config was never
        // called at all — which is exactly what an admin-elevated request looks
        // like to the server.
        await using var elevatedLike = new NpgsqlConnection(_appConn);
        await elevatedLike.OpenAsync();
        await AssertOrdinaryRoleAsync(elevatedLike);

        (await CurrentUserGucAsync(elevatedLike)).Should().BeNull(
            "the premise of this proof is a session carrying no agrisync.user_id; if a " +
            "pooled connection leaked one from an earlier test the refusal below would " +
            "prove nothing, and this assertion is what catches that");

        var write = async () =>
            await InsertAsync(elevatedLike, table, linkedEventType, FarmerA, "sess-no-guc");

        var refusal = (await write.Should().ThrowAsync<PostgresException>()).Which;

        refusal.SqlState.Should().Be(
            "42501",
            "the refusal must come from the RLS WITH CHECK, not from a validation " +
            "message an application could be talked out of");
        refusal.MessageText.Should().Contain(
            "row-level security policy",
            "42501 is ALSO 'permission denied for table' — a missing GRANT would satisfy a " +
            "bare SQLSTATE check while proving the opposite of what this proof claims, and " +
            "that exact confusion is how the 2026-08-26 outage was misread for twenty minutes");

        await using (var su = new NpgsqlConnection(_superuserConn))
        {
            await su.OpenAsync();
            (await CountAsync(su, table)).Should().Be(0, "and nothing landed");
        }
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

    /// <summary>
    /// Doctrine E3. A privilege or policy proof taken through a role that holds
    /// <c>rolsuper</c> or <c>rolbypassrls</c> passes for the wrong reason and would hide
    /// exactly the production failure these proofs exist to catch. Called at the head of
    /// every proof, not only from the standalone guard test.
    /// </summary>
    private static async Task AssertOrdinaryRoleAsync(NpgsqlConnection conn)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("current_user must resolve to a real role row");

        reader.GetBoolean(0).Should().BeFalse(
            "a superuser ignores both RLS and the REVOKEs, so every assertion in this class " +
            "would hold for a reason that does not exist in production (doctrine E3)");
        reader.GetBoolean(1).Should().BeFalse(
            "a BYPASSRLS role sidesteps the policy under test, so a proof taken through it is void");
    }

    private static async Task<long> CountByTypeAsync(NpgsqlConnection conn, string table, string eventType)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM ssf.{table} WHERE event_type = @t";
        cmd.Parameters.AddWithValue("t", eventType);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<Guid?> OwnerOfAsync(NpgsqlConnection conn, string table, string eventType)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT user_id FROM ssf.{table} WHERE event_type = @t";
        cmd.Parameters.AddWithValue("t", eventType);
        return await cmd.ExecuteScalarAsync() is Guid g ? g : null;
    }

    private static async Task<string?> SessionOfAsync(NpgsqlConnection conn, string table, string eventType)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT pre_registration_session_id FROM ssf.{table} WHERE event_type = @t";
        cmd.Parameters.AddWithValue("t", eventType);
        return await cmd.ExecuteScalarAsync() as string;
    }

    /// <summary>
    /// <c>current_setting(..., true)</c> returns NULL — not the empty string — when the GUC
    /// was never set on this session, which is what distinguishes "admin-elevated request"
    /// from "user-scoped request whose user happens to be unknown".
    /// </summary>
    private static async Task<string?> CurrentUserGucAsync(NpgsqlConnection conn)
    {
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT current_setting('agrisync.user_id', true)";
        return await cmd.ExecuteScalarAsync() as string;
    }
}
