// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D1 (founder D-81; R19, P5, P11, E3, E4).
//
// "तुलना पाहणे" is a new farm authority: bit 12 of ssf.farm_memberships.permissions (no migration), OFF for every seat until the
// PRIMARY owner gives it (a co-owner cannot, like every other bit), always held by the primary owner, never held by a Worker
// seat. /me/context lists it only when it is held. Proved on a real Postgres as agrisync_app (E3 asserted first in every fact),
// through the production host's routes and the real /me/context reader. The compare READ that will require it is lane CMP-D2:
// nothing here reads a compare.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class SeeCompareAuthorityRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const int SeeCompareBit = 1 << 12;

    /// <summary>A mukadam on farm B too, so "another farm's seat is unaffected" (E4) has a seat to look at.</summary>
    private static readonly Guid MukadamOnB = Guid.Parse("3d030000-0000-4000-8000-0000000000c1");

    private string AuthoritiesUrl(Guid farm, Guid user) => $"/shramsafal/farms/{farm}/memberships/{user}/authorities";

    private static object Body(params string[] names) =>
        new { authorities = names.Select(n => new { name = n, expiresAtUtc = (DateTime?)null }).ToArray() };

    private async Task<int> StoredBitsAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT coalesce(permissions, 0) FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> AuthorityAuditRowsAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = 'MemberAuthoritiesChanged'";
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<bool> LabourFlagAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    /// <summary>/me/context's authorities on one farm: the REAL reader over the app-role connection (RLS on).</summary>
    private async Task<IReadOnlyList<string>> MeAuthoritiesAsync(Guid who, Guid farm)
    {
        await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);
        await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(SuperuserConn).Options);
        var farms = await new FarmMembershipSnapshotReader(ssf, accounts, new UtcClock()).GetForUserAsync(new UserId(who));
        return farms.Single(f => f.FarmId == new FarmId(farm)).Authorities.Select(a => a.Name).ToList();
    }

    private async Task SeedMukadamOnFarmBAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmB, @who, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @accountB, 3, NULL, FALSE);
            """, ("farmB", FarmB), ("who", Mukadam), ("accountB", AccountB));
    }

    // ── /me/context lists it only when it is held ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_owner_gives_it_it_is_listed_and_he_takes_it_back_and_it_is_not()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await MeAuthoritiesAsync(Owner, FarmA)).Should().Contain("SeeCompare", "the primary owner always holds it");
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().NotContain("SeeCompare", "off until given: the start value");
        (await MeAuthoritiesAsync(CoOwner, FarmA)).Should().NotContain("SeeCompare");
        (await StoredBitsAsync(FarmA, Mukadam)).Should().Be(0, "nothing is stored by default - no migration moved a bit");

        using (var give = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), Owner, Body("TakeAttendance", "SeeCompare")))
        {
            var text = await give.Content.ReadAsStringAsync();
            give.StatusCode.Should().Be(HttpStatusCode.OK, text);
            JsonDocument.Parse(text).RootElement.GetProperty("authorities").EnumerateArray()
                .Select(a => a.GetProperty("name").GetString()).Should().BeEquivalentTo("TakeAttendance", "SeeCompare");
        }

        (await StoredBitsAsync(FarmA, Mukadam)).Should().Be(SeeCompareBit | 0, "bit 12 only; take attendance is the labour flag");
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().Contain("SeeCompare");

        // The owner's roster says so too (the team card reads it), with the bit's name, never its number.
        using (var roster = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/labour-permissions", Owner))
        {
            var members = JsonDocument.Parse(await roster.Content.ReadAsStringAsync()).RootElement.EnumerateArray()
                .ToDictionary(m => m.GetProperty("userId").GetGuid());
            members[Mukadam].GetProperty("permissions").EnumerateArray().Select(p => p.GetString()).Should().Contain("SeeCompare");
        }

        using (var take = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), Owner, Body("TakeAttendance")))
        {
            take.StatusCode.Should().Be(HttpStatusCode.OK, await take.Content.ReadAsStringAsync());
        }

        (await StoredBitsAsync(FarmA, Mukadam)).Should().Be(0);
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().NotContain("SeeCompare", "the next context no longer lists it");
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().Contain("TakeAttendance", "the other authority he was given stays");
    }

    [Fact]
    public async Task A_grant_with_an_end_is_listed_until_the_end_and_not_after()
    {
        await AssertAppRoleIsNotVacuousAsync();
        using (var give = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, CoOwner), Owner, new
        {
            authorities = new object[] { new { name = "SeeCompare", expiresAtUtc = (DateTime?)DateTime.UtcNow.AddHours(1) } },
        }))
        {
            give.StatusCode.Should().Be(HttpStatusCode.OK, await give.Content.ReadAsStringAsync());
        }

        (await MeAuthoritiesAsync(CoOwner, FarmA)).Should().Contain("SeeCompare", "held until its end");

        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET authority_expires_at = jsonb_build_object('4096', to_char((NOW() - INTERVAL '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')) WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", CoOwner));
        (await MeAuthoritiesAsync(CoOwner, FarmA)).Should().NotContain("SeeCompare", "an ended grant holds nothing");
    }

    // ── A Worker seat can never hold it ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_grant_to_a_worker_is_refused_400_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var auditBefore = await AuthorityAuditRowsAsync(FarmA);

        foreach (var set in new[] { Body("SeeCompare"), Body("TakeAttendance", "SeeCompare") })
        {
            using var refused = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Worker), Owner, set);
            refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, await refused.Content.ReadAsStringAsync());
        }

        (await StoredBitsAsync(FarmA, Worker)).Should().Be(0, "no bit was stored");
        (await LabourFlagAsync(FarmA, Worker)).Should().BeFalse("the other half of the refused set was not applied either");
        (await AuthorityAuditRowsAsync(FarmA)).Should().Be(auditBefore, "a refused decision leaves no history row");
        (await MeAuthoritiesAsync(Worker, FarmA)).Should().NotContain("SeeCompare");

        // Control: the same set without it is fine for the same seat, so the 400 above is about THIS authority.
        using var fine = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Worker), Owner, Body("TakeAttendance"));
        fine.StatusCode.Should().Be(HttpStatusCode.OK, await fine.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task A_bit_written_by_hand_on_a_worker_seat_is_not_listed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = @bit WHERE farm_id = @f AND user_id = @u",
            ("bit", SeeCompareBit), ("f", FarmA), ("u", Worker));

        (await MeAuthoritiesAsync(Worker, FarmA)).Should().NotContain("SeeCompare", "a Worker seat never holds it, whatever is stored");

        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = @bit WHERE farm_id = @f AND user_id = @u",
            ("bit", SeeCompareBit), ("f", FarmA), ("u", Mukadam));
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().Contain("SeeCompare", "control: the same stored bit on a mukadam seat is held");
    }

    // ── Who may give it: the primary owner alone, like every other authority ──────────────────────────────────────────

    [Fact]
    public async Task A_co_owner_cannot_give_it_even_holding_every_authority_and_the_refusal_is_the_one_every_bit_gets()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // He holds everything the owner can give (all thirteen bits, 12 stored here), and still may not change anybody's.
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = @all, can_manage_labour_records = TRUE WHERE farm_id = @f AND user_id = @u",
            ("all", 1 | 2 | 8 | 32 | 64 | 128 | 256 | 512 | 1024 | 2048 | SeeCompareBit), ("f", FarmA), ("u", CoOwner));
        var auditBefore = await AuthorityAuditRowsAsync(FarmA);

        using var seeCompare = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), CoOwner, Body("SeeCompare"));
        using var seeAllTasks = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), CoOwner, Body("SeeAllTasks"));

        seeAllTasks.StatusCode.Should().Be(HttpStatusCode.Forbidden, "the control: an existing bit gets this answer");
        seeCompare.StatusCode.Should().Be(seeAllTasks.StatusCode, "the same rule, no second mechanism");
        (await seeCompare.Content.ReadAsStringAsync()).Should().Be(await seeAllTasks.Content.ReadAsStringAsync());
        (await StoredBitsAsync(FarmA, Mukadam)).Should().Be(0);
        (await AuthorityAuditRowsAsync(FarmA)).Should().Be(auditBefore);
    }

    // ── Another farm's seat is unaffected (E4) ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Giving_it_on_one_farm_does_nothing_on_another_and_the_other_farms_owner_cannot_give_it_here()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedMukadamOnFarmBAsync();

        using (var give = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), Owner, Body("SeeCompare")))
        {
            give.StatusCode.Should().Be(HttpStatusCode.OK, await give.Content.ReadAsStringAsync());
        }

        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().Contain("SeeCompare");
        (await MeAuthoritiesAsync(Mukadam, FarmB)).Should().NotContain("SeeCompare", "farm B's seat of the same person is untouched");
        (await StoredBitsAsync(FarmB, Mukadam)).Should().Be(0);

        // The owner of farm B has no say on farm A's seat, and farm A's owner has none on farm B's.
        using var otherOwner = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), OwnerB, Body("SeeCompare", "TakeAttendance"));
        otherOwner.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var wrongFarm = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmB, Mukadam), Owner, Body("SeeCompare"));
        wrongFarm.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await StoredBitsAsync(FarmB, Mukadam)).Should().Be(0);
        (await StoredBitsAsync(FarmA, Mukadam)).Should().Be(SeeCompareBit, "farm A's seat kept exactly what its owner gave");

        // And taking it back on A leaves B as it was.
        using (var take = await SendAsync(HttpMethod.Put, AuthoritiesUrl(FarmA, Mukadam), Owner, Body()))
        {
            take.StatusCode.Should().Be(HttpStatusCode.OK, await take.Content.ReadAsStringAsync());
        }

        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().NotContain("SeeCompare");
        (await MeAuthoritiesAsync(Owner, FarmA)).Should().Contain("SeeCompare", "the owner's own never moved");
    }

    // ── The other doors a Worker could be given it through (fix round 1, review N002 / N003) ──────────────────────────

    private async Task<long> InvitationRowsAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_personal_invitations WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<string> SeatTextAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT role || '/' || status::text || '/' || coalesce(permissions, 0)::text || '/' || can_manage_labour_records::text FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private static object InvitationBody(string label, string plotScope, params string[] authorities) => new
    {
        label,
        plotScope,
        authorities = authorities.Select(n => new { name = n, expiresAtUtc = (DateTime?)null }).ToArray(),
    };

    [Fact]
    public async Task A_personal_invitation_to_a_worker_naming_it_is_refused_and_writes_no_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var before = await InvitationRowsAsync(FarmA);

        using var refused = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/personal-invitations", Owner,
            InvitationBody("Worker", "OwnWork", "SeeCompare"));
        var text = await refused.Content.ReadAsStringAsync();
        refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
        text.Should().Contain("invitation.authority_does_nothing", "the card's own reason, not a generic 400");
        (await InvitationRowsAsync(FarmA)).Should().Be(before, "nothing was written");

        // Control: the same authority on a मुकादम invitation is made.
        using var made = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/personal-invitations", Owner,
            InvitationBody("Mukadam", "AllPlots", "SeeCompare"));
        made.StatusCode.Should().Be(HttpStatusCode.Created, await made.Content.ReadAsStringAsync());
        (await InvitationRowsAsync(FarmA)).Should().Be(before + 1);
    }

    [Fact]
    public async Task The_legacy_permission_name_list_cannot_give_it_to_a_worker_on_approval_or_on_an_access_change()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var waiting = Guid.Parse("3d030000-0000-4000-8000-0000000000c2");
        await ExecOnSuperuserAsync("""
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@who, '9300000777', 'प्रतीक्षा-सुमन', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmA, @who, 'Worker', NOW(), NOW(), @accountA, 2, NULL, FALSE);
            """, ("who", waiting), ("farmA", FarmA), ("accountA", AccountA));
        var waitingBefore = await SeatTextAsync(FarmA, waiting);
        var mukadamBefore = await SeatTextAsync(FarmA, Mukadam);
        var auditBefore = await AuthorityAuditRowsAsync(FarmA);

        using (var approve = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/memberships/{waiting}/approve", Owner,
                   new { role = "Worker", permissions = new[] { "SeeCompare" } }))
        {
            approve.StatusCode.Should().Be(HttpStatusCode.BadRequest, await approve.Content.ReadAsStringAsync());
        }

        using (var change = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/access", Owner,
                   new { role = "Worker", permissions = new[] { "SeeCompare" } }))
        {
            change.StatusCode.Should().Be(HttpStatusCode.BadRequest, await change.Content.ReadAsStringAsync());
        }

        (await SeatTextAsync(FarmA, waiting)).Should().Be(waitingBefore, "the waiting request is still waiting, nothing stored");
        (await SeatTextAsync(FarmA, Mukadam)).Should().Be(mukadamBefore, "the mukadam stayed a mukadam with what he had");
        (await AuthorityAuditRowsAsync(FarmA)).Should().Be(auditBefore);

        // Control: the same name on a non-Worker label is accepted.
        using var fine = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/access", Owner,
            new { permissions = new[] { "SeeCompare" } });
        fine.StatusCode.Should().Be(HttpStatusCode.OK, await fine.Content.ReadAsStringAsync());
        (await MeAuthoritiesAsync(Mukadam, FarmA)).Should().Contain("SeeCompare");
    }

    [Fact]
    public async Task A_worker_row_carrying_the_bit_still_takes_an_unrelated_access_change_and_the_bit_is_gone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync(
            "UPDATE ssf.farm_memberships SET permissions = @bit WHERE farm_id = @f AND user_id = @u",
            ("bit", SeeCompareBit), ("f", FarmA), ("u", Worker));

        using var change = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Worker}/access", Owner,
            new { labourGrant = true });
        change.StatusCode.Should().Be(HttpStatusCode.OK, "an unrelated change is not blocked by a bit he cannot hold: " + await change.Content.ReadAsStringAsync());

        (await StoredBitsAsync(FarmA, Worker) & SeeCompareBit).Should().Be(0, "the barred bit is gone");
        (await LabourFlagAsync(FarmA, Worker)).Should().BeTrue("the change he asked for was applied");
        (await MeAuthoritiesAsync(Worker, FarmA)).Should().NotContain("SeeCompare");
    }

    private sealed class UtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }
}
