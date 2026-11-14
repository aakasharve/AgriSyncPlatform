// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1b (founder B9, reversing the REM-1 m2 ruling).
//
// "आठवणींची मांडणी बदलणे" (ManageReminders) may be held by a मुकादम or a सहमालक seat of ANY plot scope (every plot, chosen plots, स्वतःचं काम), never by a
// कामगार label, on a real Postgres as agrisync_app, through the real host: the authorities route refuses it for a Worker label on every scope (400, nothing
// stored, no history row) and gives it to a मुकादम / सहमालक on every scope; a grant stays in force when the seat's plots are changed (nothing migrated), the
// plot-limited holder reads the settings and the full member list; a hand-written Worker bit holds nothing on every read.
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
public sealed class ReminderSeatsRealPostgresTests(ITestOutputHelper output) : ReminderLane(output)
{
    private const int ManageRemindersBit = 1 << 13;

    private async Task<(HttpStatusCode Status, string Body)> GetSettingsAsync(Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, SettingsUrl(), user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REM-1b] {user} GET settings -> {(int)response.StatusCode} {text}");
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
    public async Task The_authorities_route_refuses_it_for_a_worker_on_every_scope_and_gives_it_to_a_mukadam_and_a_co_owner_on_every_scope()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        var auditBefore = await AuthorityAuditRowsAsync();

        // The कामगार label: refused whatever he sees (400, nothing stored, 403 at the settings door, no history row).
        foreach (var scope in new[] { "AllPlots", "OwnWork", "ChosenPlots" })
        {
            await SetPlotScopeAsync(Worker, scope, scope == "ChosenPlots" ? new[] { PlotA, plot2 } : Array.Empty<Guid>());
            foreach (var set in new[] { Body("ManageReminders"), Body("TakeAttendance", "ManageReminders") })
            {
                using var refused = await SendAsync(HttpMethod.Put, AuthoritiesUrl(Worker), Owner, set);
                refused.StatusCode.Should().Be(HttpStatusCode.BadRequest, $"a Worker label on {scope}: {await refused.Content.ReadAsStringAsync()}");
            }

            ((await StoredBitsAsync(Worker)) & ManageRemindersBit).Should().Be(0, $"a Worker label on {scope}: the bit was not stored");
            (await GetSettingsAsync(Worker)).Status.Should().Be(HttpStatusCode.Forbidden, $"a Worker label on {scope}");
        }

        (await AuthorityAuditRowsAsync()).Should().Be(auditBefore, "a refused decision leaves no history row");

        // Control: the same set without it is fine for the same seat, so the 400 above is about THIS authority.
        using (var fine = await SendAsync(HttpMethod.Put, AuthoritiesUrl(Worker), Owner, Body("TakeAttendance")))
        {
            fine.StatusCode.Should().Be(HttpStatusCode.OK, await fine.Content.ReadAsStringAsync());
        }

        // A मुकादम and a सहमालक: given on every scope, stored, held at the settings door and in /me/context.
        foreach (var (person, label) in new[] { (Mukadam, "a मुकादम"), (CoOwner, "a सहमालक") })
        {
            foreach (var scope in new[] { "ChosenPlots", "OwnWork", "AllPlots" })
            {
                await SetPlotScopeAsync(person, scope, scope == "ChosenPlots" ? new[] { PlotA, plot2 } : Array.Empty<Guid>());
                using var granted = await SendAsync(HttpMethod.Put, AuthoritiesUrl(person), Owner, Body("ManageReminders"));
                granted.StatusCode.Should().Be(HttpStatusCode.OK, $"{label} on {scope}: {await granted.Content.ReadAsStringAsync()}");

                (await StoredBitsAsync(person)).Should().Be(ManageRemindersBit, $"{label} on {scope}");
                (await GetSettingsAsync(person)).Status.Should().Be(HttpStatusCode.OK, $"{label} on {scope} holds it");
                (await MeAuthoritiesAsync(person)).Should().Contain("ManageReminders", $"{label} on {scope}: /me/context honours it");
            }
        }
    }

    // ── every read: a grant is honoured whatever the plots; a stored Worker bit is dropped ───────────────────────────────

    [Fact]
    public async Task A_stored_worker_bit_passes_no_door_and_the_worker_never_receives_the_members()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await StoreBitAsync(Worker);                                      // a hand-written bit on a Worker label

        foreach (var scope in new[] { "OwnWork", "AllPlots", "ChosenPlots" })
        {
            await SetPlotScopeAsync(Worker, scope, scope == "ChosenPlots" ? new[] { PlotA } : Array.Empty<Guid>());
            var (status, body) = await GetSettingsAsync(Worker);
            status.Should().Be(HttpStatusCode.Forbidden, $"read, Worker on {scope}");
            body.Should().NotContain(OwnerName).And.NotContain(CoOwnerName).And.NotContain(WorkerName, "no Members list reaches him");
            (await PutSettingsAsync(Worker, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.Forbidden, $"write, Worker on {scope}");
            (await MarkAsync(Worker, Worker2)).Status.Should().Be(HttpStatusCode.Forbidden, $"mark, Worker on {scope}");
            (await MeAuthoritiesAsync(Worker)).Should().NotContain("ManageReminders", $"/me/context drops it, Worker on {scope}");
        }

        (await SettingsRowAsync()).Should().BeNull("nothing was written");
        (await MarkCountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task A_plot_limited_holder_reads_and_changes_the_settings_and_receives_the_full_member_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetPlotScopeAsync(Mukadam, "OwnWork");
        await StoreBitAsync(Mukadam);                                     // a bit on a seat that sees only his own work

        var (okStatus, okBody) = await GetSettingsAsync(Mukadam);
        okStatus.Should().Be(HttpStatusCode.OK, okBody);
        okBody.Should().Contain(WorkerName, "the founder accepted it: a plot-limited holder sees the full member list").And.Contain(CoOwnerName);
        JsonDocument.Parse(okBody).RootElement.GetProperty("members").GetArrayLength().Should().BeGreaterThan(1);
        (await PutSettingsAsync(Mukadam, log: "PlotTeam")).Status.Should().Be(HttpStatusCode.OK);
        (await MeAuthoritiesAsync(Mukadam)).Should().Contain("ManageReminders");
    }

    [Fact]
    public async Task A_plot_limited_holder_of_farm_A_cannot_read_or_change_farm_Bs_settings_which_answer_like_an_unknown_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetPlotScopeAsync(Mukadam, "OwnWork");
        await StoreBitAsync(Mukadam);
        (await GetSettingsAsync(Mukadam)).Status.Should().Be(HttpStatusCode.OK, "control: he holds it on his own farm");

        using var foreignRead = await SendAsync(HttpMethod.Get, SettingsUrl(FarmB), Mukadam);
        using var unknownRead = await SendAsync(HttpMethod.Get, SettingsUrl(Guid.NewGuid()), Mukadam);
        foreignRead.StatusCode.Should().Be(unknownRead.StatusCode);
        foreignRead.StatusCode.Should().NotBe(HttpStatusCode.OK);
        (await foreignRead.Content.ReadAsStringAsync()).Should().Be(await unknownRead.Content.ReadAsStringAsync());

        var foreign = await PutSettingsAsync(Mukadam, log: "PlotTeam", farm: FarmB);
        var unknown = await PutSettingsAsync(Mukadam, log: "PlotTeam", farm: Guid.NewGuid());
        foreign.Status.Should().Be(unknown.Status);
        foreign.Body.Should().Be(unknown.Body);
        foreign.Status.Should().NotBe(HttpStatusCode.OK);
        (await SettingsRowAsync(FarmB)).Should().BeNull("nothing was written to farm B");
    }

    [Fact]
    public async Task A_seat_narrowed_after_the_grant_keeps_the_door_and_the_stored_grant_is_untouched()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(CoOwner, FarmAuthority.ManageReminders);
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "control: held while he sees the whole farm");

        await SetPlotScopeAsync(CoOwner, "ChosenPlots", PlotA);
        (await StoredBitsAsync(CoOwner)).Should().Be(ManageRemindersBit, "nothing is migrated: the stored grant stays");
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "a plot-limited co-owner still holds it");
        (await PutSettingsAsync(CoOwner, own: "PlotTeam")).Status.Should().Be(HttpStatusCode.OK);
        (await MeAuthoritiesAsync(CoOwner)).Should().Contain("ManageReminders");

        await SetPlotScopeAsync(CoOwner, "OwnWork");
        (await GetSettingsAsync(CoOwner)).Status.Should().Be(HttpStatusCode.OK, "and on his own work");
        (await MeAuthoritiesAsync(CoOwner)).Should().Contain("ManageReminders");
    }
}
