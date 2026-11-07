// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, AC1 + AC5; BN-1 landed with step 1)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — <b>typing a farm's code is a request, never
/// access</b>, proven by what the joiner can actually READ and WRITE, not by the status column.
///
/// <para>Independent verifiers proved on the step-1 tree that a typed-code join request
/// (PendingApproval) downloaded the farm's money rows on the very next <c>/sync/pull</c> and could
/// push into the farm, because every data and operational gate counted any seat that had not
/// ended. This suite is the regression fence for the fix (the Active-only gates in
/// <c>ShramSafalRepository</c> + migration <c>RequireActiveMembershipForUserScopedDataReads</c>).
/// Every assertion below FAILS on that tree.</para>
///
/// <para>Each refusal is paired with a CONTROL that must succeed — the owner reads the same rows,
/// the owner's identical push applies, the joiner reads them once the seat is made Active — so no
/// refusal can pass because the seed, the payload or the endpoint is broken.</para>
///
/// <para>Over the REAL production pipeline (TenantTransactionMiddleware, the pipeline-wrapped
/// handlers, the real tenant scopes) against real Postgres as the non-superuser
/// <c>agrisync_app</c>; doctrine E3 vacuity guard first in every fact. The one substitution:
/// <see cref="IEntitlementPolicy"/> is allow-all (as in <c>SyncPushTenantScopeRealPostgresTests</c>),
/// because subscriptions are not under test and the owner control must not fail on a missing
/// plan. The joiner's refusal comes from the membership gates, which run before it.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PendingJoinRequestAccessRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private const string Code = "K7M2QP";
    private const string FarmName = "Probe Shinde Mala";
    private const string PlotName = "Probe Plot Varcha";
    private const string SecretCost = "PROBE-SECRET-COST-ROW";
    private const string SecretAmount = "98765";

    private static readonly Guid Farm = Guid.Parse("d1e30001-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("d1e30001-0000-0000-0000-0000000000c1");
    private static readonly Guid Owner = Guid.Parse("d1e30001-0000-0000-0000-0000000000a1");
    private static readonly Guid ActiveMukadam = Guid.Parse("d1e30001-0000-0000-0000-0000000000b3");
    private static readonly Guid RevokedMukadam = Guid.Parse("d1e30001-0000-0000-0000-0000000000b5");
    private static readonly Guid Stranger = Guid.Parse("d1e30001-0000-0000-0000-0000000000e1");
    private static readonly Guid Plot = Guid.Parse("d1e30001-0000-0000-0000-0000000000d1");
    private static readonly Guid CostEntry = Guid.Parse("d1e30001-0000-0000-0000-0000000000d2");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_pendingjoin_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Planted as SUPERUSER: the plant never depends on the code under test.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            // HARNESS PARITY (same as LabourReadMembershipStatusRealPostgresTests): the pull's
            // operator directory reads public.users, a grant provisioned outside the migration
            // chain on real environments.
            await ExecAsync(raw,
                "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");

            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
                VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
                """,
                ("farm", Farm), ("name", FarmName), ("owner", Owner), ("account", Account), ("code", Code));
            await SeedSeatAsync(raw, Owner, "PrimaryOwner", status: 3);
            await SeedSeatAsync(raw, ActiveMukadam, "Mukadam", status: 3);
            await SeedSeatAsync(raw, RevokedMukadam, "Mukadam", status: 5);

            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
                """,
                ("id", Plot), ("farm", Farm), ("name", PlotName));
            await ExecAsync(raw, """
                INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                              created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
                VALUES (@id, @farm, @plot, @desc, 98765, 'INR', CURRENT_DATE, @owner,
                        NOW(), NOW(), 'manual', 'unknown', 'unknown', 'other');
                """,
                ("id", CostEntry), ("farm", Farm), ("plot", Plot), ("desc", SecretCost), ("owner", Owner));
        }

        _app = await BuildHostAsync(_appConn);
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

    [Fact]
    public async Task The_host_connects_as_a_role_that_is_neither_superuser_nor_bypassrls()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    [Fact]
    public async Task A_typed_code_joiner_pulls_nothing_of_the_farm_until_the_seat_is_Active()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // CONTROL: the owner's pull carries every planted row, so a clean joiner pull below
        // cannot be explained by a broken seed or a failing pull.
        var ownerPull = await PullAsync(Owner);
        ownerPull.Should().Contain(FarmName).And.Contain(PlotName).And.Contain(SecretCost).And.Contain(SecretAmount);

        (await PullAsync(Stranger)).Should().NotContain(FarmName, "arrange: a stranger sees nothing");

        await JoinAndExpectPendingAsync(Stranger);

        var pendingPull = await PullAsync(Stranger);
        output.WriteLine($"[EVIDENCE] pending joiner /sync/pull body length={pendingPull.Length}");
        AssertCarriesNothingOfTheFarm(pendingPull, "a PendingApproval request is not access");

        // CONTROL: the same person, the same pull, once the seat is Active (what step 2's approve
        // will do — flipped here as superuser), DOES receive the farm. So the refusal above is the
        // status, nothing else.
        await SetSeatStatusAsync(Stranger, status: 3);
        var approvedPull = await PullAsync(Stranger);
        approvedPull.Should().Contain(FarmName).And.Contain(PlotName);
        // lane MU-3 (founder D-22): the request became a कामगार seat with no authority — he reads the farm,
        // never its money.
        approvedPull.Should().NotContain(SecretCost).And.NotContain(SecretAmount);
    }

    [Fact]
    public async Task A_revoked_person_who_types_the_code_again_still_pulls_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        AssertCarriesNothingOfTheFarm(await PullAsync(RevokedMukadam), "arrange: revoked reads nothing");

        await JoinAndExpectPendingAsync(RevokedMukadam);

        AssertCarriesNothingOfTheFarm(await PullAsync(RevokedMukadam),
            "a removed person must not get back in by re-typing a code he once saw");
    }

    [Fact]
    public async Task A_typed_code_joiner_cannot_push_into_the_farm_and_nothing_lands()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        var joinerCost = Guid.NewGuid();
        var refused = await PushCostAsync(Stranger, joinerCost, "joiner-cost");
        output.WriteLine($"[EVIDENCE] pending joiner add_cost_entry: status={refused.Status} code={refused.ErrorCode}");
        refused.Status.Should().Be("failed", "a pending request may not write to the farm");
        refused.ErrorCode.Should().EndWith("Forbidden");
        (await CostRowExistsAsync(joinerCost)).Should().BeFalse("a refused push must leave no row");

        // CONTROL: the identical mutation from the owner applies — the payload is valid, so the
        // refusal above is the membership gate.
        var ownerCost = Guid.NewGuid();
        var applied = await PushCostAsync(Owner, ownerCost, "owner-cost");
        applied.Status.Should().Be("applied", $"control: {applied.ErrorCode} {applied.ErrorMessage}");
        (await CostRowExistsAsync(ownerCost)).Should().BeTrue();
    }

    [Fact]
    public async Task A_typed_code_joiner_is_refused_at_the_REST_farm_doors()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        foreach (var path in new[] { $"/shramsafal/farms/{Farm}", $"/shramsafal/farms/{Farm}/labour" })
        {
            using var asJoiner = await GetAsync(path, Stranger);
            var body = await asJoiner.Content.ReadAsStringAsync();
            asJoiner.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{path}: {body}");
            body.Should().NotContain(PlotName).And.NotContain(SecretCost);

            // CONTROL: the owner is let through the same door.
            using var asOwner = await GetAsync(path, Owner);
            asOwner.StatusCode.Should().Be(HttpStatusCode.OK, $"control {path}: {await asOwner.Content.ReadAsStringAsync()}");
        }
    }

    [Fact]
    public async Task The_user_scoped_data_policies_hide_every_row_from_a_pending_seat_as_the_app_role()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        // Below the application: raw SQL as agrisync_app with ONLY agrisync.user_id meaningful (the
        // farm GUC at the all-zeros sentinel), so the user-scoped policies are the sole answer.
        var pending = await VisibleRowsAsync(Stranger);
        var active = await VisibleRowsAsync(ActiveMukadam);
        output.WriteLine($"[EVIDENCE] pending: {pending}  active mukadam: {active}");

        pending.Plots.Should().Be(0);
        pending.CostEntries.Should().Be(0);
        // The farm ROW stays visible on purpose: /farms/mine lists the request (name + status) so
        // the person can see THAT it is pending. It carries no data, and every data policy re-checks
        // the seat itself — which is what the two zeros above prove.
        pending.Farms.Should().Be(1);

        // CONTROL: an Active member reads the same rows through the same policies.
        active.Should().Be(new RowCounts(Farms: 1, Plots: 1, CostEntries: 1));
    }

    [Fact]
    public async Task No_user_scoped_data_policy_still_admits_a_seat_that_is_merely_not_ended()
    {
        await AssertAppRoleIsNotVacuousAsync();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var stillOpen = await StringListAsync(db, """
            SELECT policyname FROM pg_policies
            WHERE schemaname = 'ssf' AND policyname LIKE 'p\_user\_select\_%'
              AND policyname NOT IN ('p_user_select_farms', 'p_user_select_memberships')
              AND coalesce(qual, '') LIKE '%<> ALL (ARRAY[5, 6])%'
            ORDER BY 1
            """);
        var activeOnly = await StringListAsync(db, """
            SELECT policyname FROM pg_policies
            WHERE schemaname = 'ssf' AND policyname LIKE 'p\_user\_select\_%'
              AND coalesce(qual, '') LIKE '%(m.status = 3)%'
            ORDER BY 1
            """);
        output.WriteLine($"[EVIDENCE] Active-only data policies ({activeOnly.Count}): {string.Join(", ", activeOnly)}");

        stillOpen.Should().BeEmpty("every user-scoped DATA policy must count Active seats only");
        activeOnly.Should().Contain(new[]
        {
            "p_user_select_plots", "p_user_select_daily_logs", "p_user_select_cost_entries",
            "p_user_select_finance_corrections", "p_user_select_labour_assignments",
            "p_user_select_attendance_marks", "p_user_select_job_cards",
        });
        activeOnly.Should().NotContain(new[] { "p_user_select_farms", "p_user_select_memberships" },
            "the two RELATIONSHIP policies keep 'not ended' so a pending person can see THAT he is pending");
    }

    /// <summary>
    /// The migration's Down() really restores the old predicate on the same policies and a
    /// re-Up narrows them again (E8 reversibility, checked on the deparsed text). Drives the
    /// migrator back one step, so every migration AFTER this one would be reverted too — see
    /// <see cref="ReviewedMigrationsAfterActiveOnly"/> (the repo's guard pattern).
    /// </summary>
    [Fact]
    public async Task The_active_only_migration_reverts_to_the_old_predicate_and_reapplies_cleanly()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var opts = new DbContextOptionsBuilder<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>()
            .UseNpgsql(_superuserConn).Options;
        await using (var ctx = new ShramSafal.Infrastructure.Persistence.ShramSafalDbContext(opts))
        {
            var after = (await ctx.Database.GetAppliedMigrationsAsync())
                .Where(m => string.CompareOrdinal(m, ActiveOnlyMigration) > 0).ToList();
            after.Should().BeSubsetOf(ReviewedMigrationsAfterActiveOnly,
                "this fact reverts everything after the Active-only migration; review each later Down() "
                + "and add it to ReviewedMigrationsAfterActiveOnly — do not delete this guard. Unreviewed: "
                + string.Join(", ", after.Except(ReviewedMigrationsAfterActiveOnly)));
        }

        var (openBefore, activeBefore) = await CountDataPolicyPredicatesAsync();
        openBefore.Should().Be(0);
        activeBefore.Should().BeGreaterThan(10, "every user-scoped data policy is narrowed");

        // spec SEC-1: a typed-code request is waiting when Down() runs. Restoring "not ended" with
        // it in place would re-open the farm's rows to it, so Down() must end it first.
        await JoinAndExpectPendingAsync(Stranger);

        await MigrateShramSafalToAsync(MigrationBeforeActiveOnly);
        var (openAfterDown, activeAfterDown) = await CountDataPolicyPredicatesAsync();
        output.WriteLine($"[EVIDENCE] after Down(): 'NOT IN (5,6)' policies={openAfterDown}  'status = 3' policies={activeAfterDown}");
        openAfterDown.Should().Be(activeBefore - PoliciesCreatedAfterActiveOnly.Length,
            "Down() restores the old predicate on exactly the policies Up() narrowed; the policies of tables "
            + "a LATER migration created (PoliciesCreatedAfterActiveOnly) are dropped with their tables");
        activeAfterDown.Should().Be(0);
        (await SeatStatusesAsync(Stranger)).Should().Equal(new[] { 5 },
            "Down() ends every waiting typed-code request (Revoked) before it restores the not-ended predicate");
        (await MigrationDownAuditRowsAsync()).Should().Be(1, "one audit row says why the request disappeared");
        // The not-ended predicate is back, and the ended request no longer satisfies it.
        (await VisibleRowsAsync(Stranger)).Should().Be(new RowCounts(Farms: 0, Plots: 0, CostEntries: 0));

        await MigrateShramSafalToAsync(null);
        (await CountDataPolicyPredicatesAsync()).Should().Be((0, activeBefore), "a re-Up narrows the same set again");
    }

    [Fact]
    public async Task Farms_mine_with_includePending_lists_the_request_as_pending_with_no_code_and_no_plan()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        using var response = await GetAsync("/shramsafal/farms/mine?includePending=true", Stranger);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        var farm = doc.RootElement.EnumerateArray().Single();
        farm.GetProperty("farmId").GetGuid().Should().Be(Farm);
        farm.GetProperty("status").GetString().Should().Be("PendingApproval",
            "without the status the phone cannot tell a request from an approved Worker seat");
        farm.GetProperty("farmCode").ValueKind.Should().Be(JsonValueKind.Null);
        farm.GetProperty("subscription").ValueKind.Should().Be(JsonValueKind.Null);

        // CONTROL: the owner's own listing is unchanged (Active, code, plan slot present).
        using var ownerResponse = await GetAsync("/shramsafal/farms/mine?includePending=true", Owner);
        using var ownerDoc = JsonDocument.Parse(await ownerResponse.Content.ReadAsStringAsync());
        var ownerFarm = ownerDoc.RootElement.EnumerateArray().Single();
        ownerFarm.GetProperty("status").GetString().Should().Be("Active");
        ownerFarm.GetProperty("farmCode").GetString().Should().Be(Code);
    }

    /// <summary>
    /// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, P11) — the installed 1.0.16 APK (and every app
    /// before step 1) calls <c>/farms/mine</c> with no <c>includePending</c> and ignores
    /// <c>status</c>: it would show a waiting request as an ordinary farm it then cannot open. So
    /// without the parameter the list is Active seats only — the person with only a request gets
    /// the empty list, i.e. the old app's 0-farm screen, exactly as before he typed the code.
    /// </summary>
    [Theory]
    [InlineData("/shramsafal/farms/mine")]
    [InlineData("/shramsafal/farms/mine?includePending=false")]
    public async Task Farms_mine_without_includePending_is_Active_only_so_an_old_app_sees_no_farm(string url)
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        using var response = await GetAsync(url, Stranger);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using (var doc = JsonDocument.Parse(body))
        {
            doc.RootElement.GetArrayLength().Should().Be(0,
                $"an old app must not be handed a farm it cannot open: {body}");
        }

        body.Should().NotContain(FarmName).And.NotContain(Farm.ToString());

        // CONTROL 1: the owner (Active) is listed the same way with or without the parameter.
        using var ownerResponse = await GetAsync(url, Owner);
        using (var ownerDoc = JsonDocument.Parse(await ownerResponse.Content.ReadAsStringAsync()))
        {
            var ownerFarm = ownerDoc.RootElement.EnumerateArray().Single();
            ownerFarm.GetProperty("farmId").GetGuid().Should().Be(Farm);
            ownerFarm.GetProperty("farmCode").GetString().Should().Be(Code);
        }

        // CONTROL 2: once the seat is Active (what step 2's approve will do — flipped here as
        // superuser) the same call without the parameter lists it, so the absence above was the
        // status, not a broken seed or route.
        await SetSeatStatusAsync(Stranger, status: 3);
        using var approved = await GetAsync(url, Stranger);
        using var approvedDoc = JsonDocument.Parse(await approved.Content.ReadAsStringAsync());
        approvedDoc.RootElement.EnumerateArray().Single().GetProperty("farmId").GetGuid().Should().Be(Farm);
    }

    [Fact]
    public async Task A_pending_request_can_always_be_withdrawn_by_self_exit()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Stranger);

        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/self-exit", Stranger, body: null);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK,
            $"the access gate refuses a pending seat, but leaving must never be refused: {text}");

        (await SeatStatusesAsync(Stranger)).Should().Equal(6);
    }

    // -- Harness ----------------------------------------------------------------

    private const string ActiveOnlyMigration = "20261025204459_RequireActiveMembershipForUserScopedDataReads";
    private const string MigrationBeforeActiveOnly = "20261025192535_AddFarmJoinCodeReadPolicy";

    /// <summary>ShramSafal migrations after the Active-only one, reviewed as safe to revert and
    /// re-apply inside this per-fact scratch database. Add one only after reading its Down().</summary>
    private static readonly string[] ReviewedMigrationsAfterActiveOnly =
    [
        // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — Down() read in full: drops the five
        // NULLABLE access columns it added to ssf.farm_memberships; no policy, no grant, no row.
        // Reverting it mid-proof loses nothing this fact asserts about.
        "20261026141837_AddMembershipAccessFields",
        // spec R-11 (b) — an ACCOUNTS migration; it shows here only because this harness keeps every
        // context's history in one table. The ShramSafal migrator never reverts it. Its Down() (read
        // in full) drops accounts.access_extensions — no ssf policy, no ssf grant, no ssf row.
        "20261027040015_AddAccessExtensions",
        // spec R-11 (b) — Down() read in full: DROP VIEW IF EXISTS ssf.access_extension_projections.
        // A read-only view with no farm column; no policy, no row. Re-Up recreates it and its grant.
        "20261027040113_AddAccessExtensionProjection",
        // spec plr-d10 I25 (founder D-36 / D-31) — Down() read in full: drops policy
        // p_self_improvement_permission_events, the user-keyed table ssf.improvement_permission_events
        // and the nullable column user_consent_state.full_history_journal_wording_version. No farm
        // column, no membership policy, no farm_join_requests object. Re-Up recreates them.
        "20261029224212_AddImprovementPermissionAndVoiceWordingVersion",

        // spec plr-d10 I27 (founder D-44 / D-46 / D-31) — Down() read in full: drops
        // ck_verification_events_review_basis and four additive columns (verification_events
        // confirmed_log_version / review_basis, daily_logs content_version / voice_clip_id). No
        // policy, no grant, no farm_join_requests object. Re-Up recreates them.
        "20261030022054_AddOwnerConfirmationEvidence",

        // spec plr-d10 lane F1 — Down() read in full: drops the two policies on
        // ssf.daily_log_contents and the table. Up() creates that table only, with its user-select
        // policy written ALREADY narrowed (m.status = 3) — see PoliciesCreatedAfterActiveOnly. No
        // farm_join_requests object, no other policy. Re-Up recreates them.
        "20261030102448_AddDailyLogContents",

        // spec pre-launch repair lane 2b (MU design §11.1) — Down() read in full: collapses the
        // split authority bits / labour grant VALUES on let-in and waiting farm_memberships rows
        // and drops the nullable jsonb column authority_expires_at. No policy, no grant, no
        // farm_join_requests object; a waiting seat's status is never touched. Re-Up re-adds them.
        "20261031021129_SplitFarmAuthorities",

        // spec plr-d10 lane PRV (founder D-26) — Down() read in full: drops the two policies on
        // ssf.record_audience_members and the table, the audience CHECK constraints and columns. Its user-select
        // policy names no membership status at all (fix pass 1, L2: a person's own rows, or the farm's registrant),
        // so it is neither an "open" nor an "active" predicate here. No farm_join_requests object, no other policy.
        "20261101110309_AddRecordAudience",

        // spec plr-d10 lane MU-4 — Down() read in full: drops ck_farm_memberships_plot_scope and the two additive
        // farm_memberships columns plot_scope / scope_plot_ids (every seat back to every plot). No policy, no grant, no
        // table, no farm_join_requests object; a seat's status is never touched. Re-Up re-adds them with their defaults.
        // Fix pass 1 (M2): also the four additive move columns on daily_logs / cost_entries (no policy, no grant).
        "20261101221236_AddMembershipPlotScope",

        // spec plr-d10 lane WID — Down() read in full: drops the five worker-identity tables and their policies, the nullable
        // field_operators.person_id and the nullable farms.pin_code (with its CHECK). No farm_memberships or
        // farm_join_requests object, no ssf.farms policy; a seat's status is never touched. Re-Up re-creates them and
        // back-fills a person and a card for every field operator.
        "20261102163914_AddWorkerIdentity",

        // ── Reviewed 2026-11-06 (spec: plr-d10 lane OPS-1, L-1, fix round 2); Down() read in full: drops ONE partial unique index,
        //    ux_erasure_requests_one_waiting_per_person, on ssf.erasure_requests. Up() DOES touch ssf.audit_events: it first marks
        //    duplicate WAITING requests (the oldest per person is kept) Cancelled and INSERTS one audit row per cancelled duplicate
        //    (actor system_migration), lifting FORCE ROW LEVEL SECURITY on ssf.audit_events for that single insert and restoring it exactly
        //    as found (only when there is a duplicate to cancel); it then creates the index. No table, column, policy or grant is created,
        //    changed or dropped; no ledger's grants are touched. Safe to revert and re-apply mid-proof.
        "20261105190000_AddOneWaitingErasureRequestIndex",
        // spec plr-d10 lane L8b-1 — Down() read in full: drops p_tenant_schedule_subscriptions,
        // p_user_select_schedule_subscriptions (an Active-only data policy, created already narrowed: m.status = 3 — see
        // PoliciesCreatedAfterActiveOnly) and p_tenant_schedule_migration_events, takes both tables out of RLS and drops
        // schedule_subscriptions.reference_date. No farm_memberships or farm_join_requests object; a seat's status is
        // never touched. Re-Up re-creates them.
        "20261106054532_AddScheduleSubscriptionDayZeroAndRls",
        // lane WID fix pass 2 (N3) — Down() read in full: drops only the two shram_person_phones indexes Up() adds. No
        // farm_memberships or farm_join_requests object, no ssf.farms policy.
        "20261106060953_AddOneVerifiedNumberPerPerson",
        // spec plr-d10 lane MU-2 — Down() read in full: drops the three policies on ssf.farm_personal_invitations (a
        // farm-id tenant policy and two SELECT-only invitee doors keyed on agrisync.invitee_phone / agrisync.invite_code;
        // none names a membership status, so none is an "open" or an "active" predicate here), the table, the
        // relationship-label CHECK and the three nullable farm_memberships columns. No farm_join_requests object, no
        // ssf.farms policy; a seat's status is never touched. Re-Up re-creates them.
        "20261106063315_AddPersonalInvitations",
        // 20261106212345_PersonalInvitationsGoWithTheirFarm (lane MU-2 fix round 1, L-10): Up() and Down() read in full —
        // one foreign key on ssf.farm_personal_invitations re-created (CASCADE; Down() puts RESTRICT back). No
        // farm_join_requests object, no ssf.farms policy, no seat touched.
        "20261106212345_PersonalInvitationsGoWithTheirFarm",
        // spec plr-d10 lane RATE-1 part A (founder D-72) — Down() read in full: drops the two policies on ssf.farm_rates and
        // the table. Up() creates that table only, with its user-select policy written ALREADY narrowed (m.status = 3) — see
        // PoliciesCreatedAfterActiveOnly. No farm_memberships or farm_join_requests object, no other policy. Re-Up recreates them.
        "20261106112244_AddFarmRates",
        // spec plr-d10 lane NP-1 (founder D-56, CTO call D-85) — Down() read in full: drops one CHECK and two nullable columns on
        // public.refresh_tokens (USER context; the ShramSafal migrator never reverts or re-applies it, it only shares the scratch
        // database's history table). No farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched.
        "20261107061500_AddNewPhoneQuestion",
    ];

    /// <summary>
    /// <c>p_user_select_*</c> DATA policies a migration AFTER <see cref="ActiveOnlyMigration"/>
    /// created already narrowed. Migrating down to <see cref="MigrationBeforeActiveOnly"/> drops their
    /// tables with them, so they are counted before Down() and gone after it — every OTHER narrowed
    /// policy must come back as "not ended", exactly as before.
    /// </summary>
    private static readonly string[] PoliciesCreatedAfterActiveOnly =
    [
        // spec plr-d10 lane F1 — 20261030102448_AddDailyLogContents.
        "p_user_select_daily_log_contents",
        // spec plr-d10 lane L8b-1 — 20261106054532_AddScheduleSubscriptionDayZeroAndRls. Its table predates the Active-only
        // migration; the policy is dropped by its OWN migration's Down() on the way back, so it is gone after Down() too.
        "p_user_select_schedule_subscriptions",
        // spec plr-d10 lane RATE-1 part A — 20261106112244_AddFarmRates.
        "p_user_select_farm_rates",
        // (lane PRV's p_user_select_record_audience_members is not here since fix pass 1, L2: its holder arm is the
        // registrant alone, so it carries no "m.status = 3" predicate to count.)
    ];

    /// <summary>(user-scoped DATA policies still testing NOT IN (5,6), those testing status = 3) —
    /// read as superuser from the deparsed text, the farms + memberships relationship policies excluded.</summary>
    private async Task<(int Open, int ActiveOnly)> CountDataPolicyPredicatesAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        const string scope = """
            FROM pg_policies WHERE schemaname = 'ssf' AND policyname LIKE 'p\_user\_select\_%'
              AND policyname NOT IN ('p_user_select_farms', 'p_user_select_memberships')
            """;
        var open = (await StringListAsync(db, $"SELECT policyname {scope} AND coalesce(qual, '') LIKE '%<> ALL (ARRAY[5, 6])%'")).Count;
        var active = (await StringListAsync(db, $"SELECT policyname {scope} AND coalesce(qual, '') LIKE '%(m.status = 3)%'")).Count;
        return (open, active);
    }

    private async Task MigrateShramSafalToAsync(string? targetMigration)
    {
        var opts = new DbContextOptionsBuilder<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>()
            .UseNpgsql(_superuserConn).Options;
        await using var ctx = new ShramSafal.Infrastructure.Persistence.ShramSafalDbContext(opts);
        if (targetMigration is null)
        {
            await ctx.Database.MigrateAsync();
        }
        else
        {
            await ctx.Database.GetService<Microsoft.EntityFrameworkCore.Migrations.IMigrator>().MigrateAsync(targetMigration);
        }
    }

    private sealed record RowCounts(long Farms, long Plots, long CostEntries);

    private sealed record PushOutcome(string Status, string? ErrorCode, string? ErrorMessage);

    private static void AssertCarriesNothingOfTheFarm(string pullBody, string because)
    {
        pullBody.Should().NotContain(FarmName, because)
            .And.NotContain(Farm.ToString(), because)
            .And.NotContain(PlotName, because)
            .And.NotContain(SecretCost, because)
            .And.NotContain(SecretAmount, because);
    }

    private async Task JoinAndExpectPendingAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shramsafal/join/by-code", who, new { farmCode = Code });
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
        (await SeatStatusesAsync(who)).Should().Contain(2);
    }

    private async Task<string> PullAsync(Guid who)
    {
        using var response = await GetAsync("/sync/pull?since=0", who);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return body;
    }

    private async Task<PushOutcome> PushCostAsync(Guid who, Guid costEntryId, string requestId)
    {
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    clientCommandId = requestId,
                    mutationType = "add_cost_entry",
                    payload = new Dictionary<string, object?>
                    {
                        ["costEntryId"] = costEntryId,
                        ["farmId"] = Farm,
                        ["categoryId"] = "seeds",
                        ["description"] = "pushed by a probe",
                        ["amount"] = 300m,
                        ["currencyCode"] = "INR",
                        ["entryDate"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                    },
                },
            },
        };

        using var response = await SendAsync(HttpMethod.Post, "/sync/push", who, request);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var result = doc.RootElement.GetProperty("results").EnumerateArray().Single();
        return new PushOutcome(
            result.GetProperty("status").GetString()!,
            result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null,
            result.TryGetProperty("errorMessage", out var msg) && msg.ValueKind == JsonValueKind.String ? msg.GetString() : null);
    }

    private Task<HttpResponseMessage> GetAsync(string url, Guid who) => SendAsync(HttpMethod.Get, url, who, body: null);

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid who, object? body)
    {
        var request = new HttpRequestMessage(method, url);
        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        request.Headers.Add("X-Test-UserId", who.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-pendingjoin", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"pendingjoin-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph (Npgsql + TenantConnectionInterceptor, pipeline-wrapped
        // handlers, the real tenant scopes)...
        builder.Services.AddShramSafalApi(builder.Configuration);
        // ...with subscriptions taken out of the question (see the class summary).
        builder.Services.AddScoped<IEntitlementPolicy, AllowAllEntitlementPolicy>();

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<RowCounts> VisibleRowsAsync(Guid who)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ExecAsync(db, "SELECT set_config('agrisync.user_id', @v, true)", ("v", who.ToString()));
        await ExecAsync(db, "SELECT set_config('agrisync.farm_id', @v, true)", ("v", Guid.Empty.ToString()));

        var farms = await CountAsync(db, "SELECT count(*) FROM ssf.farms WHERE \"Id\" = @f");
        var plots = await CountAsync(db, "SELECT count(*) FROM ssf.plots WHERE farm_id = @f");
        var costs = await CountAsync(db, "SELECT count(*) FROM ssf.cost_entries WHERE farm_id = @f");
        await tx.RollbackAsync();
        return new RowCounts(farms, plots, costs);
    }

    private static async Task<long> CountAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("f", Farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<List<int>> SeatStatusesAsync(Guid who)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u AND joined_via = 4 ORDER BY status";
        cmd.Parameters.AddWithValue("f", Farm);
        cmd.Parameters.AddWithValue("u", who);
        var statuses = new List<int>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            statuses.Add(reader.GetInt32(0));
        }

        return statuses;
    }

    private async Task<long> MigrationDownAuditRowsAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT count(*) FROM ssf.audit_events
            WHERE farm_id = @f AND action = 'MemberJoinRequestEnded' AND payload LIKE '%migration_down%'
            """;
        cmd.Parameters.AddWithValue("f", Farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task SetSeatStatusAsync(Guid who, int status)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db,
            "UPDATE ssf.farm_memberships SET status = @s, modified_at_utc = NOW() WHERE farm_id = @f AND user_id = @u AND status = 2",
            ("s", status), ("f", Farm), ("u", who));
    }

    private async Task<bool> CostRowExistsAsync(Guid costEntryId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", costEntryId);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync()) > 0;
    }

    private static async Task<List<string>> StringListAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var rows = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(reader.GetString(0));
        }

        return rows;
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        superOrBypass.Should().BeFalse(
            "doctrine E3 - a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedSeatAsync(NpgsqlConnection db, Guid userId, string role, int status)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status, 2);
            """,
            ("id", Guid.NewGuid()), ("farm", Farm), ("user", userId), ("role", role),
            ("account", Account), ("status", status));

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

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
