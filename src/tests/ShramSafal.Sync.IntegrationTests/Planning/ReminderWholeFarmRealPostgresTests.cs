// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1, CTO ruling on review m2 (doctrine E3).
//
// "आठवणींची मांडणी बदलणे" (ManageReminders) may be held ONLY by a whole-farm seat, on a real Postgres as agrisync_app, through the real host: the
// authorities route refuses it for a Worker label, a chosen-plots seat and a seat on स्वतःचं काम (400, nothing stored, no history row); a stored grant that
// no longer fits the seat (a hand-written bit, or a seat narrowed after the grant) holds nothing on every read - the settings routes answer 403 and the
// seat never receives the Members list - and returns the moment he sees the whole farm again, with nothing migrated.
using System;
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
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ReminderWholeFarmRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private const int ManageRemindersBit = 1 << 13;

    private async Task<(HttpStatusCode Status, string Body)> GetSettingsAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, SettingsUrl(), user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REM-1] {user} GET settings -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private string AuthoritiesUrl(Guid user) => $"/shramsafal/farms/{FarmA}/memberships/{user}/authorities";

    private static object Body(params string[] names) =>
        new { authorities = names.Select(n => new { name = n, expiresAtUtc = (DateTime?)null }).ToArray() };

    private async Task<int> StoredBitsAsync(Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT coalesce(permissions, 0) FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", FarmA);
        cmd.Parameters.AddWithValue("u", user);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<long> AuthorityAuditRowsAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND action = 'MemberAuthoritiesChanged'";
        cmd.Parameters.AddWithValue("f", FarmA);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private Task StoreBitAsync(Guid user) => ExecOnSuperuserAsync(
        "UPDATE ssf.farm_memberships SET permissions = coalesce(permissions, 0) | @bit WHERE farm_id = @f AND user_id = @u",
        ("bit", ManageRemindersBit), ("f", FarmA), ("u", user));

    private async Task SetPlotScopeAsync(Guid person, string scope, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            plots.Length == 0 ? new { plotScope = scope } : (object)new { plotScope = scope, plotIds = plots });
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    /// <summary>/me/context's authorities on farm A: the REAL reader over the app-role connection (RLS on).</summary>
    private async Task<System.Collections.Generic.IReadOnlyList<string>> MeAuthoritiesAsync(Guid who)
    {
        await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);
        await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(SuperuserConn).Options);
        var farms = await new FarmMembershipSnapshotReader(ssf, accounts, new UtcClock()).GetForUserAsync(new UserId(who));
        return farms.Single(f => f.FarmId == new FarmId(FarmA)).Authorities.Select(a => a.Name).ToList();
    }

    private sealed class UtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }

    // ── the grant door: the authorities route ────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_authorities_route_refuses_it_for_a_worker_a_chosen_plots_seat_and_an_own_work_seat_and_gives_it_to_a_whole_farm_seat()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", PlotA, plot2);
        await SetPlotScopeAsync(CoOwner, "OwnWork");
        var auditBefore = await AuthorityAuditRowsAsync();

        foreach (var (person, why) in new[] { (Worker, "a Worker label"), (Mukadam, "a chosen-plots seat"), (CoOwner, "a seat on स्वतःचं काम") })
        {
            foreach (var set in new[] { Body("ManageReminders"), Body("TakeAttendance", "ManageReminders") })
            {
                using var refused = await SendAsync(HttpMethod.Put, AuthoritiesUrl(person), Owner, set);
                refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, $"{why}: {await refused.Content.ReadAsStringAsync()}");
            }

            ((await StoredBitsAsync(person)) & ManageRemindersBit).Should().Be(0, $"{why}: the bit was not stored");
            (await GetSettingsAsync(person)).Status.Should().Be(HttpStatusCode.Forbidden, why);
        }

        (await AuthorityAuditRowsAsync()).Should().Be(auditBefore, "a refused decision leaves no history row");

        // Control: the same set without it is fine for the same seat, so the 400 above is about THIS authority; and a whole-farm seat takes it.
        using (var fine = await SendAsync(HttpMethod.Put, AuthoritiesUrl(Worker), Owner, Body("TakeAttendance")))
        {
            fine.StatusCode.Should().Be(HttpStatusCode.OK, await fine.Content.ReadAsStringAsync());
        }

        await SetPlotScopeAsync(CoOwner, "AllPlots");
        using (var granted = await SendAsync(HttpMethod.Put, AuthoritiesUrl(CoOwner), Owner, Body("ManageReminders")))
        {
            granted.StatusCode.Should().Be(HttpStatusCode.OK, await granted.Content.ReadAsStringAsync());
        }

        (await StoredBitsAsync(CoOwner)).Should().Be(ManageRemindersBit);
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "a whole-farm seat holds it");
        (await MeAuthoritiesAsync(CoOwner)).Should().Contain("ManageReminders");
    }

    // ── every read drops a stale grant ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_stale_grant_on_a_part_farm_seat_passes_no_door_and_the_seat_never_receives_the_members()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await StoreBitAsync(Worker);                                      // a hand-written bit on a Worker label
        await SetPlotScopeAsync(Mukadam, "OwnWork");
        await StoreBitAsync(Mukadam);                                     // a bit on a seat that sees only his own work

        foreach (var user in new[] { Worker, Mukadam })
        {
            var (status, body) = await GetSettingsAsync(user);
            status.Should().Be(HttpStatusCode.Forbidden, $"read, {user}");
            body.Should().NotContain(OwnerName).And.NotContain(CoOwnerName).And.NotContain(WorkerName, "no Members list reaches him");
            (await PutSettingsAsync(user, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.Forbidden, $"write, {user}");
            (await MarkAsync(user, Worker2)).Status.Should().Be(HttpStatusCode.Forbidden, $"mark, {user}");
            (await MeAuthoritiesAsync(user)).Should().NotContain("ManageReminders", $"/me/context drops it, {user}");
        }

        (await SettingsRowAsync()).Should().BeNull("nothing was written");
        (await MarkCountAsync()).Should().Be(0);

        // Control: the same stored bit on a whole-farm seat is held, and he receives the members.
        await StoreBitAsync(CoOwner);
        var (okStatus, okBody) = await GetSettingsAsync(CoOwner);
        okStatus.Should().Be(HttpStatusCode.OK, okBody);
        JsonDocument.Parse(okBody).RootElement.GetProperty("members").GetArrayLength().Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task A_seat_narrowed_after_the_grant_loses_the_door_and_gets_it_back_when_he_sees_the_whole_farm_again()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(CoOwner, FarmAuthority.ManageReminders);
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "control: held while he sees the whole farm");

        await SetPlotScopeAsync(CoOwner, "ChosenPlots", PlotA);
        (await StoredBitsAsync(CoOwner)).Should().Be(ManageRemindersBit, "nothing is migrated: the stored grant stays");
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PutSettingsAsync(CoOwner, own: "PlotTeam")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await MeAuthoritiesAsync(CoOwner)).Should().NotContain("ManageReminders");

        await SetPlotScopeAsync(CoOwner, "AllPlots");
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "the same stored grant holds again");
        (await MeAuthoritiesAsync(CoOwner)).Should().Contain("ManageReminders");
    }
}
