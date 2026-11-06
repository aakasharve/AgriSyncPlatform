// spec: plr-d10-redesign-real-integration-2026-10-25 — lane MU-2 (MU design §5, §6, §11.3; founder D-22, D-26, D-8)
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Composition;
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
using Npgsql;
using ShramSafal.Api;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// spec: plr-d10 lane MU-2 — <b>an invitation that carries the relationship</b>, end to end over the REAL production
/// pipeline (TenantTransactionMiddleware, the real tenant scopes, the real rate limits) against real Postgres as the
/// non-superuser <c>agrisync_app</c>. The owner decides who a person is BEFORE he joins (label, plots, authorities, by
/// whom, a 7-day single-use code); the person then accepts or declines. Every fact plants as SUPERUSER and reads the rows
/// back as SUPERUSER, so neither the plant nor the read-back depends on the code under test.
///
/// <para>Written over HTTP and raw SQL only (no new C# type), so the same file runs red on the base and green on the
/// lane.</para>
///
/// <para>Doctrine E3 — vacuity guard FIRST: each fact asserts the host's role is neither superuser nor BYPASSRLS.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PersonalInvitationRealPostgresTests : IAsyncLifetime
{
    private const string FarmAName = "पाटील फार्म";
    private const string FarmBName = "Jadhav Wadi";

    private static readonly Guid FarmA = Guid.Parse("d2a20001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("d2a20001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("d2a20001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("d2a20001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("d2a20001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("d2a20001-0000-0000-0000-0000000000a2");
    private static readonly Guid CoOwnerA = Guid.Parse("d2a20001-0000-0000-0000-0000000000b1");
    private static readonly Guid MukadamA = Guid.Parse("d2a20001-0000-0000-0000-0000000000b2");
    private static readonly Guid OldWorkerA = Guid.Parse("d2a20001-0000-0000-0000-0000000000b3");
    private static readonly Guid Joiner = Guid.Parse("d2a20001-0000-0000-0000-0000000000e1");
    private static readonly Guid Stranger = Guid.Parse("d2a20001-0000-0000-0000-0000000000e2");
    private static readonly Guid Unverified = Guid.Parse("d2a20001-0000-0000-0000-0000000000e3");
    private static readonly Guid PlotA1 = Guid.Parse("d2a20001-0000-0000-0000-0000000001a1");
    private static readonly Guid PlotA2 = Guid.Parse("d2a20001-0000-0000-0000-0000000001a2");
    private static readonly Guid PlotB1 = Guid.Parse("d2a20001-0000-0000-0000-0000000001b1");
    private static readonly Guid WorkerRecordA = Guid.Parse("d2a20001-0000-0000-0000-0000000002a1");
    private static readonly Guid WorkerPersonA = Guid.Parse("d2a20001-0000-0000-0000-0000000003a1");
    private static readonly Guid WorkerRecordB = Guid.Parse("d2a20001-0000-0000-0000-0000000002b1");

    // public.users stores ten digits; the invitation is typed by the owner in any common form.
    private const string JoinerPhone = "6000012345";
    private const string StrangerPhone = "6000054321";
    private const string UnverifiedPhone = "6000099999";

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_mu2_{Guid.NewGuid():N}";
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

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            // HARNESS PARITY: public.users is read by the app role on real environments (a grant made outside the chain).
            await ExecAsync(raw,
                "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");
            await SeedUserAsync(raw, OwnerA, "9811100001", "Ramrao Patil", verified: true);
            await SeedUserAsync(raw, OwnerB, "9811100002", "Shankar Jadhav", verified: true);
            await SeedUserAsync(raw, CoOwnerA, "9811100003", "Sunita Patil", verified: true);
            await SeedUserAsync(raw, MukadamA, "9811100004", "Gopal", verified: true);
            await SeedUserAsync(raw, OldWorkerA, "9811100005", "Baban", verified: true);
            await SeedUserAsync(raw, Joiner, JoinerPhone, "Ramesh", verified: true);
            await SeedUserAsync(raw, Stranger, StrangerPhone, "Suresh", verified: true);
            await SeedUserAsync(raw, Unverified, UnverifiedPhone, "Mahesh", verified: false);

            await SeedFarmAsync(raw, FarmA, FarmAName, OwnerA, AccountA, "K7M2QP");
            await SeedFarmAsync(raw, FarmB, FarmBName, OwnerB, AccountB, "R4T9WX");
            await SeedSeatAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, CoOwnerA, "SecondaryOwner", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, MukadamA, "Mukadam", 3);
            await SeedSeatAsync(raw, FarmA, AccountA, OldWorkerA, "Worker", 3, permissions: 128, labour: true);
            await SeedSeatAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", 3);
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@a1, @fa, 'प्लॉट 1', 1.0, NOW(), NOW()),
                       (@a2, @fa, 'प्लॉट 2', 1.0, NOW(), NOW()),
                       (@b1, @fb, 'B plot', 1.0, NOW(), NOW());
                """, ("a1", PlotA1), ("a2", PlotA2), ("b1", PlotB1), ("fa", FarmA), ("fb", FarmB));
            // A worker on farm A's हजेरी list, with his ShramSafal identity: the number the owner typed for him is his own,
            // not yet proven (WID R4). Farm B has its own worker record.
            await ExecAsync(raw, """
                INSERT INTO ssf.shram_persons (id, card_name, created_by_user_id, created_at_utc)
                VALUES (@person, 'रमेश', @owner, NOW());
                INSERT INTO ssf.field_operators ("Id", display_name, display_name_normalized, full_name, originating_farm_id,
                                                 created_by_user_id, created_at_utc, is_active, person_id)
                VALUES (@wa, 'रमेश', 'रमेश', NULL, @fa, @owner, NOW(), TRUE, @person),
                       (@wb, 'गणू', 'गणू', NULL, @fb, @ownerB, NOW(), TRUE, NULL);
                INSERT INTO ssf.shram_person_phones (id, person_id, phone_e164, whose, added_by_farm_id, added_at_utc, verified_at_utc)
                VALUES (@phoneRow, @person, '+916000012345', 'Own', @fa, NOW(), NULL);
                """,
                ("person", WorkerPersonA), ("owner", OwnerA), ("ownerB", OwnerB), ("wa", WorkerRecordA), ("wb", WorkerRecordB),
                ("fa", FarmA), ("fb", FarmB), ("phoneRow", Guid.NewGuid()));
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

    // ── the grant ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_named_mobile_claim_by_that_verified_number_activates_exactly_the_grant()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var confirmEnd = DateTime.UtcNow.AddDays(20).Date.AddHours(18).ToUniversalTime();

        var made = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Family",
            name = "रमेश",
            invitedPhone = "+91 60000 12345",
            plotScope = "ChosenPlots",
            plotIds = new[] { PlotA1 },
            authorities = new object[]
            {
                new { name = "TakeAttendance", expiresAtUtc = (DateTime?)null },
                new { name = "ConfirmRecords", expiresAtUtc = (DateTime?)confirmEnd },
            },
        });
        var invitationId = made.GetProperty("id").GetGuid();
        var code = made.GetProperty("code").GetString()!;
        code.Should().MatchRegex("^[0-9]{8}$", "eight digits he can type");
        made.GetProperty("link").GetString().Should().Be($"https://shramsafal.in/i/{code}");
        made.GetProperty("status").GetString().Should().Be("Waiting");
        (made.GetProperty("expiresAtUtc").GetDateTime() - made.GetProperty("createdAtUtc").GetDateTime())
            .Should().Be(TimeSpan.FromDays(7));

        // After sign-in the server lists it for the number it named — his card.
        using (var mine = await GetAsync("/shramsafal/invitations/mine", Joiner))
        {
            var body = await mine.Content.ReadAsStringAsync();
            mine.StatusCode.Should().Be(HttpStatusCode.OK, body);
            using var doc = JsonDocument.Parse(body);
            var card = doc.RootElement.EnumerateArray().Single();
            card.GetProperty("invitationId").GetGuid().Should().Be(invitationId);
            card.GetProperty("farmName").GetString().Should().Be(FarmAName);
            card.GetProperty("label").GetString().Should().Be("Family");
            card.GetProperty("plotNames").EnumerateArray().Select(p => p.GetString()).Should().Equal("प्लॉट 1");
            card.GetProperty("namesYou").GetBoolean().Should().BeTrue();
            card.GetProperty("authorities").EnumerateArray().Select(a => a.GetProperty("name").GetString())
                .Should().BeEquivalentTo(new[] { "TakeAttendance", "ConfirmRecords" });
            card.TryGetProperty("code", out _).Should().BeFalse("the card never repeats the code");
        }

        using var accepted = await PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId });
        var acceptedBody = await accepted.Content.ReadAsStringAsync();
        accepted.StatusCode.Should().Be(HttpStatusCode.OK, acceptedBody);
        using (var doc = JsonDocument.Parse(acceptedBody))
        {
            doc.RootElement.GetProperty("status").GetString().Should().Be("Active");
            doc.RootElement.GetProperty("farmId").GetGuid().Should().Be(FarmA);
        }

        var seat = await SeatAsync(FarmA, Joiner);
        seat.Should().NotBeNull();
        seat!.Role.Should().Be("SecondaryOwner");
        seat.Label.Should().Be("Family", "कुटुंब is stored apart from सहमालक (F79)");
        seat.Status.Should().Be(3);
        seat.PlotScope.Should().Be("ChosenPlots");
        seat.PlotIds.Should().Equal(PlotA1);
        seat.Labour.Should().BeTrue();
        seat.LabourEnd.Should().BeNull("हजेरी was given कायम");
        seat.Permissions.Should().Be(128, "ConfirmRecords only — nothing the owner did not choose");
        seat.ExpiriesJson.Should().Contain("128").And.Contain(confirmEnd.ToString("yyyy-MM-dd"));
        seat.ApprovedBy.Should().Be(OwnerA, "the owner's approval was given in advance, by naming the number");
        seat.PersonalInvitationId.Should().Be(invitationId);

        var inv = await InvitationAsync(invitationId);
        inv.Status.Should().Be("Accepted");
        inv.ClaimedBy.Should().Be(Joiner);
        inv.ClaimedAt.Should().NotBeNull();
        inv.WaitsForOwner.Should().BeFalse();

        (await AuditCountAsync(FarmA, "PersonalInvitationCreated")).Should().Be(1);
        (await AuditCountAsync(FarmA, "MemberJoined", Joiner)).Should().Be(1);

        // Active now: his farm list carries it.
        (await MyActiveFarmsAsync(Joiner)).Should().Contain(FarmA);
    }

    [Fact]
    public async Task An_invitation_that_named_no_mobile_waits_for_the_owner_and_his_one_tap_applies_the_grant()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var made = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Mukadam",
            plotScope = "AllPlots",
            authorities = new object[] { new { name = "TakeAttendance", expiresAtUtc = (DateTime?)null } },
        });
        var invitationId = made.GetProperty("id").GetGuid();
        var code = made.GetProperty("code").GetString()!;

        using (var found = await PostAsync("/shramsafal/invitations/find", Joiner, new { code }))
        {
            var body = await found.Content.ReadAsStringAsync();
            found.StatusCode.Should().Be(HttpStatusCode.OK, body);
            using var doc = JsonDocument.Parse(body);
            doc.RootElement.GetProperty("farmName").GetString().Should().Be(FarmAName);
            doc.RootElement.GetProperty("namesYou").GetBoolean().Should().BeFalse();
        }

        using var accepted = await PostAsync("/shramsafal/invitations/accept", Joiner, new { code });
        var acceptedBody = await accepted.Content.ReadAsStringAsync();
        accepted.StatusCode.Should().Be(HttpStatusCode.OK, acceptedBody);
        JsonDocument.Parse(acceptedBody).RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");

        var waiting = await SeatAsync(FarmA, Joiner);
        waiting!.Status.Should().Be(2, "nothing activates until the owner taps");
        waiting.Labour.Should().BeFalse();
        waiting.Permissions.Should().BeNull();
        (await InvitationAsync(invitationId)).WaitsForOwner.Should().BeTrue();

        // Visible ≠ operational: no farm in his list, no farm data.
        (await MyActiveFarmsAsync(Joiner)).Should().NotContain(FarmA);
        using (var read = await GetAsync($"/shramsafal/farms/{FarmA}/labour-permissions", Joiner))
        {
            read.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        // Only the primary account holder answers it.
        using (var byCoOwner = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{invitationId}/approve", CoOwnerA, new { }))
        {
            byCoOwner.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        (await SeatAsync(FarmA, Joiner))!.Status.Should().Be(2);

        using var approved = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{invitationId}/approve", OwnerA, new { });
        approved.StatusCode.Should().Be(HttpStatusCode.OK, await approved.Content.ReadAsStringAsync());

        var seat = await SeatAsync(FarmA, Joiner);
        seat!.Status.Should().Be(3);
        seat.Role.Should().Be("Mukadam");
        seat.Label.Should().Be("Mukadam");
        seat.Labour.Should().BeTrue();
        seat.PlotScope.Should().Be("AllPlots");
        seat.ApprovedBy.Should().Be(OwnerA);
        seat.WorkerRecord.Should().BeNull("an owner's tap is not the worker's own proof");
        (await InvitationAsync(invitationId)).WaitsForOwner.Should().BeFalse();
    }

    [Fact]
    public async Task A_claim_from_a_different_or_unproven_number_waits_and_is_not_listed_for_it()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var forJoiner = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        var forUnverified = await CreateAsync(OwnerA, FarmA, Grant("Worker", UnverifiedPhone));

        (await MineAsync(Stranger)).Should().BeEmpty("it named another number");
        (await MineAsync(Unverified)).Should().BeEmpty("his number was never proven by a code");

        using (var wrong = await PostAsync("/shramsafal/invitations/accept", Stranger, new { code = forJoiner.GetProperty("code").GetString() }))
        {
            wrong.StatusCode.Should().Be(HttpStatusCode.OK, await wrong.Content.ReadAsStringAsync());
            JsonDocument.Parse(await wrong.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString()
                .Should().Be("PendingApproval");
        }

        using (var unproven = await PostAsync("/shramsafal/invitations/accept", Unverified, new { code = forUnverified.GetProperty("code").GetString() }))
        {
            unproven.StatusCode.Should().Be(HttpStatusCode.OK, await unproven.Content.ReadAsStringAsync());
            JsonDocument.Parse(await unproven.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString()
                .Should().Be("PendingApproval");
        }

        (await SeatAsync(FarmA, Stranger))!.Status.Should().Be(2);
        (await SeatAsync(FarmA, Unverified))!.Status.Should().Be(2);

        // By id (no code) only the named, proven number may claim.
        using var byId = await PostAsync("/shramsafal/invitations/accept", Stranger, new { invitationId = forUnverified.GetProperty("id").GetGuid() });
        byId.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── refusals ─────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Expired_used_declined_and_withdrawn_invitations_are_refused_with_their_reason()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var expired = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        await ExecSuperuserAsync(
            "UPDATE ssf.farm_personal_invitations SET created_at_utc = NOW() - INTERVAL '8 days', expires_at_utc = NOW() - INTERVAL '1 day' WHERE id = @id",
            ("id", expired.GetProperty("id").GetGuid()));
        await AssertRefusedAsync(Joiner, expired.GetProperty("code").GetString()!, "invitation.expired");
        using (var found = await PostAsync("/shramsafal/invitations/find", Joiner, new { code = expired.GetProperty("code").GetString() }))
        {
            JsonDocument.Parse(await found.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString()
                .Should().Be("Expired");
        }

        var used = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        using (var first = await PostAsync("/shramsafal/invitations/accept", Joiner, new { code = used.GetProperty("code").GetString() }))
        {
            first.StatusCode.Should().Be(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        }

        await AssertRefusedAsync(Stranger, used.GetProperty("code").GetString()!, "invitation.used");

        var declined = await CreateAsync(OwnerA, FarmA, Grant("Worker", StrangerPhone));
        using (var no = await PostAsync("/shramsafal/invitations/decline", Stranger, new { invitationId = declined.GetProperty("id").GetGuid() }))
        {
            no.StatusCode.Should().Be(HttpStatusCode.OK, await no.Content.ReadAsStringAsync());
        }

        (await InvitationAsync(declined.GetProperty("id").GetGuid())).Status.Should().Be("Declined");
        await AssertRefusedAsync(Stranger, declined.GetProperty("code").GetString()!, "invitation.declined");
        (await SeatAsync(FarmA, Stranger)).Should().BeNull("a declined invitation makes no seat");

        var withdrawn = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        using (var w = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{withdrawn.GetProperty("id").GetGuid()}/withdraw", OwnerA, new { }))
        {
            w.StatusCode.Should().Be(HttpStatusCode.OK, await w.Content.ReadAsStringAsync());
        }

        await AssertRefusedAsync(Unverified, withdrawn.GetProperty("code").GetString()!, "invitation.withdrawn");

        // Any wrong code: one answer, naming nothing.
        using var unknown = await PostAsync("/shramsafal/invitations/find", Joiner, new { code = "00000000" });
        unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await unknown.Content.ReadAsStringAsync()).Should().Be("{\"error\":\"invitation.unknown\"}");
    }

    [Fact]
    public async Task Only_the_primary_account_holder_may_invite_list_or_withdraw()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var caller in new[] { CoOwnerA, MukadamA, OldWorkerA, Stranger })
        {
            using var response = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", caller, Grant("Worker", null));
            response.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{caller} is not the primary account holder (D-26)");
            using var list = await GetAsync($"/shramsafal/farms/{FarmA}/personal-invitations", caller);
            list.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        (await CountInvitationsAsync(FarmA)).Should().Be(0);

        var made = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        using var byCoOwner = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{made.GetProperty("id").GetGuid()}/withdraw", CoOwnerA, new { });
        byCoOwner.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await InvitationAsync(made.GetProperty("id").GetGuid())).Status.Should().Be("Waiting");
    }

    [Fact]
    public async Task A_grant_the_server_would_not_hold_is_refused_at_creation()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var refused = new object[]
        {
            new { label = "PrimaryOwner", plotScope = "AllPlots", authorities = Array.Empty<object>() },
            new { label = "Worker", plotScope = "ChosenPlots", plotIds = Array.Empty<Guid>(), authorities = Array.Empty<object>() },
            new { label = "Worker", plotScope = "AllPlots", authorities = new object[] { new { name = "SeeWages", expiresAtUtc = (DateTime?)null } } },
            new { label = "Worker", plotScope = "AllPlots", authorities = new object[] { new { name = "TakeAttendance", expiresAtUtc = (DateTime?)DateTime.UtcNow.AddDays(-1) } } },
            new { label = "Worker", plotScope = "AllPlots", authorities = new object[] { new { name = "Invite", expiresAtUtc = (DateTime?)null } } },
            new { label = "Worker", plotScope = "AllPlots", invitedPhone = "12345", authorities = Array.Empty<object>() },
        };

        foreach (var body in refused)
        {
            using var response = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, body);
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest, JsonSerializer.Serialize(body));
        }

        (await CountInvitationsAsync(FarmA)).Should().Be(0);
    }

    // ── the generic farm QR / code ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_generic_farm_QR_only_asks_to_join_and_never_activates()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issued = await PostAsync($"/shramsafal/farms/{FarmA}/invite-qr", OwnerA, new { });
        var issuedBody = await issued.Content.ReadAsStringAsync();
        issued.StatusCode.Should().Be(HttpStatusCode.OK, issuedBody);
        using var invite = JsonDocument.Parse(issuedBody);
        var token = invite.RootElement.GetProperty("token").GetString();
        var farmCode = invite.RootElement.GetProperty("farmCode").GetString();

        using var claimed = await PostAsync("/shramsafal/join/claim", Joiner, new { token, farmCode });
        var claimedBody = await claimed.Content.ReadAsStringAsync();
        claimed.StatusCode.Should().Be(HttpStatusCode.OK, claimedBody);
        JsonDocument.Parse(claimedBody).RootElement.GetProperty("status").GetString().Should().Be("PendingApproval");
        (await SeatAsync(FarmA, Joiner))!.Status.Should().Be(2, "a wall QR asks; the owner chooses when approving");
        (await MyActiveFarmsAsync(Joiner)).Should().NotContain(FarmA);

        // A typed-code request is not answered by the QR any more either.
        using (var typed = await PostAsync("/shramsafal/join/by-code", Stranger, new { farmCode }))
        {
            typed.StatusCode.Should().Be(HttpStatusCode.OK, await typed.Content.ReadAsStringAsync());
        }

        using (var thenQr = await PostAsync("/shramsafal/join/claim", Stranger, new { token, farmCode }))
        {
            thenQr.StatusCode.Should().Be(HttpStatusCode.OK, await thenQr.Content.ReadAsStringAsync());
            JsonDocument.Parse(await thenQr.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString()
                .Should().Be("PendingApproval");
        }

        (await SeatAsync(FarmA, Stranger))!.Status.Should().Be(2);

        // A repeat scan by a person already let in is answered with his seat, unchanged.
        using var again = await PostAsync("/shramsafal/join/claim", MukadamA, new { token, farmCode });
        JsonDocument.Parse(await again.Content.ReadAsStringAsync()).RootElement.GetProperty("status").GetString().Should().Be("Active");
    }

    [Fact]
    public async Task Existing_Active_seats_are_unchanged_by_the_lane()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var before = await AllSeatsSnapshotAsync();
        before.Should().HaveCount(5);
        before.Should().OnlyContain(s => s.Contains("|label:|"), "no old seat is given a label by guessing (D-8, P4)");

        using (var issued = await PostAsync($"/shramsafal/farms/{FarmA}/invite-qr", OwnerA, new { }))
        {
            using var invite = JsonDocument.Parse(await issued.Content.ReadAsStringAsync());
            using var scan = await PostAsync("/shramsafal/join/claim", OldWorkerA, new
            {
                token = invite.RootElement.GetProperty("token").GetString(),
                farmCode = invite.RootElement.GetProperty("farmCode").GetString(),
            });
            scan.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var made = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        using (var accepted = await PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId = made.GetProperty("id").GetGuid() }))
        {
            accepted.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        var after = await AllSeatsSnapshotAsync();
        after.Should().HaveCount(6);
        after.Should().Contain(before, "every seat that existed is exactly as it was");
    }

    // ── tenancy, both ways (E4) ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Another_farms_invitation_is_invisible_and_unclaimable_through_this_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var onA = await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        var onAId = onA.GetProperty("id").GetGuid();

        // Farm B's owner, through his own farm's path, cannot see, withdraw or approve farm A's invitation.
        using (var list = await GetAsync($"/shramsafal/farms/{FarmB}/personal-invitations", OwnerB))
        {
            list.StatusCode.Should().Be(HttpStatusCode.OK);
            JsonDocument.Parse(await list.Content.ReadAsStringAsync()).RootElement.GetArrayLength().Should().Be(0);
        }

        using (var w = await PostAsync($"/shramsafal/farms/{FarmB}/personal-invitations/{onAId}/withdraw", OwnerB, new { }))
        {
            w.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        using (var w = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{onAId}/withdraw", OwnerB, new { }))
        {
            w.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        }

        (await InvitationAsync(onAId)).Status.Should().Be("Waiting");

        // Farm A's owner cannot put farm B's plot or farm B's worker into farm A's invitation (the foreign child).
        using (var foreignPlot = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, new
        {
            label = "Worker",
            plotScope = "ChosenPlots",
            plotIds = new[] { PlotB1 },
            authorities = Array.Empty<object>(),
        }))
        {
            foreignPlot.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        using (var foreignWorker = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, new
        {
            label = "Worker",
            plotScope = "OwnWork",
            fieldOperatorId = WorkerRecordB,
            authorities = Array.Empty<object>(),
        }))
        {
            foreignWorker.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        // At the database: the app role in farm B's scope sees none of farm A's invitations.
        (await VisibleInvitationCountAsAppAsync(FarmB)).Should().Be(0);
        (await VisibleInvitationCountAsAppAsync(FarmA)).Should().Be(1);
    }

    // ── WID ──────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_worker_link_happens_only_on_a_verified_number_claim()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Control first: the same worker named on an invitation without a number — the owner's tap links nothing.
        var unnamed = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Worker",
            plotScope = "OwnWork",
            fieldOperatorId = WorkerRecordA,
            authorities = Array.Empty<object>(),
        });
        using (var claim = await PostAsync("/shramsafal/invitations/accept", Stranger, new { code = unnamed.GetProperty("code").GetString() }))
        {
            claim.StatusCode.Should().Be(HttpStatusCode.OK, await claim.Content.ReadAsStringAsync());
        }

        using (var tap = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations/{unnamed.GetProperty("id").GetGuid()}/approve", OwnerA, new { }))
        {
            tap.StatusCode.Should().Be(HttpStatusCode.OK, await tap.Content.ReadAsStringAsync());
        }

        (await SeatAsync(FarmA, Stranger))!.WorkerRecord.Should().BeNull();
        (await IdentityEventCountAsync(WorkerRecordA, "LinkedToLogin")).Should().Be(0);

        // "This is रमेश from your हजेरी list", his number named, claimed by that proven number: linked.
        var named = await CreateAsync(OwnerA, FarmA, new
        {
            label = "Worker",
            invitedPhone = JoinerPhone,
            plotScope = "OwnWork",
            fieldOperatorId = WorkerRecordA,
            authorities = Array.Empty<object>(),
        });
        using var accepted = await PostAsync("/shramsafal/invitations/accept", Joiner, new { invitationId = named.GetProperty("id").GetGuid() });
        var body = await accepted.Content.ReadAsStringAsync();
        accepted.StatusCode.Should().Be(HttpStatusCode.OK, body);
        JsonDocument.Parse(body).RootElement.GetProperty("workerLinked").GetBoolean().Should().BeTrue();

        (await SeatAsync(FarmA, Joiner))!.WorkerRecord.Should().Be(WorkerRecordA);
        (await IdentityEventCountAsync(WorkerRecordA, "LinkedToLogin")).Should().Be(1);
        (await WorkerPhoneVerifiedAsync()).Should().BeTrue("his login code proved the number the owner typed for him (WID R3)");
    }

    // ── one waiting invitation per (farm, mobile) ────────────────────────────────────────────────

    [Fact]
    public async Task A_new_invitation_for_the_same_mobile_withdraws_the_old_one_with_an_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await CreateAsync(OwnerA, FarmA, Grant("Worker", JoinerPhone));
        var second = await CreateAsync(OwnerA, FarmA, Grant("Mukadam", "06000012345"));

        (await InvitationAsync(first.GetProperty("id").GetGuid())).Status.Should().Be("Withdrawn");
        (await InvitationAsync(second.GetProperty("id").GetGuid())).Status.Should().Be("Waiting");
        (await AuditCountAsync(FarmA, "PersonalInvitationWithdrawn")).Should().Be(1);
        (await MineAsync(Joiner)).Should().ContainSingle();
    }

    // ── rate limits ──────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Invitations_per_farm_per_day_and_code_guesses_per_user_per_hour_are_capped()
    {
        await AssertAppRoleIsNotVacuousAsync();

        for (var i = 0; i < 20; i++)
        {
            await CreateAsync(OwnerA, FarmA, Grant("Worker", null));
        }

        using (var over = await PostAsync($"/shramsafal/farms/{FarmA}/personal-invitations", OwnerA, Grant("Worker", null)))
        {
            over.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
            (await over.Content.ReadAsStringAsync()).Should().Contain("invitation.daily_cap");
        }

        (await CountInvitationsAsync(FarmA)).Should().Be(20);

        var statuses = new List<HttpStatusCode>();
        for (var i = 0; i < 11; i++)
        {
            using var guess = await PostAsync("/shramsafal/invitations/find", Joiner, new { code = $"1234{i:D4}" });
            statuses.Add(guess.StatusCode);
        }

        statuses.Take(10).Should().OnlyContain(s => s == HttpStatusCode.NotFound);
        statuses[10].Should().Be(HttpStatusCode.TooManyRequests, "ten guesses an hour per person");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    private static object Grant(string label, string? phone) => new
    {
        label,
        invitedPhone = phone,
        plotScope = label == "Worker" ? "OwnWork" : "AllPlots",
        authorities = Array.Empty<object>(),
    };

    private async Task<JsonElement> CreateAsync(Guid caller, Guid farm, object body)
    {
        using var response = await PostAsync($"/shramsafal/farms/{farm}/personal-invitations", caller, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Created, text);
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private async Task<List<Guid>> MineAsync(Guid caller)
    {
        using var response = await GetAsync("/shramsafal/invitations/mine", caller);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.EnumerateArray().Select(c => c.GetProperty("invitationId").GetGuid()).ToList();
    }

    private async Task AssertRefusedAsync(Guid caller, string code, string error)
    {
        using var response = await PostAsync("/shramsafal/invitations/accept", caller, new { code });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Conflict, text);
        JsonDocument.Parse(text).RootElement.GetProperty("error").GetString().Should().Be(error);
    }

    private async Task<List<Guid>> MyActiveFarmsAsync(Guid caller)
    {
        using var response = await GetAsync("/shramsafal/farms/mine", caller);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return JsonDocument.Parse(text).RootElement.EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid()).ToList();
    }

    private Task<HttpResponseMessage> GetAsync(string url, Guid caller)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Test-UserId", caller.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return _client.SendAsync(request);
    }

    private Task<HttpResponseMessage> PostAsync(string url, Guid caller, object body)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Test-UserId", caller.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn, string superuserConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-mu2", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            // Every connection this host may open is named here, to this lane's own cluster (TestProcessConnectionGuard).
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = superuserConn,
            ["ConnectionStrings:ShramSafalDb_ReadOnly"] = appConn,
            ["ConnectionStrings:UserDb_Migration"] = superuserConn,
            ["ConnectionStrings:UserDb_ReadOnly"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"mu2-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);
        builder.Services.AddAgriSyncRateLimiting(e2eHarnessEnabled: false);

        var app = builder.Build();
        app.UseForwardedHeaders(RateLimitingConfig.CreateForwardedHeadersOptions());
        app.UseAuthentication();
        app.UseRateLimiter();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private sealed record SeatRow(
        string Role, int Status, string? Label, string PlotScope, Guid[] PlotIds, bool Labour, DateTime? LabourEnd,
        int? Permissions, string? ExpiriesJson, Guid? ApprovedBy, Guid? PersonalInvitationId, Guid? WorkerRecord);

    private async Task<SeatRow?> SeatAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT role, status, relationship_label, plot_scope, scope_plot_ids, can_manage_labour_records,
                   labour_grant_expires_at_utc, permissions, authority_expires_at::text, approved_by_user_id,
                   personal_invitation_id, field_operator_id
            FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u AND status NOT IN (5, 6)
            """;
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        await using var r = await cmd.ExecuteReaderAsync();
        if (!await r.ReadAsync())
        {
            return null;
        }

        return new SeatRow(
            r.GetString(0), r.GetInt32(1), r.IsDBNull(2) ? null : r.GetString(2), r.GetString(3), (Guid[])r.GetValue(4),
            r.GetBoolean(5), r.IsDBNull(6) ? null : r.GetDateTime(6), r.IsDBNull(7) ? null : r.GetInt32(7),
            r.IsDBNull(8) ? null : r.GetString(8), r.IsDBNull(9) ? null : r.GetGuid(9), r.IsDBNull(10) ? null : r.GetGuid(10),
            r.IsDBNull(11) ? null : r.GetGuid(11));
    }

    private async Task<List<string>> AllSeatsSnapshotAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT concat_ws('|', "Id", farm_id, user_id, role, status, joined_via, coalesce(permissions::text, '-'),
                   can_manage_labour_records, coalesce(labour_grant_expires_at_utc::text, '-'),
                   coalesce(authority_expires_at::text, '-'), plot_scope, scope_plot_ids::text,
                   coalesce(approved_by_user_id::text, '-'), modified_at_utc, coalesce(access_changed_at_utc::text, '-'),
                   'label:', coalesce(relationship_label, ''))
                   || '|'
            FROM ssf.farm_memberships ORDER BY "Id"
            """;
        var rows = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(r.GetString(0));
        }

        return rows;
    }

    private sealed record InvitationRow(string Status, Guid? ClaimedBy, DateTime? ClaimedAt, bool WaitsForOwner);

    private async Task<InvitationRow> InvitationAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT status, claimed_by_user_id, claimed_at_utc, waits_for_owner
            FROM ssf.farm_personal_invitations WHERE id = @id
            """;
        cmd.Parameters.AddWithValue("id", id);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue("the invitation row exists");
        return new InvitationRow(
            r.GetString(0), r.IsDBNull(1) ? null : r.GetGuid(1), r.IsDBNull(2) ? null : r.GetDateTime(2), r.GetBoolean(3));
    }

    private async Task<long> CountInvitationsAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_personal_invitations WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<long> VisibleInvitationCountAsAppAsync(Guid farmScope)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var set = db.CreateCommand())
        {
            set.Transaction = tx;
            set.CommandText = "SELECT set_config('agrisync.farm_id', @f, true)";
            set.Parameters.AddWithValue("f", farmScope.ToString());
            await set.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_personal_invitations";
        var count = (long)(await cmd.ExecuteScalarAsync())!;
        await tx.RollbackAsync();
        return count;
    }

    private async Task<long> AuditCountAsync(Guid farm, string action, Guid? actor = null)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = actor is null
            ? "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = @a"
            : "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = @a AND actor_user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", action);
        if (actor is { } u)
        {
            cmd.Parameters.AddWithValue("u", u);
        }

        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<long> IdentityEventCountAsync(Guid record, string kind)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.shram_identity_events WHERE field_operator_id = @r AND kind = @k";
        cmd.Parameters.AddWithValue("r", record);
        cmd.Parameters.AddWithValue("k", kind);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<bool> WorkerPhoneVerifiedAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT verified_at_utc IS NOT NULL FROM ssf.shram_person_phones WHERE person_id = @p AND phone_e164 = '+916000012345'";
        cmd.Parameters.AddWithValue("p", WorkerPersonA);
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task ExecSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
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

    private static Task SeedUserAsync(NpgsqlConnection db, Guid id, string phone, string name, bool verified)
        => ExecAsync(db, """
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc,
                                      created_at_utc, is_active, auth_mode, preferred_language, phone_verified_at_utc)
            VALUES (@id, @phone, @name, 'x', NOW(), NOW(), TRUE, 1, 'mr', @verified);
            """,
            ("id", id), ("phone", phone), ("name", name), ("verified", verified ? DateTime.UtcNow : DBNull.Value));

    private static Task SeedFarmAsync(NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account, string code)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """,
            ("farm", farm), ("name", name), ("owner", owner), ("account", account), ("code", code));

    private static Task SeedSeatAsync(
        NpgsqlConnection db, Guid farm, Guid account, Guid user, string role, int status, int? permissions = null, bool labour = false)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via,
                 permissions, can_manage_labour_records)
            VALUES (@id, @farm, @user, @role, NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', @account, @status, 2,
                    @permissions, @labour);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", user), ("role", role), ("account", account), ("status", status),
            ("permissions", (object?)permissions ?? DBNull.Value), ("labour", labour));

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
