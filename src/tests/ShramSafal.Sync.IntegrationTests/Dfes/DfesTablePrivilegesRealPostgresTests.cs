// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (grant-hardening)
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// The two DFES tables must be WRITABLE by the ordinary application role, and
/// <c>question_events</c> must be append-only by privilege rather than by convention.
///
/// <para><b>Why this test exists.</b> <c>20260515090000_BootstrapDbRoles</c> grants
/// <c>ON ALL TABLES</c> — only those existing at that moment — and sets
/// <c>ALTER DEFAULT PRIVILEGES FOR ROLE &lt;the role that ran it&gt;</c>. Since the
/// connection split of 2026-05-16 migrations run under the <c>*_Migration</c> connection,
/// so a table created after that inherits nothing and the app role gets <c>42501</c> on its
/// first write. <c>20260815102440_AddRawBlobSubjects.cs</c> names three tables
/// (<c>field_operators</c>, <c>field_operator_work_rows</c>, <c>labour_corrections</c>)
/// already carrying <c>relacl IS NULL</c> for exactly this reason.</para>
///
/// <para><b>Why the existing DFES tests could not catch it.</b> They assert behaviour
/// through the handler and pass whenever the write succeeds — which it does on any cluster
/// where the app role happens to hold the privilege by inheritance or by being over-powered.
/// This test asserts the PRIVILEGE itself.</para>
///
/// <para><b>Doctrine E3 guard.</b> A privilege proof taken while connected as a superuser or
/// a <c>BYPASSRLS</c> role proves nothing — every check passes for the wrong reason. The
/// first test therefore asserts the role is neither, and every other test here is void
/// without it.</para>
///
/// <para><b>WHAT THIS TEST CANNOT PROVE — read before trusting a green run.</b> This harness
/// applies the WHOLE chain under ONE role, so <c>ALTER DEFAULT PRIVILEGES FOR ROLE
/// &lt;runner&gt;</c> from <c>BootstrapDbRoles</c> always matches the role that later creates
/// these tables, and the privileges land <i>even with the explicit GRANT removed</i> —
/// measured 2026-08-24: all eight cases below passed against a chain with no GRANT block in
/// <c>AddDfesDataSpine</c>. Production is the case where the two roles may DIFFER, and that
/// is the case no local run reproduces. So a green run here means "the write path is not
/// broken by privilege"; it does NOT mean "production has these grants". The only evidence
/// for production is production's own <c>relacl</c> — see the three tables named in
/// <c>20260815102440_AddRawBlobSubjects</c>, which are reported as <c>relacl IS NULL</c> and
/// are the reason the explicit GRANT is written rather than inherited.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Same <c>RequiresPostgres</c> trait and
/// scratch-database lifecycle as the sibling DFES proofs. It creates its OWN scratch
/// database and drops it on dispose; it never touches <c>agrisync_dev</c> data. A skipped
/// run is printed as <c>[SKIPPED]</c> and proves nothing.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DfesTablePrivilegesRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

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
        _scratchDbName = $"ssf_dfes_grants_{Guid.NewGuid():N}";
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
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
    }

    public async Task DisposeAsync()
    {
        if (_skip || string.IsNullOrEmpty(_scratchDbName))
        {
            return;
        }

        await using var admin = new NpgsqlConnection(_adminConn);
        await admin.OpenAsync();
        await using var drop = admin.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
        await drop.ExecuteNonQueryAsync();
    }

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason}");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // E3 GUARD — establishes that the role under test is an ordinary one. Every
    // other proof in this class is void without it.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_these_proofs_mean_something()
    {
        SkipIfPostgresUnavailable();

        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();

        await using var cmd = app.CreateCommand();
        cmd.CommandText = "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("current_user must resolve to a real role row");

        var isSuper = reader.GetBoolean(0);
        var bypassesRls = reader.GetBoolean(1);

        isSuper.Should().BeFalse(
            "a privilege proof taken as a superuser passes for the wrong reason and would hide " +
            "exactly the production failure this class exists to catch (doctrine E3)");
        bypassesRls.Should().BeFalse(
            "a BYPASSRLS role sidesteps the policies, so a grant proof taken through it is void");

        output.WriteLine($"[EVIDENCE] current_user={AppRoleUser} rolsuper=false rolbypassrls=false");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The write path. Without a GRANT the app role gets 42501 on first insert
    // and every Sathi question write fails in production while the migration
    // reports success.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("ssf.question_events", "SELECT")]
    [InlineData("ssf.question_events", "INSERT")]
    [InlineData("ssf.daily_richness_aggregates", "SELECT")]
    [InlineData("ssf.daily_richness_aggregates", "INSERT")]
    [InlineData("ssf.daily_richness_aggregates", "UPDATE")]
    public async Task The_app_role_holds_the_privilege_the_write_path_needs(string table, string privilege)
    {
        SkipIfPostgresUnavailable();

        (await HasTablePrivilegeAsync(table, privilege)).Should().BeTrue(
            $"{privilege} on {table} is required by the shipped write path; without the GRANT the " +
            "app role gets 42501 on first write and the failure only appears in production");

        output.WriteLine($"[EVIDENCE] has_table_privilege({AppRoleUser}, {table}, {privilege}) = true");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Append-only BY PRIVILEGE. The REVOKE in AddDfesDataSpine narrows a real
    // grant; if the GRANT above were ever removed the REVOKE would silently
    // revoke nothing from nothing, and this pair of assertions would still pass
    // while the table became unwritable — which is why the test above runs too.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableTheory]
    [InlineData("UPDATE")]
    [InlineData("DELETE")]
    public async Task Question_events_is_append_only_by_privilege_not_by_convention(string privilege)
    {
        SkipIfPostgresUnavailable();

        (await HasTablePrivilegeAsync("ssf.question_events", privilege)).Should().BeFalse(
            $"{privilege} on ssf.question_events must be revoked — a question event is a record of " +
            "what was asked and answered at a moment, and rewriting it destroys the provenance " +
            "the score is derived from (doctrine P8)");

        output.WriteLine($"[EVIDENCE] has_table_privilege({AppRoleUser}, ssf.question_events, {privilege}) = false");
    }

    private async Task<bool> HasTablePrivilegeAsync(string table, string privilege)
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();

        await using var cmd = app.CreateCommand();
        // current_user, not a literal role name: this asks what the connection ACTUALLY
        // has, so the proof cannot drift from the role the app really connects as.
        cmd.CommandText = "SELECT has_table_privilege(current_user, @t, @p)";
        cmd.Parameters.AddWithValue("t", table);
        cmd.Parameters.AddWithValue("p", privilege);

        return (bool)(await cmd.ExecuteScalarAsync())!;
    }
}
