// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2 + AC5)
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
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — <b>the PRIMARY owner's decisions about a person
/// are real</b> (founder D-22, 26 Oct: only he decides; a co-owner gets 403 for every decision;
/// co-owner / family is not given in step 2): approve (choosing the role), decline, pause,
/// restore, remove — end to end over the
/// REAL production pipeline (TenantTransactionMiddleware, the pipeline-wrapped
/// <c>ManageMembershipHandler</c>, the real tenant scopes) against real Postgres as the
/// non-superuser <c>agrisync_app</c>.
///
/// <para>Each decision is checked by what the person can then actually READ and WRITE (the next
/// <c>/sync/pull</c>, a pushed cost, a REST farm door) — not by the status column alone — and by the
/// rows read back as superuser (role, status, stored permissions, who decided, the reason) and the
/// ONE audit row each real change writes. Every refusal is paired with a control that succeeds.</para>
///
/// <para>Before step 2 a typed farm code made a PendingApproval seat that no route could answer;
/// SEC-2: a paused person could leave and re-scan the farm QR for a fresh Active seat.</para>
///
/// <para>Doctrine E3 — vacuity guard FIRST in every fact. One substitution, as in
/// <c>PendingJoinRequestAccessRealPostgresTests</c>: <see cref="IEntitlementPolicy"/> is allow-all
/// (subscriptions are not under test).</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed partial class MembershipLifecycleRoutesRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    /// <summary>The test output, for the other part of this class (the access-change and SEC-2
    /// withdraw facts in <c>MembershipLifecycleRoutesRealPostgresTests.Access.cs</c>).</summary>
    private ITestOutputHelper Output => output;

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private const string Code = "M7K2QP";
    private const string FarmName = "Probe Lifecycle Mala";
    private const string PlotName = "Probe Lifecycle Plot";
    private const string SecretCost = "PROBE-LIFECYCLE-SECRET-COST";

    private static readonly Guid Farm = Guid.Parse("e2f30001-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("e2f30001-0000-0000-0000-0000000000c1");
    private static readonly Guid Owner = Guid.Parse("e2f30001-0000-0000-0000-0000000000a1");
    private static readonly Guid Family = Guid.Parse("e2f30001-0000-0000-0000-0000000000a2");
    private static readonly Guid Family2 = Guid.Parse("e2f30001-0000-0000-0000-0000000000a3");
    private static readonly Guid Worker = Guid.Parse("e2f30001-0000-0000-0000-0000000000b1");
    private static readonly Guid Worker2 = Guid.Parse("e2f30001-0000-0000-0000-0000000000b2");
    private static readonly Guid Worker3 = Guid.Parse("e2f30001-0000-0000-0000-0000000000b3");
    private static readonly Guid Joiner = Guid.Parse("e2f30001-0000-0000-0000-0000000000e1");
    private static readonly Guid Stranger = Guid.Parse("e2f30001-0000-0000-0000-0000000000e9");
    private static readonly Guid Plot = Guid.Parse("e2f30001-0000-0000-0000-0000000000d1");
    private static readonly Guid SeededCost = Guid.Parse("e2f30001-0000-0000-0000-0000000000d2");

    // M-7: the joiner's account phone (public.users). Only its last four digits may leave the server.
    private const string JoinerPhone = "9876504321";
    private const string JoinerPhoneLast4 = "4321";

    // Farm G: the registrant has NO seat row; P2 is its only Active primary owner SEAT (not the
    // registrant, so he decides nothing — verifier SEC-MU2-6); WorkerG is a plain worker.
    private static readonly Guid FarmG = Guid.Parse("e2f30001-0000-0000-0000-0000000001f1");
    private static readonly Guid AccountG = Guid.Parse("e2f30001-0000-0000-0000-0000000001c1");
    private static readonly Guid RegistrantG = Guid.Parse("e2f30001-0000-0000-0000-0000000001a1");
    private static readonly Guid SecondPrimaryG = Guid.Parse("e2f30001-0000-0000-0000-0000000001a2");
    private static readonly Guid WorkerG = Guid.Parse("e2f30001-0000-0000-0000-0000000001b1");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_lifecycle_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Planted as SUPERUSER: the plant never depends on the code under test.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            // HARNESS PARITY (as PendingJoinRequestAccessRealPostgresTests): the pull's operator
            // directory reads public.users, a grant provisioned outside the migration chain.
            await ExecAsync(raw, "GRANT USAGE ON SCHEMA public TO agrisync_app; GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");
            await SeedFarmAsync(raw, Farm, FarmName, Owner, Account, Code);
            await SeedFarmAsync(raw, FarmG, "Probe Farm G", RegistrantG, AccountG, "G7K2QP");
            await SeedSeatAsync(raw, Farm, Account, Owner, "PrimaryOwner", 3);
            await SeedSeatAsync(raw, Farm, Account, Family, "SecondaryOwner", 3);
            await SeedSeatAsync(raw, Farm, Account, Family2, "SecondaryOwner", 3);
            await SeedSeatAsync(raw, Farm, Account, Worker, "Worker", 3);
            await SeedSeatAsync(raw, Farm, Account, Worker2, "Worker", 3);
            await SeedSeatAsync(raw, Farm, Account, Worker3, "Worker", 3);
            await SeedSeatAsync(raw, FarmG, AccountG, SecondPrimaryG, "PrimaryOwner", 3);
            await SeedSeatAsync(raw, FarmG, AccountG, WorkerG, "Worker", 3);
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
                INSERT INTO ssf.cost_entries ("Id", farm_id, plot_id, description, amount, currency_code, entry_date, created_by_user_id,
                                              created_at_utc, modified_at_utc, source, model_version, prompt_version, category_id)
                VALUES (@cost, @farm, @id, @desc, 4321, 'INR', CURRENT_DATE, @owner, NOW(), NOW(), 'manual', 'unknown', 'unknown', 'other');
                """,
                ("id", Plot), ("farm", Farm), ("name", PlotName), ("desc", SecretCost), ("owner", Owner), ("cost", SeededCost));
            await ExecAsync(raw, """
                INSERT INTO public.users
                    ("Id", phone, display_name, password_hash, credential_created_at_utc,
                     created_at_utc, is_active, auth_mode, preferred_language)
                VALUES (@id, @phone, 'सुनील', 'x', NOW(), NOW(), TRUE, 0, 'mr');
                """,
                ("id", Joiner), ("phone", JoinerPhone));
            await SeedCropCycleAsync(raw);
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
            await ExecAsync(admin, "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()", ("db", _scratchDbName));
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

    /// <summary>The primary owner's two choices in step 2 (founder D-22, 26 Oct): the seat is EXACTLY
    /// what he chose, the person reads the farm, records a purchase (every Active member may —
    /// alignment M-5), and the audit row names the primary owner as the actor.</summary>
    [Theory]
    [InlineData("Worker", false)]
    [InlineData("Mukadam", true)]
    public async Task The_primary_owner_approves_a_typed_code_request_as_he_chooses_and_the_seat_is_exactly_that(
        string role, bool grantLabour)
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);
        AssertNothingOfTheFarm(await PullAsync(Joiner), "arrange: a waiting request reads nothing");

        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Joiner}/approve", Owner,
            new { role, grantLabour });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        using (var doc = JsonDocument.Parse(text))
        {
            doc.RootElement.GetProperty("role").GetString().Should().Be(role);
            doc.RootElement.GetProperty("status").GetString().Should().Be("Active");
            doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean().Should().Be(grantLabour);
            // A label grants no power (D-22); the one हजेरी व पक्कं switch is हजेरी + confirm records (2b).
            doc.RootElement.GetProperty("permissions").EnumerateArray().Select(p => p.GetString())
                .Should().Equal(grantLabour ? new[] { "ConfirmRecords" } : Array.Empty<string>());
            doc.RootElement.GetProperty("authorities").EnumerateArray().Select(a => a.GetProperty("name").GetString())
                .Should().BeEquivalentTo(grantLabour ? new[] { "TakeAttendance", "ConfirmRecords" } : Array.Empty<string>());
            doc.RootElement.GetProperty("phoneLast4").GetString().Should().Be(JoinerPhoneLast4, "M-7: who is really asking");
            doc.RootElement.GetProperty("approvedByOwner").GetBoolean().Should().BeTrue();
        }

        var seat = await LiveSeatAsync(Farm, Joiner);
        seat.Should().NotBeNull();
        seat!.Role.Should().Be(role);
        seat.Status.Should().Be(3);
        seat.Permissions.Should().Be(grantLabour ? 128 : null, "nothing beyond what he chose: the switch's confirm-records bit (2b)");
        seat.LabourGrant.Should().Be(grantLabour, "only काम + हजेरी stores the हजेरी व पक्कं grant");
        seat.ApprovedBy.Should().Be(Owner);
        seat.ChangedBy.Should().Be(Owner);
        seat.AccessChangedAt.Should().NotBeNull("step 4 re-sends a farm whose access changed after the phone's cursor");

        var audits = await AuditPayloadsAsync(Farm, "MemberApproved");
        audits.Should().ContainSingle();
        audits[0].GetProperty("fromStatus").GetString().Should().Be("PendingApproval");
        audits[0].GetProperty("toRole").GetString().Should().Be(role);
        (await AuditActorRolesAsync(Farm)).Should().Equal("primaryowner");

        // Access is real: the approved person now reads the farm…
        (await PullAsync(Joiner)).Should().Contain(FarmName).And.Contain(PlotName);
        // …and records a purchase (open to every Active member; correcting money is not).
        var cost = Guid.NewGuid();
        var pushed = await PushCostAsync(Joiner, cost, $"cost-{role}");
        output.WriteLine($"[EVIDENCE] approved {role}: add_cost_entry={pushed.Status} {pushed.ErrorCode}");
        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode} {pushed.ErrorMessage}");
        (await CostRowExistsAsync(cost)).Should().BeTrue();
    }

    /// <summary>M-7 / M-8: the owner's roster shows the last four phone digits beside the
    /// self-typed name, and how each person came in (asked by code and approved, or not).</summary>
    [Fact]
    public async Task The_owners_roster_shows_the_phone_tail_and_how_a_person_came_in()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);

        var waiting = await RosterRowAsync(Joiner);
        waiting.GetProperty("status").GetString().Should().Be("PendingApproval");
        waiting.GetProperty("phoneLast4").GetString().Should().Be(JoinerPhoneLast4);
        waiting.GetProperty("joinedVia").GetString().Should().Be("SelfJoin");
        waiting.GetProperty("approvedByOwner").GetBoolean().Should().BeFalse();
        (await RosterTextAsync()).Should().NotContain(JoinerPhone, "only the last four digits ever leave the server");

        await DecideOkAsync(HttpMethod.Post, $"{Joiner}/approve", Owner, new { role = "Worker" });
        (await RosterRowAsync(Joiner)).GetProperty("approvedByOwner").GetBoolean().Should().BeTrue();

        // A seeded seat with no directory row: no phone tail (never invented).
        var worker = await RosterRowAsync(Worker);
        worker.TryGetProperty("phoneLast4", out var tail).Should().BeTrue();
        tail.ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Decline_ends_the_request_with_the_owners_reason_once_and_the_joiner_reads_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);

        foreach (var attempt in new[] { 1, 2 })
        {
            using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Joiner}/decline", Owner, new { reason = "  ओळखत नाही  " });
            var text = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"attempt {attempt}: {text}");
            using var doc = JsonDocument.Parse(text);
            doc.RootElement.GetProperty("status").GetString().Should().Be("Revoked");
        }

        (await LiveSeatAsync(Farm, Joiner)).Should().BeNull("a declined request is ended");
        var ended = await LatestSeatAsync(Farm, Joiner);
        ended!.Status.Should().Be(5);
        ended.Reason.Should().Be("ओळखत नाही");
        ended.ChangedBy.Should().Be(Owner);
        (await AuditPayloadsAsync(Farm, "MemberDeclined")).Should().ContainSingle("a re-sent decline is not a second decision");
        AssertNothingOfTheFarm(await PullAsync(Joiner), "a declined person reads nothing");
    }

    [Fact]
    public async Task A_paused_person_reads_and_writes_nothing_is_told_why_and_restore_gives_it_back()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // CONTROL: the (legacy) co-owner reads the farm and records a purchase before the pause.
        // lane MU-3 (founder D-22 / D-26): a bare सहमालक label holds no see money, so he reads the farm's
        // work (its plot), never its money — in either direction of the pause.
        var beforePause = await PullAsync(Family);
        beforePause.Should().Contain(PlotName).And.NotContain(SecretCost);
        (await PushCostAsync(Family, Guid.NewGuid(), "before-pause")).Status.Should().Be("applied");

        using (var pause = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Family}/suspend", Owner, new { reason = "हिशोब तपासायचा आहे" }))
        {
            var text = await pause.Content.ReadAsStringAsync();
            pause.StatusCode.Should().Be(HttpStatusCode.OK, text);
            using var doc = JsonDocument.Parse(text);
            doc.RootElement.GetProperty("status").GetString().Should().Be("Suspended");
            doc.RootElement.GetProperty("statusReason").GetString().Should().Be("हिशोब तपासायचा आहे");
            doc.RootElement.GetProperty("permissions").GetArrayLength().Should().Be(0, "a paused seat grants nothing");
        }

        AssertNothingOfTheFarm(await PullAsync(Family), "a paused seat reads nothing");
        var refusedCost = Guid.NewGuid();
        var refused = await PushCostAsync(Family, refusedCost, "while-paused");
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().EndWith("Forbidden");
        (await CostRowExistsAsync(refusedCost)).Should().BeFalse();
        using (var door = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{Farm}", Family))
        {
            door.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        // The person is told THAT and WHY (farms/mine with includePending).
        using (var mine = await SendAsync(HttpMethod.Get, "/shramsafal/farms/mine?includePending=true", Family))
        {
            var text = await mine.Content.ReadAsStringAsync();
            mine.StatusCode.Should().Be(HttpStatusCode.OK, text);
            using var doc = JsonDocument.Parse(text);
            var row = doc.RootElement.EnumerateArray().Single(f => f.GetProperty("farmId").GetGuid() == Farm);
            row.GetProperty("status").GetString().Should().Be("Suspended");
            row.GetProperty("statusReason").GetString().Should().Be("हिशोब तपासायचा आहे");
        }

        using (var restore = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Family}/restore", Owner))
        {
            var text = await restore.Content.ReadAsStringAsync();
            restore.StatusCode.Should().Be(HttpStatusCode.OK, text);
        }

        (await PullAsync(Family)).Should().Contain(PlotName, "restore gives the reads back").And.NotContain(SecretCost);
        (await PushCostAsync(Family, Guid.NewGuid(), "after-restore")).Status.Should().Be("applied");
        var seat = await LiveSeatAsync(Farm, Family);
        seat!.Status.Should().Be(3);
        seat.Reason.Should().BeNull("the pause reason is cleared when the person works again");

        var paused = await AuditPayloadsAsync(Farm, "MemberSuspended");
        paused.Should().ContainSingle();
        paused[0].GetProperty("reason").GetString().Should().Be("हिशोब तपासायचा आहे");
        (await AuditPayloadsAsync(Farm, "MemberRestored")).Should().ContainSingle();
    }

    [Fact]
    public async Task Removing_a_person_ends_the_seat_and_a_resent_removal_writes_no_second_history_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await PullAsync(Worker)).Should().Contain(FarmName, "arrange: an Active worker reads the farm");

        foreach (var attempt in new[] { 1, 2 })
        {
            using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Worker}/remove", Owner, new { reason = "काम सोडलं" });
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"attempt {attempt}: {await response.Content.ReadAsStringAsync()}");
        }

        (await LiveSeatAsync(Farm, Worker)).Should().BeNull();
        (await LatestSeatAsync(Farm, Worker))!.Reason.Should().Be("काम सोडलं");
        (await AuditPayloadsAsync(Farm, "MemberRemoved")).Should().ContainSingle();
        AssertNothingOfTheFarm(await PullAsync(Worker), "a removed person reads nothing");
    }

    [Fact]
    public async Task Nobody_acts_on_himself_or_on_the_registrant_family_is_not_given_and_a_refusal_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);

        var refusals = new (Guid Caller, string Path, object Body, HttpStatusCode Expected, string Why)[]
        {
            (Owner, $"{Owner}/suspend", new { reason = "x" }, HttpStatusCode.Forbidden, "never yourself"),
            (Owner, $"{Joiner}/approve", new { role = "SecondaryOwner" }, HttpStatusCode.BadRequest, "co-owner / family is not given in step 2 (D-22)"),
            (Owner, $"{Joiner}/approve", new { role = "PrimaryOwner" }, HttpStatusCode.BadRequest, "ownership is never handed out by an approval"),
            (Worker, $"{Worker2}/suspend", new { reason = "x" }, HttpStatusCode.Forbidden, "a worker decides nothing"),
            (Stranger, $"{Worker}/suspend", new { reason = "x" }, HttpStatusCode.Forbidden, "a stranger decides nothing"),
            (Owner, $"{Joiner}/restore", new { }, HttpStatusCode.Conflict, "restore needs a let-in seat, not a waiting request"),
            (Owner, $"{Joiner}/suspend", new { reason = "x" }, HttpStatusCode.Conflict, "a waiting request is declined, not paused"),
        };

        foreach (var (caller, path, body, expected, why) in refusals)
        {
            using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{path}", caller, body);
            var text = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(expected, $"{why}: {text}");
            if (expected == HttpStatusCode.Conflict)
            {
                text.Should().Contain("membership.wrong_status");
            }
        }

        using (var change = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{Farm}/memberships/{Worker}/access", Owner, new { role = "SecondaryOwner" }))
        {
            change.StatusCode.Should().Be(HttpStatusCode.BadRequest, "nobody is MOVED to co-owner either: " + await change.Content.ReadAsStringAsync());
        }

        // The registrant, on his own: a PrimaryOwner seat that is not the registrant cannot touch him.
        using (var registrant = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmG}/memberships/{RegistrantG}/suspend", SecondPrimaryG, new { reason = "x" }))
        {
            registrant.StatusCode.Should().Be(HttpStatusCode.Forbidden, "never the registrant: " + await registrant.Content.ReadAsStringAsync());
        }

        (await StatusesAsync(Farm)).Should().BeEquivalentTo(new Dictionary<Guid, int>
        {
            [Owner] = 3,
            [Family] = 3,
            [Family2] = 3,
            [Worker] = 3,
            [Worker2] = 3,
            [Worker3] = 3,
            [Joiner] = 2,
        });
        (await LiveSeatAsync(Farm, Worker))!.Role.Should().Be("Worker");
        (await DecisionAuditCountAsync(Farm)).Should().Be(0, "a refused decision is not history");
        (await DecisionAuditCountAsync(FarmG)).Should().Be(0);

        // CONTROL: the primary owner lets the same request in as a worker.
        using var ok = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Joiner}/approve", Owner, new { role = "Worker" });
        ok.StatusCode.Should().Be(HttpStatusCode.OK, await ok.Content.ReadAsStringAsync());
        (await LiveSeatAsync(Farm, Joiner))!.ApprovedBy.Should().Be(Owner);
    }

    /// <summary>M-1 (founder D-22, 26 Oct): only the PRIMARY owner decides about people. A co-owner
    /// gets 403 for every one of the six decisions — approve, decline, pause, restore, remove, change
    /// access — and nothing moves or is written. The primary owner then takes the same decisions.</summary>
    [Fact]
    public async Task A_co_owner_gets_403_for_every_decision_and_nothing_moves()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);
        await DecideOkAsync(HttpMethod.Post, $"{Worker2}/suspend", Owner, new { reason = "arrange" });
        var before = await DecisionAuditCountAsync(Farm);

        var attempts = new (HttpMethod Method, string Path, object Body)[]
        {
            (HttpMethod.Post, $"{Joiner}/approve", new { role = "Worker" }),
            (HttpMethod.Post, $"{Joiner}/decline", new { reason = "x" }),
            (HttpMethod.Post, $"{Worker}/suspend", new { reason = "x" }),
            (HttpMethod.Post, $"{Worker2}/restore", new { }),
            (HttpMethod.Post, $"{Worker}/remove", new { reason = "x" }),
            (HttpMethod.Put, $"{Worker}/access", new { role = "Mukadam", resetPermissions = true, labourGrant = true }),
            (HttpMethod.Put, $"{Worker}/access", new { permissions = new[] { "ReviewMoney" } }),
            (HttpMethod.Post, $"{Family2}/suspend", new { reason = "x" }),
        };

        foreach (var (method, path, body) in attempts)
        {
            using var response = await SendAsync(method, $"/shramsafal/farms/{Farm}/memberships/{path}", Family, body);
            var text = await response.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] co-owner {method} {path}: {(int)response.StatusCode}");
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"a co-owner decides nothing ({method} {path}): {text}");
        }

        (await StatusesAsync(Farm)).Should().BeEquivalentTo(new Dictionary<Guid, int>
        {
            [Owner] = 3,
            [Family] = 3,
            [Family2] = 3,
            [Worker] = 3,
            [Worker2] = 4,
            [Worker3] = 3,
            [Joiner] = 2,
        });
        var worker = await LiveSeatAsync(Farm, Worker);
        worker!.Role.Should().Be("Worker");
        worker.Permissions.Should().BeNull();
        worker.LabourGrant.Should().BeFalse();
        (await DecisionAuditCountAsync(Farm)).Should().Be(before, "a refused decision is not history");

        // CONTROL: the primary owner takes the same decisions.
        await DecideOkAsync(HttpMethod.Post, $"{Joiner}/approve", Owner, new { role = "Worker" });
        await DecideOkAsync(HttpMethod.Post, $"{Worker2}/restore", Owner, new { });
        await DecideOkAsync(HttpMethod.Put, $"{Worker}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });
        (await LiveSeatAsync(Farm, Worker))!.LabourGrant.Should().BeTrue();
        (await AuditActorRolesAsync(Farm)).Should().OnlyContain(r => r == "primaryowner");
    }

    [Fact]
    public async Task The_last_active_primary_owner_cannot_be_paused_or_removed()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var verb in new[] { "suspend", "remove" })
        {
            using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmG}/memberships/{SecondPrimaryG}/{verb}", RegistrantG, new { reason = "x" });
            var text = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.Conflict, $"{verb}: {text}");
            using var doc = JsonDocument.Parse(text);
            doc.RootElement.GetProperty("error").GetString().Should().Be("membership.last_owner");
        }

        (await LiveSeatAsync(FarmG, SecondPrimaryG))!.Status.Should().Be(3);
        (await DecisionAuditCountAsync(FarmG)).Should().Be(0);
    }

    /// <summary>SEC-2: once the owner has stopped a person (paused then he left, or removed), the
    /// farm QR is no way back in — his scan is a request that waits for the owner.</summary>
    [Fact]
    public async Task SEC2_a_person_the_owner_stopped_gets_a_waiting_request_not_a_fresh_seat_from_the_farm_QR()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Worker}/suspend", Owner, new { reason = "थांबा" })).EnsureSuccessStatusCode();
        using (var exit = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/self-exit", Worker))
        {
            exit.StatusCode.Should().Be(HttpStatusCode.OK, "self-exit always works, even while paused");
        }

        (await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Worker2}/remove", Owner, new { reason = "x" })).EnsureSuccessStatusCode();
        using (var exit3 = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/self-exit", Worker3))
        {
            exit3.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var (token, farmCode) = await IssueQrAsync();

        foreach (var stopped in new[] { Worker, Worker2 })
        {
            var status = await ClaimAsync(stopped, token, farmCode);
            output.WriteLine($"[EVIDENCE] stopped person {stopped} re-scanned the farm QR: {status}");
            status.Should().Be("PendingApproval", "the owner stopped him last time");
            (await LiveSeatAsync(Farm, stopped))!.Status.Should().Be(2);
            AssertNothingOfTheFarm(await PullAsync(stopped), "a waiting re-scan reads nothing");
        }

        // CONTROLS: a person who left on his own, and a newcomer, still get in by the QR at once.
        (await ClaimAsync(Worker3, token, farmCode)).Should().Be("Active");
        (await ClaimAsync(Stranger, token, farmCode)).Should().Be("Active");

        // And the owner can now answer the stopped person's request.
        using var approve = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/{Worker}/approve", Owner, new { role = "Worker" });
        approve.StatusCode.Should().Be(HttpStatusCode.OK, await approve.Content.ReadAsStringAsync());
        (await PullAsync(Worker)).Should().Contain(FarmName);
    }

    // -- Harness ----------------------------------------------------------------

    private sealed record SeatRow(string Role, int Status, int? Permissions, bool LabourGrant, Guid? ApprovedBy,
        Guid? ChangedBy, string? Reason, DateTime? AccessChangedAt);

    private sealed record PushOutcome(string Status, string? ErrorCode, string? ErrorMessage);

    private static void AssertNothingOfTheFarm(string pullBody, string because)
    {
        pullBody.Should().NotContain(FarmName, because).And.NotContain(Farm.ToString(), because)
            .And.NotContain(PlotName, because).And.NotContain(SecretCost, because);
    }

    private async Task JoinAndExpectPendingAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shramsafal/join/by-code", who, new { farmCode = Code });
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
    }

    private async Task<(string Token, string FarmCode)> IssueQrAsync()
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/invite-qr", Owner);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return (doc.RootElement.GetProperty("token").GetString()!, doc.RootElement.GetProperty("farmCode").GetString()!);
    }

    private async Task<string> ClaimAsync(Guid who, string token, string farmCode)
    {
        using var response = await SendAsync(HttpMethod.Post, "/shramsafal/join/claim", who, new { token, farmCode });
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        return doc.RootElement.GetProperty("status").GetString()!;
    }

    private async Task<string> PullAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=0", who);
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
                        ["costEntryId"] = costEntryId, ["farmId"] = Farm, ["categoryId"] = "seeds",
                        ["description"] = "pushed by a lifecycle probe", ["amount"] = 300m, ["currencyCode"] = "INR",
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

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid who, object? body = null)
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
        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-lifecycle", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"lifecycle-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph, with subscriptions taken out of the question.
        builder.Services.AddShramSafalApi(builder.Configuration);
        builder.Services.AddScoped<IEntitlementPolicy, AllowAllEntitlementPolicy>();

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();
        await app.StartAsync();
        return app;
    }

    private async Task<SeatRow?> LiveSeatAsync(Guid farm, Guid user) =>
        await SeatAsync(farm, user, "AND status NOT IN (5, 6)");

    private async Task<SeatRow?> LatestSeatAsync(Guid farm, Guid user) => await SeatAsync(farm, user, string.Empty);

    private async Task<SeatRow?> SeatAsync(Guid farm, Guid user, string filter)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            SELECT role, status, permissions, can_manage_labour_records, approved_by_user_id,
                   status_changed_by_user_id, status_reason, access_changed_at_utc
            FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u {filter}
            ORDER BY modified_at_utc DESC LIMIT 1
            """;
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync())
        {
            return null;
        }

        return new SeatRow(r.GetString(0), r.GetInt32(1), r.IsDBNull(2) ? null : r.GetInt32(2), r.GetBoolean(3),
            r.IsDBNull(4) ? null : r.GetGuid(4), r.IsDBNull(5) ? null : r.GetGuid(5),
            r.IsDBNull(6) ? null : r.GetString(6), r.IsDBNull(7) ? null : r.GetDateTime(7));
    }

    private async Task<Dictionary<Guid, int>> StatusesAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT user_id, status FROM ssf.farm_memberships WHERE farm_id = @f AND status NOT IN (5, 6)";
        cmd.Parameters.AddWithValue("f", farm);
        var map = new Dictionary<Guid, int>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            map[r.GetGuid(0)] = r.GetInt32(1);
        }

        return map;
    }

    private async Task<List<JsonElement>> AuditPayloadsAsync(Guid farm, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT payload FROM ssf.audit_events WHERE farm_id = @f AND action = @a ORDER BY occurred_at_utc";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", action);
        var rows = new List<JsonElement>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(JsonDocument.Parse(r.GetString(0)).RootElement.Clone());
        }

        return rows;
    }

    private async Task<long> DecisionAuditCountAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action IN
              ('MemberApproved','MemberDeclined','MemberSuspended','MemberRestored','MemberRemoved','MemberAccessChanged')
            """;
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
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

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(await cmd.ExecuteScalarAsync()).Should().BeFalse(
            "doctrine E3 - a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedFarmAsync(NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account, string code)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """,
            ("farm", farm), ("name", name), ("owner", owner), ("account", account), ("code", code));

    private static Task SeedSeatAsync(NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, int status)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status, 2);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", userId), ("role", role), ("account", account), ("status", status));

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
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
