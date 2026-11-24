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
        // spec plr-d10 lane BILL-1 (founder D-12) — Down() read in full: drops the two policies on ssf.cost_entry_approvals, the
        // table and the additive cost_entries.content_version column. Up() creates that table only, with its user-select policy
        // written ALREADY narrowed (m.status = 3) — see PoliciesCreatedAfterActiveOnly. No farm_memberships or
        // farm_join_requests object, no other policy. Re-Up recreates them.
        "20261106221812_AddCostEntryApprovals",
        // spec plr-d10 lane RLS-2 (F113) — Up() and Down() read in full: Up() puts day_ledgers, day_ledger_allocations,
        // log_tasks, planned_activities (and the two February *_legacy_financev2 tables, when present) under ENABLE + FORCE
        // RLS with a tenant policy each, and gives the four live tables a user-select policy written ALREADY narrowed
        // (m.status = 3) — see PoliciesCreatedAfterActiveOnly. Down() drops exactly those policies and takes the tables back
        // out of RLS. No farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched. Re-Up recreates them.
        "20261107034303_AddRlsToDayLedgersLogTasksAndPlannedActivities",
        // spec plr-d10 lane NP-1 (founder D-56, CTO call D-85) — Down() read in full: drops one CHECK and two nullable columns on
        // public.refresh_tokens (USER context; the ShramSafal migrator never reverts or re-applies it, it only shares the scratch
        // database's history table). No farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched.
        "20261107061500_AddNewPhoneQuestion",
        // spec plr-d10 lane IT1c (D-107 B / D-108 3) - Up() and Down() read in full: Up() creates the five ssf.input_library_* tables,
        // seeds source 1, puts them under ENABLE + FORCE RLS in the cost_categories shape (global read, deny-write for the app
        // role) and grants SELECT on them to the app role. It touches no farm_memberships or farm_join_requests object, no ssf.farms policy, no seat, and creates no
        // p_user_select_* policy. Down() drops only those five tables. Re-Up recreates and re-seeds them.
        "20261107080000_AddInputLibrary",
        // spec dfes-input-truth-and-mix-check-2026-11-06 lane IT2 (founders D-92 / D-95) - Up() and Down() read in full: Up() creates
        // ssf.input_identity_assertions only, FORCE-RLS, with its user-select policy written ALREADY narrowed (m.status = 3) - see
        // PoliciesCreatedAfterActiveOnly. Down() drops its two policies and the table. No farm_memberships or farm_join_requests
        // object, no ssf.farms policy, no seat touched. Re-Up recreates them.
        "20261108090000_AddInputIdentityAssertions",
        // spec plr-d10 lane SCH-A (founder D-74) - Up() and Down() read in full: Up() adds two tables (schedule_checks,
        // schedule_template_stages, neither under RLS nor farm-owned) and nullable columns on schedule_templates and
        // template_activities; no farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched, no
        // p_user_select_* policy created. Down() refuses while a check exists, else drops only what Up() added.
        "20261108120000_AddScheduleCheckAndStoredDays",
        // spec plr-d10 lane L8b-1F (founders D-82 / D-91) - Up() and Down() read in full: Up() adds two nullable columns and their CHECKs
        // to ssf.schedule_subscriptions only; no farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched,
        // no p_user_select_* policy created. Down() drops only what Up() added.
        "20261108150000_AddScheduleSubscriptionOriginAndCheck",
        // spec plr-d10 lane L8c-1 (founder D-24c) - Up() and Down() read in full: Up() creates ssf.planned_work and
        // ssf.planned_work_plots with their own farm-scoped policies only; no farm_memberships or farm_join_requests object, no
        // ssf.farms policy, no seat touched, no p_user_select_* policy on an existing table. Down() drops the policies and the two tables.
        "20261108180000_AddPlannedWork",
        // spec plr-d10 lane L8b-3 (founder D-74) - Up() and Down() read in full: ssf.schedule_subscriptions only (a nullable slot column, its
        // back-fill, two CHECKs, the swap of one partial unique index for two). No farm_memberships or farm_join_requests object, no policy, no
        // grant, no seat touched. Down() refuses while a plot-season follows two or more schedules (this proof's data has none), else drops what Up() added.
        "20261109090000_AllowThreePlusOneSchedulesPerPlot",
        // spec plr-d10 lane SCH-OWN (founders D-74 / D-82) - Up() and Down() read in full: ssf.schedule_templates only (a nullable own-farm column, a partial
        // index, a foreign key to ssf.farms, the swap of one partial unique index for two). No farm_memberships or farm_join_requests object, no policy, no
        // grant, no seat touched. Down() refuses while a schedule row names a farm (this proof's data has none), else drops what Up() added.
        "20261109120000_AddScheduleTemplateOwnFarm",
        // spec plr-d10 lane SCH-OWN-c (founder D-137) - Up() and Down() read in full: ssf.schedule_templates only (a nullable owner_user_id and four tag
        // columns, a conversion of SOWN-a's own-farm rows to their farm's owner, the re-key of two partial unique indexes, the drop of SOWN-a's own-farm column
        // with its foreign key and index). No farm_memberships or farm_join_requests object, no policy, no grant, no seat touched. Down() refuses while a row has an owner or a tag
        // (this proof's data has none), else rebuilds SOWN-a's shape and drops what Up() added.
        "20261110120000_ScheduleTemplateOwnerAndMadeFor",
        // ── Reviewed 2026-11-11 (spec: plr-d10 lane REM-1, founder D-78 / D-84 = 1); Up() and Down() read in full: Up() adds one nullable column to
        //    ssf.planned_work, creates ssf.farm_reminder_settings and ssf.reminder_always_show (two policies and one grant each, to agrisync_app); Down() drops the
        //    four policies, the two tables and the column - only what Up() added. No farm_memberships or farm_join_requests object, no policy of theirs, no grant of
        //    theirs, no seat touched. Safe mid-proof.
        "20261111090000_AddReminderSettings",
        // spec plr-d10 lane ATT-W (R29) - Up() and Down() read in full: Up() creates ssf.schedule_step_moves only, FORCE-RLS, with its user-select policy
        // written ALREADY narrowed (m.status = 3) - see PoliciesCreatedAfterActiveOnly. No farm_memberships or farm_join_requests object, no ssf.farms
        // policy, no seat touched. Down() drops its two policies and the table. Re-Up recreates them.
        "20261113090000_AddScheduleStepMoves",
        // spec plr-d10 lane CMP-D3 - Up() and Down() read in full: Up() creates ssf.log_practice_reasons only, FORCE-RLS, with its tenant policy alone (NO user-select
        // policy: every reader opens the farm's scope, so nothing here reads farm_memberships). No farm_memberships or farm_join_requests object, no
        // ssf.farms policy, no seat touched. Down() drops its policy and the table. Re-Up recreates it.
        "20261113120000_AddLogPracticeReasons",
        // spec plr-d10 lane SCH-ID-S - Up() and Down() read in full: Up() creates ssf.pictures only, FORCE-RLS, with four policies on agrisync.user_id (a
        // picture belongs to no farm, so NO p_user_select_* policy and nothing here reads farm_memberships). No farm_memberships or farm_join_requests
        // object, no ssf.farms policy, no seat touched. Down() raises while a picture row exists, else drops its policies and the table. Re-Up recreates them.
        "20261117041736_AddPictures",
        // spec: facts-card-input-truth-2026-11-19 (FACTS lane, merged 2026-11-20) - Up() and Down() read in full: Up() adds two nullable columns to
        // ssf.application_input_items and creates ssf.input_use_facts and ssf.input_use_ingredients only, FORCE-RLS, each with a tenant policy and a
        // user-select policy; the user-select policies read ssf.farm_memberships with m.status = 3 (Active seats only, the predicate the active-only migration
        // set) and never read farm_join_requests. No audit_events object is touched, no ssf.farms policy, no seat, no grant on an existing table. Down() is DATA-DESTROYING by design: it drops the four policies, the two derived tables (rebuildable from
        // the records) and the two stated columns (method, carrier water), so a rollback loses those two stated fields; the deploy rollback plan relies on the
        // snapshot, not on Down(). Re-Up recreates all of it.
        "20261119105639_AddInputUseFacts",
        // spec: plr-d10 lane GRP-1a (owner-named groups of plots, 2026-11-20) - Up() and Down() read in full: Up() adds ONE nullable column (group_name, varchar(30)) to
        // ssf.plots and nothing else. No farm_memberships or farm_join_requests object, no ssf.farms policy, no policy of any table, no grant, no seat touched (the
        // plots policies are per row on farm_id and a new column needs nothing). Down() is DATA-DESTROYING by design: it drops that one column, so a rollback loses every
        // group name typed since (the plots stay); the deploy rollback plan relies on the snapshot, not on Down(). Re-Up recreates the column empty.
        "20261120111737_AddPlotGroupName",
        // spec: plr-d10 lane DFES-Q (question context, reviewed by the CTO 2026-11-23 for RC1) - Up() and Down() read in full: Up() adds nine nullable
        // columns and one index to ssf.question_events, and creates ssf.question_photo_checks only, FORCE-RLS, with its tenant policy alone (NO user-select
        // policy, so nothing here reads farm_memberships). No farm_memberships or farm_join_requests object, no ssf.farms policy, no seat touched. Down()
        // drops the policy, the new table, the index and the nine columns: it destroys only data this migration created. Re-Up recreates them empty.
        "20261121032701_AddDfesQuestionContext",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2) - Up() and Down() read in full: Up() creates ssf.schedule_tasks and ssf.schedule_challenges (FORCE RLS,
        // their own tenant columns, a tenant trigger, SELECT + INSERT for the app role) and adds two nullable columns to ssf.schedule_template_stages. Its two new
        // policies READ ssf.farms and ssf.farm_memberships, in the Active-only form (m.status = 3) from birth; it alters no existing policy, no farm_memberships or
        // farm_join_requests object, no seat. Down() refuses while any row of the new format exists (none does in this proof) and otherwise drops exactly what Up()
        // added. Safe mid-proof.
        "20261123020241_AddScheduleTaskFormat",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - Up() and Down() read in full: Up() creates ssf.own_schedule_items and
        // ssf.own_schedule_item_revisions (FORCE RLS on their own farm_id, an owner/place trigger). Their read policies READ ssf.farms and ssf.farm_memberships in the
        // Active-only form (m.status = 3) from birth; the trigger reads ssf.farms and ssf.crop_cycles. It alters no existing policy, no farm_memberships or
        // farm_join_requests object, no seat. Down() refuses while any own work exists (none does in this proof) and otherwise drops exactly what Up() added. Safe mid-proof.
        "20261123040137_AddOwnScheduleItems",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - Up() and Down() read in full: Up() adds nullable link columns, partial indexes, CHECKs and a
        // link trigger to ssf.planned_work (the trigger reads ssf.own_schedule_items), and creates ssf.schedule_task_events (FORCE RLS on its own farm_id, a place
        // trigger reading ssf.own_schedule_items); its read policy READS ssf.farms and ssf.farm_memberships in the Active-only form (m.status = 3) from birth. It alters
        // no existing policy, no farm_memberships or farm_join_requests object, no seat. Down() refuses while any linked plan or answer exists (none does in this
        // proof) and otherwise drops exactly what Up() added. Safe mid-proof.
        "20261123071136_AddScheduleFeed",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 7) - Up() and Down() read in full: four NULLABLE columns on ssf.schedule_templates and ssf.schedule_checks
        // and one index. No policy is created or altered (no farm_memberships or farm_join_requests object, no seat). Down() refuses while any of the columns holds a
        // value (none does in this proof) and otherwise drops exactly what Up() added. Safe mid-proof.
        "20261123113122_AddScheduleReferenceFormat",
        // spec: voice-instant-phase-a-2026-11-23 - Up() and Down() read in full: each is ONE data-only UPDATE of ssf.ai_provider_configs
        // (transcriber_provider, structurer_provider, modified_at_utc). No table, policy, grant or seat; safe to revert and re-apply mid-proof.
        "20261124090000_SetVoiceProvidersToSarvam",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 9) - Up() and Down() read in full: Up() creates ssf.own_schedule_item_origins (FORCE RLS on its own
        // farm_id, the existing owner/place trigger). Its read policy READS ssf.farms and ssf.farm_memberships in the Active-only form (m.status = 3) from birth. It alters
        // no existing policy, no farm_memberships or farm_join_requests object, no seat. Down() refuses while any origin exists (none does in this proof) and otherwise
        // drops exactly what Up() added. Safe mid-proof.
        "20261124124837_AddOwnScheduleItemOrigins",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 11) - Up() and Down() read in full: Up() creates ssf.own_schedule_season_carries (FORCE RLS on its own
        // farm_id, the existing owner/place trigger). Its read policy READS ssf.farms and ssf.farm_memberships in the Active-only form (m.status = 3) from birth. It alters
        // no existing policy, no farm_memberships or farm_join_requests object, no seat. Down() refuses while any row exists (none does in this proof) and otherwise
        // drops exactly what Up() added. Safe mid-proof.
        "20261124220806_AddOwnScheduleSeasonCarries",
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
        // spec plr-d10 lane BILL-1 — 20261106221812_AddCostEntryApprovals.
        "p_user_select_cost_entry_approvals",
        // spec plr-d10 lane RLS-2 — 20261107034303_AddRlsToDayLedgersLogTasksAndPlannedActivities. Their tables predate the
        // Active-only migration (as schedule_subscriptions'); each policy is dropped by its OWN migration's Down() on the way back.
        "p_user_select_day_ledgers",
        "p_user_select_day_ledger_allocations",
        "p_user_select_log_tasks",
        "p_user_select_planned_activities",
        // spec dfes-input-truth-and-mix-check-2026-11-06 lane IT2 - 20261108090000_AddInputIdentityAssertions.
        "p_user_select_input_identity_assertions",
        // spec plr-d10 lane L8c-1 - 20261108180000_AddPlannedWork (two tables, each born with its Active-member read policy).
        "p_user_select_planned_work",
        "p_user_select_planned_work_plots",
        // spec plr-d10 lane REM-1 - 20261111090000_AddReminderSettings (two tables, each born with its Active-member read policy).
        "p_user_select_farm_reminder_settings",
        "p_user_select_reminder_always_show",
        // spec plr-d10 lane ATT-W - 20261113090000_AddScheduleStepMoves (born with its Active-member read policy).
        "p_user_select_schedule_step_moves",
        // (lane PRV's p_user_select_record_audience_members is not here since fix pass 1, L2: its holder arm is the
        // registrant alone, so it carries no "m.status = 3" predicate to count.)
        // spec: facts-card-input-truth-2026-11-19 (FACTS lane) - 20261119105639_AddInputUseFacts creates ssf.input_use_facts and ssf.input_use_ingredients,
        // each with a p_user_select_* policy written ALREADY narrowed (m.status = 3). Down() drops both tables with their policies.
        "p_user_select_input_use_facts",
        "p_user_select_input_use_ingredients",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3) - 20261123040137_AddOwnScheduleItems creates ssf.own_schedule_items and
        // ssf.own_schedule_item_revisions, each with a p_user_select_* policy written ALREADY narrowed (m.status = 3). Down() drops both tables with their policies.
        "p_user_select_own_schedule_items",
        "p_user_select_own_schedule_item_revisions",
        // slice 9: 20261124124837_AddOwnScheduleItemOrigins creates ssf.own_schedule_item_origins with this policy ALREADY narrowed (m.status = 3). Down() drops the table with it.
        "p_user_select_own_schedule_item_origins",
        // slice 11: 20261124220806_AddOwnScheduleSeasonCarries creates ssf.own_schedule_season_carries with this policy ALREADY narrowed (m.status = 3). Down() drops the table with it.
        "p_user_select_own_schedule_season_carries",
        // spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5) - 20261123071136_AddScheduleFeed creates ssf.schedule_task_events with a p_user_select_* policy
        // written ALREADY narrowed (m.status = 3). Down() drops the table with its policy.
        "p_user_select_schedule_task_events",
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
