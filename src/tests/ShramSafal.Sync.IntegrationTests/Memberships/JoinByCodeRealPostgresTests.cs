// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Composition;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, AC1) — <b>typing a farm's code asks to join
/// it, and only asks</b>: <c>POST /shramsafal/join/by-code</c> end to end, over the REAL
/// production pipeline (TenantTransactionMiddleware, the pipeline-wrapped handler, the real
/// <c>JoinCodeTenantScope</c>) against real Postgres as the non-superuser <c>agrisync_app</c>.
///
/// <para>What this suite pins, each by reading the rows back as superuser (the plant and the
/// read-back never depend on the code under test):</para>
/// <list type="bullet">
/// <item>a valid code makes EXACTLY ONE seat: <c>PendingApproval</c>, the <c>Worker</c>
/// placeholder, <c>SelfJoin</c>, no invitation — and a role sent in the body changes nothing;</item>
/// <item>every wrong code (unknown, malformed, blank, one character off) gets the byte-identical
/// 404 <c>{"error":"join.code_unknown"}</c>, naming no farm, writing nothing;</item>
/// <item>a repeat, a double tap, an existing member and the owner write nothing new and get the
/// seat's REAL status back;</item>
/// <item>a Revoked or Exited person gets a fresh PendingApproval request — never Active;</item>
/// <item>at the database level the new read policy is a SELECT-only door that opens for exactly
/// one farm, and only to a transaction that sets that farm's code;</item>
/// <item>the startup backfill gives every code-less farm a code and is idempotent;</item>
/// <item>the route carries the <c>"join"</c> rate limit and the 11th try in the window is a 429
/// whose <c>Retry-After</c> is the policy's own window — this host registers the limiter through
/// the SAME <c>RateLimitingConfig.AddAgriSyncRateLimiting</c> <c>Program.cs</c> calls;</item>
/// <item>SEC-1: the 21st try from one network (one IPv4 address, one IPv6 /64) is refused however
/// many accounts make them, the 301st try from everyone together is refused, the per-person limit
/// still holds across networks, and a client-written <c>X-Forwarded-For</c> buys nothing — through
/// the SAME <c>RateLimitingConfig.CreateForwardedHeadersOptions</c> <c>Program.cs</c> applies;</item>
/// <item>a collision with another farm's code is retried inside the request transaction — on the
/// invite-sheet path and, M3, on both farm-CREATION paths (<c>CreateFarmHandler</c>,
/// <c>POST /bootstrap/first-farm</c>).</item>
/// </list>
///
/// <para>What a pending request can READ and WRITE (nothing) is proven separately, end to end, by
/// <c>PendingJoinRequestAccessRealPostgresTests</c>.</para>
///
/// <para>Doctrine E3 — vacuity guard FIRST: every fact asserts the host's role is neither
/// superuser nor BYPASSRLS before anything else, so FORCE-RLS is genuinely in play.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class JoinByCodeRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Codes drawn from the real alphabet so they survive FarmCode.Normalize unchanged.
    private const string CodeA = "K7M2QP";
    private const string CodeB = "R4T9WX";
    private const string FarmAName = "Shinde Mala";
    private const string FarmBName = "Jadhav Wadi";

    private static readonly Guid FarmA = Guid.Parse("c9e30001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("c9e30001-0000-0000-0000-000000000002");
    private static readonly Guid FarmNoCode = Guid.Parse("c9e30001-0000-0000-0000-000000000003");
    private static readonly Guid AccountA = Guid.Parse("c9e30001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("c9e30001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("c9e30001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("c9e30001-0000-0000-0000-0000000000a2");
    private static readonly Guid MukadamA = Guid.Parse("c9e30001-0000-0000-0000-0000000000b2");
    private static readonly Guid SuspendedA = Guid.Parse("c9e30001-0000-0000-0000-0000000000b4");
    private static readonly Guid RevokedBefore = Guid.Parse("c9e30001-0000-0000-0000-0000000000d3");
    private static readonly Guid ExitedBefore = Guid.Parse("c9e30001-0000-0000-0000-0000000000d4");
    private static readonly Guid Joiner = Guid.Parse("c9e30001-0000-0000-0000-0000000000e1");
    private static readonly Guid Racer = Guid.Parse("c9e30001-0000-0000-0000-0000000000e5");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_joinbycode_{Guid.NewGuid():N}";
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
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Planted as SUPERUSER: the plant must never depend on the code under test.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            // HARNESS PARITY (as LabourReadMembershipStatusRealPostgresTests): the sync pull's
            // operator directory reads public.users, a grant provisioned outside the migration
            // chain on real environments. Only the "never access" pull check needs it.
            await ExecAsync(raw,
                "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");
            await SeedFarmAsync(raw, FarmA, FarmAName, OwnerA, AccountA, CodeA);
            await SeedFarmAsync(raw, FarmB, FarmBName, OwnerB, AccountB, CodeB);
            await SeedFarmAsync(raw, FarmNoCode, "Code-less Farm", OwnerB, AccountB, code: null);
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, MukadamA, "Mukadam", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, SuspendedA, "Worker", 4);
            await SeedMembershipAsync(raw, FarmA, AccountA, RevokedBefore, "Mukadam", 5);
            await SeedMembershipAsync(raw, FarmA, AccountA, ExitedBefore, "SecondaryOwner", 6);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", 3);
            await SeedMembershipAsync(raw, FarmNoCode, AccountB, OwnerB, "PrimaryOwner", 3);
        }

        _app = await BuildHostAsync(_appConn, _superuserConn);
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
    public async Task A_valid_code_creates_exactly_one_PendingApproval_request_with_the_placeholder_role()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await JoinAsync(Joiner, CodeA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("farmId").GetGuid().Should().Be(FarmA);
        doc.RootElement.GetProperty("farmName").GetString().Should().Be(FarmAName);
        doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");

        // Role "Worker" here is the placeholder the owner replaces; status 2 = PendingApproval,
        // joined_via 4 = SelfJoin, and no invitation stands behind a typed code.
        (await SeatsAsync(FarmA, Joiner)).Should().Equal(new Seat("Worker", 2, 4, HasInvitation: false));
        (await SeatsAsync(FarmB, Joiner)).Should().BeEmpty("the code names farm A only");
        (await AuditCountAsync(FarmA, Joiner, "MemberJoinRequested")).Should().Be(1);
        (await AuditCountAsync(FarmB, Joiner, "MemberJoinRequested")).Should().Be(0);
    }

    [Fact]
    public async Task A_role_sent_in_the_body_is_ignored_the_joiner_never_chooses_one()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await SendAsync(
            "/shramsafal/join/by-code", Joiner,
            new { farmCode = CodeA, role = "PrimaryOwner", status = "Active", requireApproval = false });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        (await SeatsAsync(FarmA, Joiner)).Should().Equal(new Seat("Worker", 2, 4, HasInvitation: false));
    }

    [Theory]
    [InlineData("k7m2qp")]
    [InlineData(" K7M-2QP ")]
    [InlineData("K७M२QP")]
    public async Task A_code_typed_the_way_people_type_it_still_finds_the_farm(string typed)
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await JoinAsync(Joiner, typed);
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());

        (await SeatsAsync(FarmA, Joiner)).Should().Equal(new Seat("Worker", 2, 4, HasInvitation: false));
    }

    [Fact]
    public async Task Every_wrong_code_gets_the_identical_404_that_names_no_farm_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var wrongCodes = new[]
        {
            "ZZZZZZ",              // well-formed, no such farm
            "K7M2QR",              // one character off farm A's code
            "K7M2Q",               // too short
            "K7M2QU",              // U is not in the alphabet
            "",                    // blank
            "' OR 1=1 --",         // not a code at all
        };

        var bodies = new List<string>();
        foreach (var code in wrongCodes)
        {
            using var response = await JoinAsync(Joiner, code);
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.NotFound, $"code '{code}': {body}");
            bodies.Add(body);
        }

        bodies.Distinct().Should().ContainSingle("no wrong code may be distinguishable from another");
        using (var doc = JsonDocument.Parse(bodies[0]))
        {
            doc.RootElement.EnumerateObject().Select(p => p.Name).Should().Equal(new[] { "error" },
                "the contract body is exactly {\"error\":\"join.code_unknown\"} — no message, no farm");
            doc.RootElement.GetProperty("error").GetString().Should().Be("join.code_unknown");
        }

        foreach (var body in bodies)
        {
            body.Should().NotContain(FarmAName).And.NotContain(FarmBName)
                .And.NotContain(FarmA.ToString()).And.NotContain(FarmB.ToString());
        }

        (await AllSeatsOfAsync(Joiner)).Should().Be(0);
        (await AuditCountAsync(FarmA, Joiner, "MemberJoinRequested")).Should().Be(0);
    }

    [Fact]
    public async Task Asking_again_is_idempotent_one_seat_one_audit_row_same_status()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var first = await JoinAsync(Joiner, CodeA);
        first.StatusCode.Should().Be(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        using var second = await JoinAsync(Joiner, "k7m2qp");
        var body = await second.Content.ReadAsStringAsync();
        second.StatusCode.Should().Be(HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
        (await SeatsAsync(FarmA, Joiner)).Should().HaveCount(1);
        (await AuditCountAsync(FarmA, Joiner, "MemberJoinRequested")).Should().Be(1);
    }

    [Fact]
    public async Task A_double_tap_creates_exactly_one_request()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 4).Select(async _ =>
        {
            using var r = await JoinAsync(Racer, CodeA);
            return (r.StatusCode, Body: await r.Content.ReadAsStringAsync());
        }));

        outcomes.Should().OnlyContain(o => o.StatusCode == HttpStatusCode.OK,
            "every racer must get 200, never a 500: " + string.Join(" | ", outcomes.Select(o => (int)o.StatusCode + " " + o.Body)));
        outcomes.Should().OnlyContain(o => o.Body.Contains("\"PendingApproval\""));
        (await SeatsAsync(FarmA, Racer)).Should().Equal(new Seat("Worker", 2, 4, HasInvitation: false));
        (await AuditCountAsync(FarmA, Racer, "MemberJoinRequested")).Should().Be(1);
    }

    [Fact]
    public async Task Revoked_and_Exited_people_get_a_new_PendingApproval_request_never_access_and_history_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var who in new[] { RevokedBefore, ExitedBefore })
        {
            using var response = await JoinAsync(who, CodeA);
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"{who}: {body}");
            using var doc = JsonDocument.Parse(body);
            doc.RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
        }

        // The terminal row keeps its old role and status; the new row is a request, not the old
        // role restored (a past Mukadam / co-owner does not get that role back by typing a code).
        (await SeatsAsync(FarmA, RevokedBefore)).Should().BeEquivalentTo(new[]
        {
            new Seat("Mukadam", 5, 2, HasInvitation: false),
            new Seat("Worker", 2, 4, HasInvitation: false),
        });
        (await SeatsAsync(FarmA, ExitedBefore)).Should().BeEquivalentTo(new[]
        {
            new Seat("SecondaryOwner", 6, 2, HasInvitation: false),
            new Seat("Worker", 2, 4, HasInvitation: false),
        });

        // "never access", checked as ACCESS, not as a status column: neither person's next sync
        // pull carries anything of farm A (the full proof is PendingJoinRequestAccessRealPostgresTests).
        foreach (var who in new[] { RevokedBefore, ExitedBefore })
        {
            using var pull = await GetAsync("/sync/pull?since=0", who);
            var pulled = await pull.Content.ReadAsStringAsync();
            pull.StatusCode.Should().Be(HttpStatusCode.OK, pulled);
            pulled.Should().NotContain(FarmAName).And.NotContain(FarmA.ToString());
        }
    }

    [Fact]
    public async Task Existing_members_and_the_owner_get_their_real_status_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var expected = new (Guid Who, string Status, Seat Seat)[]
        {
            (MukadamA, "Active", new Seat("Mukadam", 3, 2, HasInvitation: false)),
            (SuspendedA, "Suspended", new Seat("Worker", 4, 2, HasInvitation: false)),
            (OwnerA, "Active", new Seat("PrimaryOwner", 3, 2, HasInvitation: false)),
        };

        foreach (var (who, status, seat) in expected)
        {
            using var response = await JoinAsync(who, CodeA);
            var body = await response.Content.ReadAsStringAsync();
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"{who}: {body}");
            using var doc = JsonDocument.Parse(body);
            doc.RootElement.GetProperty("status").GetString().Should().Be(status,
                "a paused person must not be able to type their way to a fresh request");

            (await SeatsAsync(FarmA, who)).Should().Equal(seat);
            (await AuditCountAsync(FarmA, who, "MemberJoinRequested")).Should().Be(0);
        }
    }

    [Fact]
    public async Task The_registrant_without_a_seat_row_is_answered_Active_and_no_request_is_created()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, "DELETE FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
                ("f", FarmB), ("u", OwnerB));
        }

        using var response = await JoinAsync(OwnerB, CodeB);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("status").GetString().Should().Be("Active");
        (await SeatsAsync(FarmB, OwnerB)).Should().BeEmpty("the owner never becomes a pending worker on his own farm");
    }

    [Fact]
    public async Task Unauthenticated_gets_401_and_an_unverified_phone_gets_403_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using (var anonymous = await SendAsync("/shramsafal/join/by-code", userId: null, new { farmCode = CodeA }))
        {
            anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }

        using (var unverified = await SendAsync(
                   "/shramsafal/join/by-code", Joiner, new { farmCode = CodeA }, phoneVerified: false))
        {
            var body = await unverified.Content.ReadAsStringAsync();
            unverified.StatusCode.Should().Be(HttpStatusCode.Forbidden, body);
            body.Should().Contain("join.phone_not_verified").And.NotContain(FarmAName);
        }

        (await AllSeatsOfAsync(Joiner)).Should().Be(0);
    }

    [Fact]
    public async Task The_join_code_policy_is_a_select_only_door_for_exactly_one_farm_as_the_app_role()
    {
        await AssertAppRoleIsNotVacuousAsync();

        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();

        // No GUC, an empty GUC, a wrong code: the app role sees no farm at all.
        (await VisibleFarmsAsync(db, joinCode: null)).Should().BeEmpty();
        (await VisibleFarmsAsync(db, joinCode: string.Empty)).Should().BeEmpty();
        (await VisibleFarmsAsync(db, joinCode: "ZZZZZZ")).Should().BeEmpty();

        // The right code: exactly that farm, never its neighbour.
        (await VisibleFarmsAsync(db, joinCode: CodeA)).Should().Equal(FarmA);
        (await VisibleFarmsAsync(db, joinCode: CodeB)).Should().Equal(FarmB);

        // SELECT-only: knowing the code does not let the app role change the farm.
        await using (var tx = await db.BeginTransactionAsync())
        {
            await ExecAsync(db, "SELECT set_config('agrisync.join_code', @c, true)", ("c", CodeA));
            await using var update = db.CreateCommand();
            update.Transaction = tx;
            update.CommandText = "UPDATE ssf.farms SET name = 'renamed by a stranger' WHERE farm_code = @c";
            update.Parameters.AddWithValue("c", CodeA);
            (await update.ExecuteNonQueryAsync()).Should().Be(0, "the join-code policy must widen READS only");
            await tx.RollbackAsync();
        }

        (await FarmNameAsync(FarmA)).Should().Be(FarmAName);
    }

    [Fact]
    public async Task The_startup_backfill_gives_every_codeless_farm_a_code_and_a_second_run_changes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await FarmCodeAsync(FarmNoCode)).Should().BeNull("arrange: this farm starts without a code");

        await using (var scope = _app!.Services.CreateAsyncScope())
        {
            var result = await scope.ServiceProvider.GetRequiredService<FarmCodeBackfillRunner>().RunAsync(default);
            result.Should().Be(new FarmCodeBackfillResult(FarmsWithoutCode: 1, Assigned: 1));
        }

        var assigned = await FarmCodeAsync(FarmNoCode);
        assigned.Should().NotBeNull();
        FarmCode.Normalize(assigned).Should().Be(assigned, "a backfilled code is a well-formed code");
        (await FarmCodeAsync(FarmA)).Should().Be(CodeA, "a code people may have written down is never changed");
        (await FarmCodeAsync(FarmB)).Should().Be(CodeB);

        await using (var scope = _app!.Services.CreateAsyncScope())
        {
            var again = await scope.ServiceProvider.GetRequiredService<FarmCodeBackfillRunner>().RunAsync(default);
            again.Should().Be(new FarmCodeBackfillResult(FarmsWithoutCode: 0, Assigned: 0));
        }

        (await FarmCodeAsync(FarmNoCode)).Should().Be(assigned);

        // And the backfilled code works at the door.
        using var response = await JoinAsync(Joiner, assigned!);
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
        (await SeatsAsync(FarmNoCode, Joiner)).Should().Equal(new Seat("Worker", 2, 4, HasInvitation: false));
    }

    [Fact]
    public async Task The_join_route_carries_the_join_rate_limit_policy_by_the_shared_name()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var endpoint = _app!.Services.GetRequiredService<EndpointDataSource>().Endpoints
            .Single(e => e.Metadata.GetMetadata<IEndpointNameMetadata>()?.EndpointName == "JoinFarmByCode");

        // TB-1: assert the attribute is THERE first. The old one-liner read
        // `GetMetadata<EnableRateLimitingAttribute>()?.PolicyName.Should()...`, and `?.` skips the
        // whole rest of the chain when the attribute is missing — so the assertion never ran in
        // exactly the case it exists for. Proven to bite: with .RequireRateLimiting removed from
        // the route this fact fails here.
        var rateLimit = endpoint.Metadata.GetMetadata<EnableRateLimitingAttribute>();
        rateLimit.Should().NotBeNull(
            "the only defence against guessing a 6-character code is this limit (per person, per "
            + "network and across all callers all hang off it); removing .RequireRateLimiting from "
            + "the route must turn this test red");
        rateLimit!.PolicyName.Should().Be(MembershipEndpoints.JoinRateLimitPolicy);
        MembershipEndpoints.JoinRateLimitPolicy.Should().Be("join");
    }

    [Fact]
    public async Task The_eleventh_try_in_the_window_is_a_429_with_the_windows_own_Retry_After_and_other_people_are_unaffected()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Ten wrong codes are answered (404) — a farmer fixing typos is never refused.
        for (var i = 0; i < RateLimitingConfig.JoinPermitLimit; i++)
        {
            using var tryN = await JoinAsync(Joiner, "ZZZZZZ");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"try {i + 1} is within the limit");
        }

        // The 11th — even with the RIGHT code — is refused before the handler runs.
        using (var refused = await JoinAsync(Joiner, CodeA))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            refused.Headers.TryGetValues("Retry-After", out var retryAfter).Should().BeTrue();
            retryAfter!.Single().Should().Be(((int)RateLimitingConfig.JoinWindow.TotalSeconds).ToString(),
                "a phone that obeys Retry-After must not retry into another 429 (it used to say 60 for a 10-minute window)");
            (await refused.Content.ReadAsStringAsync()).Should().NotContain(FarmAName);
        }

        (await AllSeatsOfAsync(Joiner)).Should().Be(0, "a refused try writes nothing");

        // The limit is per signed-in person: someone else is answered normally.
        using var other = await JoinAsync(Racer, CodeA);
        other.StatusCode.Should().Be(HttpStatusCode.OK, await other.Content.ReadAsStringAsync());
    }

    // -- SEC-1: per client network and across all callers -----------------------------------
    //
    // POST /user/auth/register mints a password account for any phone with no OTP and login marks
    // it verified (founder decision D-23, untouched), so a per-PERSON limit alone does not bound
    // guessing. These facts prove the two limits that do, through the real forwarded-header rule
    // (RateLimitingConfig.CreateForwardedHeadersOptions, the one Program.cs uses).

    [Fact]
    public async Task The_21st_try_from_one_network_is_refused_even_when_every_try_is_a_different_person()
    {
        await AssertAppRoleIsNotVacuousAsync();
        const string Network = "203.0.113.7";

        for (var i = 1; i <= RateLimitingConfig.JoinPerClientNetworkPermitLimit; i++)
        {
            using var tryN = await JoinFromAsync(Caller(i), "ZZZZZZ", socketIp: Network);
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"try {i} (a fresh account each time) is within the network's limit");
        }

        // A 21st account from the same machine — with the RIGHT code — is refused before the handler.
        var fresh = Caller(RateLimitingConfig.JoinPerClientNetworkPermitLimit + 1);
        using (var refused = await JoinFromAsync(fresh, CodeA, socketIp: Network))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "fresh accounts from one network share one budget — that is what bounds code guessing");
            AssertRetryAfterIsTheJoinWindow(refused);
            (await refused.Content.ReadAsStringAsync()).Should().NotContain(FarmAName);
        }

        (await AllSeatsOfAsync(fresh)).Should().Be(0, "a refused try writes nothing");

        // CONTROL: another network is answered normally, so the refusal is per network.
        var elsewhere = Caller(RateLimitingConfig.JoinPerClientNetworkPermitLimit + 2);
        using var other = await JoinFromAsync(elsewhere, CodeA, socketIp: "203.0.113.8");
        other.StatusCode.Should().Be(HttpStatusCode.OK, await other.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task An_IPv6_phone_cannot_buy_more_tries_by_stepping_to_a_fresh_address_in_its_own_64()
    {
        await AssertAppRoleIsNotVacuousAsync();

        for (var i = 1; i <= RateLimitingConfig.JoinPerClientNetworkPermitLimit; i++)
        {
            using var tryN = await JoinFromAsync(Caller(i), "ZZZZZZ", socketIp: $"2001:db8:1:2::{i:x}");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"try {i} is within the /64's limit");
        }

        using (var refused = await JoinFromAsync(Caller(100), CodeA, socketIp: "2001:db8:1:2:ffff:ffff:ffff:fffe"))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "every address in one /64 is one phone or one line — one budget");
        }

        // CONTROL: the next /64 is a different network and is answered.
        using var other = await JoinFromAsync(Caller(101), CodeA, socketIp: "2001:db8:1:3::1");
        other.StatusCode.Should().Be(HttpStatusCode.OK, await other.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_per_person_limit_still_holds_when_one_person_moves_between_networks()
    {
        await AssertAppRoleIsNotVacuousAsync();

        for (var i = 1; i <= RateLimitingConfig.JoinPermitLimit; i++)
        {
            using var tryN = await JoinFromAsync(Joiner, "ZZZZZZ", socketIp: $"198.51.100.{i}");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"try {i} is within the person's limit");
        }

        // The 11th, from an 11th network (whose own budget is untouched), is still refused.
        using (var refused = await JoinFromAsync(Joiner, CodeA, socketIp: "198.51.100.11"))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "changing network does not reset the person's own 10 tries");
            AssertRetryAfterIsTheJoinWindow(refused);
        }

        (await AllSeatsOfAsync(Joiner)).Should().Be(0);
    }

    [Fact]
    public async Task A_client_written_forwarded_for_header_does_not_buy_more_tries()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var limit = RateLimitingConfig.JoinPerClientNetworkPermitLimit;

        // (a) Through the local nginx (socket 127.0.0.1), which APPENDS the address it saw: the
        //     phone writes a fresh fake address on the left each time; the real one is constant.
        for (var i = 1; i <= limit; i++)
        {
            using var tryN = await JoinFromAsync(Caller(i), "ZZZZZZ",
                socketIp: "127.0.0.1", forwardedFor: $"10.{i}.0.1, 203.0.113.50");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"(a) try {i}");
        }

        using (var refusedA = await JoinFromAsync(Caller(limit + 1), CodeA,
                   socketIp: "127.0.0.1", forwardedFor: "10.250.0.1, 203.0.113.50"))
        {
            refusedA.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "only the address nginx itself appended counts; what the client wrote to its left is ignored");
        }

        // (b) Straight to the server (socket NOT a known proxy): the header is not believed at all.
        for (var i = 1; i <= limit; i++)
        {
            using var tryN = await JoinFromAsync(Caller(100 + i), "ZZZZZZ",
                socketIp: "203.0.113.60", forwardedFor: $"10.{i}.0.2");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"(b) try {i}");
        }

        using (var refusedB = await JoinFromAsync(Caller(200), CodeA,
                   socketIp: "203.0.113.60", forwardedFor: "10.251.0.2"))
        {
            refusedB.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "a forwarded-for header from a caller that is not the local proxy is never believed");
        }

        // CONTROL (c): through the local nginx, DIFFERENT real phones are different networks — so
        // the key really follows the address nginx forwards (one nginx does not make every farmer
        // share one budget), and the refusals above are the spoof being ignored, not a broken key.
        for (var i = 1; i <= limit + 5; i++)
        {
            using var tryN = await JoinFromAsync(Caller(300 + i), "ZZZZZZ",
                socketIp: "127.0.0.1", forwardedFor: $"192.0.2.{i}");
            tryN.StatusCode.Should().Be(HttpStatusCode.NotFound, $"(c) phone {i} has its own budget");
        }
    }

    [Fact]
    public async Task The_301st_try_in_the_window_is_refused_whoever_and_wherever_it_comes_from()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ceiling = RateLimitingConfig.JoinAllCallersPermitLimit;

        // Every try a different person on a different network, so neither of the other two limits
        // is anywhere near: only the all-callers ceiling can refuse. Ten at a time to keep it quick.
        for (var batch = 0; batch < ceiling; batch += 10)
        {
            var outcomes = await Task.WhenAll(Enumerable.Range(batch, Math.Min(10, ceiling - batch)).Select(async i =>
            {
                using var r = await JoinFromAsync(Caller(1000 + i), "ZZZZZZ", socketIp: $"100.64.{i / 200}.{(i % 200) + 1}");
                return r.StatusCode;
            }));
            outcomes.Should().OnlyContain(s => s == HttpStatusCode.NotFound, $"tries {batch + 1}..{batch + outcomes.Length} are under the ceiling");
        }

        var fresh = Caller(5000);
        using (var refused = await JoinFromAsync(fresh, CodeA, socketIp: "100.65.0.1"))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.TooManyRequests,
                "however many accounts and addresses a guesser holds, the window allows 300 tries in all");
            AssertRetryAfterIsTheJoinWindow(refused);
        }

        (await AllSeatsOfAsync(fresh)).Should().Be(0, "a refused try writes nothing");
    }

    // -- M3: a farm-code collision at farm CREATION is drawn again, not a failed creation --------

    [Fact]
    public async Task CreateFarmHandler_draws_again_when_the_new_farms_first_code_collides_and_still_creates_the_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();

        const string Fresh = "Z9Y8X6";
        var newFarm = Guid.Parse("c9e30001-0000-0000-0000-000000000005");
        var newOwner = Guid.Parse("c9e30001-0000-0000-0000-0000000000f5");
        var draws = new Queue<string>(new[] { CodeA, Fresh }); // CodeA already belongs to farm A
        var drawn = 0;

        await using (var scope = _app!.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var ctx = sp.GetRequiredService<ShramSafalDbContext>();
            // A farm creation's write posture (as FirstFarmBootstrapEndpoints / RowLevelSecurityTests
            // §9): admin-elevated so the interceptor adds no prelude, the new farm's own GUCs, ONE
            // transaction — so the redraw must survive a failed INSERT inside it.
            sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            await using var tx = await ctx.Database.BeginTransactionAsync();
            await SetFarmWriteScopeAsync(ctx, newFarm, AccountB, newOwner);

            var repository = (ShramSafal.Infrastructure.Persistence.Repositories.ShramSafalRepository)
                sp.GetRequiredService<ShramSafal.Application.Ports.IShramSafalRepository>();
            repository.DrawFarmCode = () => { drawn++; return draws.Dequeue(); };

            // The REAL handler from the production DI graph, on the same scoped repository.
            var result = await sp.GetRequiredService<CreateFarmHandler>().HandleAsync(
                new CreateFarmCommand(Name: "Navin Mala", OwnerUserId: newOwner, FarmId: newFarm));
            result.IsSuccess.Should().BeTrue(result.IsFailure ? result.Error.Code : string.Empty);

            // A failed INSERT not rolled back to a savepoint would have aborted the transaction (25P02).
            await tx.CommitAsync();
        }

        drawn.Should().Be(2, "the first draw collided with farm A's code and was drawn again");
        (await FarmCodeAsync(newFarm)).Should().Be(Fresh);
        (await FarmCodeAsync(FarmA)).Should().Be(CodeA, "the colliding farm's code is never touched");
        var seats = await SeatsAsync(newFarm, newOwner);
        seats.Should().ContainSingle("the owner's seat, saved in the same unit of work, landed exactly once");
        seats[0].Role.Should().Be("PrimaryOwner");
        seats[0].Status.Should().Be(3);
        (await AuditCountAsync(newFarm, newOwner, "Created")).Should().Be(1, "and so did the audit row");
    }

    [Fact]
    public async Task First_farm_bootstrap_draws_again_when_the_first_code_collides_and_still_creates_the_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();

        const string Fresh = "Z9Y8X5";
        var newFarm = Guid.Parse("c9e30001-0000-0000-0000-000000000006");
        var newOwner = Guid.Parse("c9e30001-0000-0000-0000-0000000000f6");
        var newAccount = Guid.Parse("c9e30001-0000-0000-0000-0000000000c6");
        var draws = new Queue<string>(new[] { CodeB, Fresh }); // CodeB already belongs to farm B
        var drawn = 0;

        await using (var scope = _app!.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var ctx = sp.GetRequiredService<ShramSafalDbContext>();
            // The bootstrap route runs inside the request transaction TenantTransactionMiddleware
            // opened; steps 4–5 (elevate, its own GUCs, find-or-create) are the method under test.
            await using var tx = await ctx.Database.BeginTransactionAsync();

            var (farm, wasAlreadyBootstrapped) = await AgriSync.Bootstrapper.Endpoints.FirstFarmBootstrapEndpoints
                .FindOrCreateFirstFarmAsync(
                    ctx,
                    sp.GetRequiredService<TenantContext>(),
                    newFarm,
                    new AgriSync.SharedKernel.Contracts.Ids.OwnerAccountId(newAccount),
                    new AgriSync.SharedKernel.Contracts.Ids.UserId(newOwner),
                    "Navin Wadi",
                    DateTime.UtcNow,
                    () => { drawn++; return draws.Dequeue(); },
                    default);

            wasAlreadyBootstrapped.Should().BeFalse();
            farm.FarmCode.Should().Be(Fresh);
            await tx.CommitAsync();
        }

        drawn.Should().Be(2, "the first draw collided with farm B's code and was drawn again");
        (await FarmCodeAsync(newFarm)).Should().Be(Fresh);
        (await FarmCodeAsync(FarmB)).Should().Be(CodeB, "the colliding farm's code is never touched");
        var seats = await SeatsAsync(newFarm, newOwner);
        seats.Should().ContainSingle("the PrimaryOwner seat, saved with the farm, landed exactly once");
        seats[0].Role.Should().Be("PrimaryOwner");
        seats[0].Status.Should().Be(3);
    }

    [Fact]
    public async Task A_code_that_collides_with_another_farms_is_drawn_again_inside_the_request_transaction()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await FarmCodeAsync(FarmNoCode)).Should().BeNull("arrange: this farm starts without a code");

        const string Fresh = "Z9Y8X7";
        var draws = new Queue<string>(new[] { CodeA, Fresh }); // CodeA already belongs to farm A
        var drawn = 0;

        await using (var scope = _app!.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            var ctx = sp.GetRequiredService<ShramSafalDbContext>();
            // The production posture: ONE request transaction, the owner's validated farm scope,
            // then the repository — exactly what the invite-QR route does.
            await using var tx = await ctx.Database.BeginTransactionAsync();
            (await sp.GetRequiredService<ShramSafal.Application.Ports.ICallerFarmTenantScope>()
                .EstablishForCallerAsync(FarmNoCode, OwnerB)).IsSuccess.Should().BeTrue();

            var repository = (ShramSafal.Infrastructure.Persistence.Repositories.ShramSafalRepository)
                sp.GetRequiredService<ShramSafal.Application.Ports.IShramSafalRepository>();
            repository.DrawFarmCode = () => { drawn++; return draws.Dequeue(); };

            var farm = await repository.GetFarmByIdAsync(FarmNoCode);
            var code = await repository.EnsureFarmCodeAsync(farm!, DateTime.UtcNow);
            code.Should().Be(Fresh);

            // If EF had not rolled the failed UPDATE back to a savepoint, Postgres would have
            // aborted the whole transaction (25P02) and this commit would throw.
            await tx.CommitAsync();
        }

        drawn.Should().Be(2, "the first draw collided with farm A's code and was retried");
        (await FarmCodeAsync(FarmNoCode)).Should().Be(Fresh);
        (await FarmCodeAsync(FarmA)).Should().Be(CodeA, "the colliding farm's code is never touched");
    }

    // -- Harness ----------------------------------------------------------------

    private sealed record Seat(string Role, int Status, int JoinedVia, bool HasInvitation);

    /// <summary>TEST-ONLY stand-in for the TCP peer address, which TestServer does not have: the
    /// address the connection came FROM — a phone directly, or the local nginx (127.0.0.1). The
    /// host applies it before UseForwardedHeaders, where Kestrel's socket address would be.</summary>
    private const string TestSocketIpHeader = "X-Test-Socket-Ip";

    /// <summary>A distinct signed-in person per <paramref name="n"/>, holding no seat anywhere.</summary>
    private static Guid Caller(int n) => Guid.Parse($"c9e30001-0000-0000-0001-{n:D12}");

    private Task<HttpResponseMessage> JoinAsync(Guid caller, string farmCode)
        => SendAsync("/shramsafal/join/by-code", caller, new { farmCode });

    private Task<HttpResponseMessage> JoinFromAsync(Guid caller, string farmCode, string socketIp, string? forwardedFor = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/shramsafal/join/by-code")
        {
            Content = JsonContent.Create(new { farmCode }),
        };
        request.Headers.Add("X-Test-UserId", caller.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        request.Headers.Add(TestSocketIpHeader, socketIp);
        if (forwardedFor is not null)
        {
            request.Headers.Add("X-Forwarded-For", forwardedFor);
        }

        return _client.SendAsync(request);
    }

    private static void AssertRetryAfterIsTheJoinWindow(HttpResponseMessage refused)
    {
        refused.Headers.TryGetValues("Retry-After", out var retryAfter).Should().BeTrue();
        retryAfter!.Single().Should().Be(((int)RateLimitingConfig.JoinWindow.TotalSeconds).ToString(),
            "a phone that obeys Retry-After must not retry into another 429");
    }

    /// <summary>The write posture of a farm creation: the new farm's own tenant GUCs on the
    /// current transaction (FirstFarmBootstrapEndpoints' self-GUC technique).</summary>
    private static async Task SetFarmWriteScopeAsync(ShramSafalDbContext ctx, Guid farm, Guid account, Guid user)
    {
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.farm_id', {farm.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.owner_account_id', {account.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.user_id', {user.ToString()}, true)");
    }

    private Task<HttpResponseMessage> GetAsync(string url, Guid caller)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Test-UserId", caller.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return _client.SendAsync(request);
    }

    private async Task<HttpResponseMessage> SendAsync(
        string url, Guid? userId, object body, bool phoneVerified = true)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        if (userId is { } id)
        {
            request.Headers.Add("X-Test-UserId", id.ToString());
            request.Headers.Add("X-Test-PhoneVerified", phoneVerified ? "true" : "false");
        }

        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn, string superuserConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-joinbycode", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            // Only the startup backfill uses this (the privileged cross-tenant posture every
            // hosted repair runs under). Every route assertion runs on appConn with RLS in force.
            ["ConnectionStrings:ShramSafalDb_Migration"] = superuserConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"joinbycode-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handler, the real tenant scope.
        builder.Services.AddShramSafalApi(builder.Configuration);
        // The REAL rate-limit registration — the same call Program.cs makes, production limits.
        builder.Services.AddAgriSyncRateLimiting(e2eHarnessEnabled: false);

        var app = builder.Build();
        // The socket address TestServer lacks (TestSocketIpHeader), then the REAL forwarded-header
        // rule Program.cs applies first in its pipeline — so the per-network "join" limit keys on
        // exactly what production would see.
        app.Use((context, next) =>
        {
            if (IPAddress.TryParse(context.Request.Headers[TestSocketIpHeader].ToString(), out var socketIp))
            {
                context.Connection.RemoteIpAddress = socketIp;
            }

            return next(context);
        });
        app.UseForwardedHeaders(RateLimitingConfig.CreateForwardedHeadersOptions());
        app.UseAuthentication();
        // Same position as Program.cs: after authentication (the "join" partition is the signed-in
        // user), before authorization.
        app.UseRateLimiter();
        app.UseAuthorization();
        // Same order as Program.cs: auth, TenantTransactionMiddleware, endpoints.
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<List<Seat>> SeatsAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT role, status, joined_via, invitation_id IS NOT NULL
            FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u ORDER BY status DESC
            """;
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        var rows = new List<Seat>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new Seat(reader.GetString(0), reader.GetInt32(1), reader.GetInt32(2), reader.GetBoolean(3)));
        }

        return rows;
    }

    private async Task<int> AllSeatsOfAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_memberships WHERE user_id = @u";
        cmd.Parameters.AddWithValue("u", user);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<int> AuditCountAsync(Guid farm, Guid actor, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND actor_user_id = @a AND action = @act";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", actor);
        cmd.Parameters.AddWithValue("act", action);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<string?> FarmCodeAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT farm_code FROM ssf.farms WHERE \"Id\" = @f";
        cmd.Parameters.AddWithValue("f", farm);
        var value = await cmd.ExecuteScalarAsync();
        return value is DBNull or null ? null : (string)value;
    }

    private async Task<string> FarmNameAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT name FROM ssf.farms WHERE \"Id\" = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>Every farm id the APP ROLE can see, in its own transaction with only the
    /// join-code GUC set (or none).</summary>
    private static async Task<List<Guid>> VisibleFarmsAsync(NpgsqlConnection appDb, string? joinCode)
    {
        await using var tx = await appDb.BeginTransactionAsync();
        if (joinCode is not null)
        {
            await using var set = appDb.CreateCommand();
            set.Transaction = tx;
            set.CommandText = "SELECT set_config('agrisync.join_code', @c, true)";
            set.Parameters.AddWithValue("c", joinCode);
            await set.ExecuteNonQueryAsync();
        }

        var ids = new List<Guid>();
        await using (var read = appDb.CreateCommand())
        {
            read.Transaction = tx;
            read.CommandText = "SELECT \"Id\" FROM ssf.farms ORDER BY \"Id\"";
            await using var reader = await read.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                ids.Add(reader.GetGuid(0));
            }
        }

        await tx.RollbackAsync();
        return ids;
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

    private static Task SeedFarmAsync(
        NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account, string? code)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """,
            ("farm", farm), ("name", name), ("owner", owner), ("account", account),
            ("code", (object?)code ?? DBNull.Value));

    private static Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, int status)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status, 2);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", userId), ("role", role),
            ("account", account), ("status", status));

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
}

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, SEC-1) — the per-network "join" key, as a pure
/// function (no database): an IPv6 /64 is one network, an IPv4-mapped IPv6 address is its IPv4.
/// </summary>
public sealed class JoinClientNetworkKeyTests
{
    [Fact]
    public void The_network_key_groups_IPv6_by_64_and_reads_a_mapped_IPv4_as_IPv4()
    {
        static string KeyOf(string? ip)
        {
            var context = new DefaultHttpContext();
            context.Connection.RemoteIpAddress = ip is null ? null : IPAddress.Parse(ip);
            return RateLimitingConfig.ResolveJoinClientNetworkKey(context);
        }

        KeyOf("2001:db8:1:2::1").Should().Be(KeyOf("2001:db8:1:2:ffff:ffff:ffff:ffff"));
        KeyOf("2001:db8:1:2::1").Should().NotBe(KeyOf("2001:db8:1:3::1"));
        KeyOf("::ffff:203.0.113.7").Should().Be(KeyOf("203.0.113.7"));
        KeyOf("203.0.113.7").Should().NotBe(KeyOf("203.0.113.8"));
        KeyOf(null).Should().Be("join-net:unknown");
    }
}

/// <summary>
/// Test auth for the join-by-code route: the <c>X-Test-UserId</c> contract of the other
/// real-Postgres route suites, plus <c>X-Test-PhoneVerified</c> (default true) so the
/// unverified-phone refusal can be exercised.
/// </summary>
internal sealed class JoinByCodeTestAuthHandler(
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

        var phoneVerified = !string.Equals(
            Request.Headers["X-Test-PhoneVerified"].ToString(), "false", StringComparison.OrdinalIgnoreCase);

        var id = userId.ToString();
        var claims = new[]
        {
            new Claim("sub", id),
            new Claim(ClaimTypes.NameIdentifier, id),
            new Claim("phone_verified", phoneVerified ? "true" : "false"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
    }
}
