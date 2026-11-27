// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S3; founder 27 Nov: the saved screen's read-only "हे दिसतं: मालक, मुकादम")
//
// On a real Postgres AS THE RESTRICTED APPLICATION ROLE (E3 first), through the real pull: a pull that does not ask (or asks unreadably) carries no
// seenBy anywhere; a pull that asks (seenBy=1) carries, on each farm it reads, the labels of the REAL live seats that would see his work, हजेरी and money
// (a मुकादम on plot 2 listed with plot 2 only; a कामगार who reads only his own records never listed for work; a paused seat never listed); the reader
// himself and the registrant are never listed; money lists nobody while the farm's money is private; and nothing in it is a name or a user id.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class SeenByRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid Plot2 = Guid.Parse("3d100000-0000-4000-8000-000000000002");

    private async Task<(string Body, JsonElement Root)> PullWithAsync(Guid user, string query)
    {
        using var response = await SendAsync(HttpMethod.Get, "/sync/pull?since=1970-01-01T00%3A00%3A00Z" + query, user);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return (body, JsonDocument.Parse(body).RootElement.Clone());
    }

    private static JsonElement SeenByOf(JsonElement root, Guid farm) =>
        root.GetProperty("accessScopes").EnumerateArray().Single(s => s.GetProperty("farmId").GetGuid() == farm).GetProperty("seenBy");

    private static IReadOnlyList<string> Entries(JsonElement seenBy, string list) =>
        seenBy.GetProperty(list).EnumerateArray()
            .Select(e => e.GetProperty("who").GetString()
                + (e.TryGetProperty("plotIds", out var plots) ? ":" + string.Join(",", plots.EnumerateArray().Select(p => p.GetString())) : string.Empty))
            .ToList();

    [Fact]
    public async Task A_pull_that_does_not_ask_has_no_seenBy_key()
    {
        await AssertAppRoleIsNotVacuousAsync();
        foreach (var query in new[] { string.Empty, "&seenBy=", "&seenBy=abc", "&seenBy=0", "&seenBy=-1", "&seenBy=99999999999999" })
        {
            var (body, _) = await PullWithAsync(Worker, query);
            body.Should().NotContain("seenBy", $"'{query}' does not ask (or cannot be read): it says nothing and never refuses the pull");
        }
    }

    [Fact]
    public async Task A_mukadam_on_plot_2_is_listed_for_work_with_plot_2_only()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot2, @farmA, 'प्लॉट 2', 1.0, NOW(), NOW());
            """, ("plot2", Plot2), ("farmA", FarmA));
        using (var put = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { Plot2 } }))
        {
            put.StatusCode.Should().Be(HttpStatusCode.OK, await put.Content.ReadAsStringAsync());
        }

        var (_, root) = await PullWithAsync(Worker, "&seenBy=1");
        var seenBy = SeenByOf(root, FarmA);

        // His work: the सहमालक (every plot) and the मुकादम (plot 2 only); never the other कामगार (own records only) or the paused seat.
        Entries(seenBy, "work").Should().Equal("Mukadam:" + Plot2, "SecondaryOwner");
        // हजेरी: the two seats holding "हजेरी घेणे".
        Entries(seenBy, "attendance").Should().Equal("Mukadam", "SecondaryOwner");
        // Money: nobody but the registrant sees this farm's money (the सहमालक's money is switched off in the fixture).
        Entries(seenBy, "money").Should().BeEmpty();
    }

    [Fact]
    public async Task Money_lists_nobody_while_money_is_private()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.TakeAttendance);

        Entries(SeenByOf((await PullWithAsync(Mukadam, "&seenBy=1")).Root, FarmA), "money").Should().Equal("SecondaryOwner");

        await PushAppliedAsync(Owner, "farm.money_private.set", "perm-seenby-private", new Dictionary<string, object?> { ["farmId"] = FarmA, ["isPrivate"] = true });
        var seenBy = SeenByOf((await PullWithAsync(Mukadam, "&seenBy=1")).Root, FarmA);
        Entries(seenBy, "money").Should().BeEmpty("while the farm's money is private only the registrant (and the maker) see new money");
        Entries(seenBy, "work").Should().Contain("SecondaryOwner", "the work itself is still the team's");
    }

    [Fact]
    public async Task seenBy_carries_no_name_and_no_user_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, root) = await PullWithAsync(Owner, "&seenBy=1");
        var text = SeenByOf(root, FarmA).GetRawText();
        foreach (var person in new[] { Owner, CoOwner, Mukadam, Worker, Worker2, Paused, OwnerB })
        {
            text.Should().NotContain(person.ToString());
        }

        foreach (var name in new[] { OwnerName, CoOwnerName, MukadamName, WorkerName, Worker2Name, PausedName })
        {
            text.Should().NotContain(name);
        }

        text.Should().NotMatchRegex("\"count\"|\"name\"|\"userId\"");
        // The registrant sees every live seat that reads others' work; farm B (not his) carries no entry for him at all.
        Entries(SeenByOf(root, FarmA), "work").Should().Equal("Mukadam", "SecondaryOwner");
        root.GetProperty("accessScopes").EnumerateArray().Should().NotContain(s => s.GetProperty("farmId").GetGuid() == FarmB);
    }

    [Fact]
    public async Task The_reader_himself_is_never_listed()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // The मुकादम asks: the सहमालक is listed, he is not (and neither is the registrant, who is always implied).
        var seenBy = SeenByOf((await PullWithAsync(Mukadam, "&seenBy=1")).Root, FarmA);
        Entries(seenBy, "work").Should().Equal("SecondaryOwner");
        Entries(seenBy, "attendance").Should().Equal("SecondaryOwner");

        // Farm B's owner reads only farm B, where nobody else sits: every list is empty, never guessed.
        var b = SeenByOf((await PullWithAsync(OwnerB, "&seenBy=1")).Root, FarmB);
        Entries(b, "work").Should().BeEmpty();
        Entries(b, "attendance").Should().BeEmpty();
        Entries(b, "money").Should().BeEmpty();
    }
}
