// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 4 (founder D-24c "the primary owner may assign to any
// active member; others only with his permission"). GET /shramsafal/farms/{farmId}/planned-work/assignees on a real Postgres as
// agrisync_app (E3 first): the primary owner and an AssignWork मुकादम get the same list; a plain worker gets 403; each member
// is listed with the plots he covers; a paused seat and another farm's people are not listed.
using System;
using System.Linq;
using System.Net;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class PlannedWorkAssigneeRouteRealPostgresTests(ITestOutputHelper output) : PlannedWorkLane(output)
{
    private string Url => $"/shramsafal/farms/{FarmA}/planned-work/assignees";

    private static Guid[] Ids(string body) =>
        JsonDocument.Parse(body).RootElement.EnumerateArray().Select(m => m.GetProperty("userId").GetGuid()).ToArray();

    [Fact]
    public async Task The_primary_owner_and_an_AssignWork_mukadam_get_the_same_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await GrantAsync(Mukadam, FarmAuthority.AssignWork);

        var owner = await GetAsync(Owner, Url);
        var mukadam = await GetAsync(Mukadam, Url);
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);
        mukadam.Status.Should().Be(HttpStatusCode.OK, mukadam.Body);

        // Everyone Active except the asker himself (giving work to himself is a reminder, not an assignment).
        Ids(owner.Body).Should().BeEquivalentTo([CoOwner, Mukadam, Worker, Worker2]);
        Ids(mukadam.Body).Should().BeEquivalentTo([Owner, CoOwner, Worker, Worker2]);
        Ids(owner.Body).Should().NotContain(Paused).And.NotContain(OwnerB, "a paused seat and another farm's owner are not listed");
        Ids(owner.Body).Should().NotContain(Owner);
    }

    [Fact]
    public async Task A_plain_worker_a_mukadam_without_the_grant_and_a_stranger_get_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        (await GetAsync(Worker, Url)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(Mukadam, Url)).Status.Should().Be(HttpStatusCode.Forbidden, "the label grants nothing (D-26)");
        (await GetAsync(CoOwner, Url)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(Paused, Url)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(OwnerB, Url)).Status.Should().Be(HttpStatusCode.Forbidden, "another farm's owner has no seat here");
        // PlanWork is not AssignWork (plan is not assign).
        await GrantAsync(Mukadam, FarmAuthority.PlanWork);
        (await GetAsync(Mukadam, Url)).Status.Should().Be(HttpStatusCode.Forbidden);
        // Not vacuous: the owner is let in.
        (await GetAsync(Owner, Url)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Each_member_is_listed_with_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (plot2, _) = await SeedSeasonAsync("Grapes");
        var (plot3, _) = await SeedSeasonAsync("Grapes");
        await SetChosenPlotsAsync(Mukadam, plot2);
        await SetChosenPlotsAsync(CoOwner, plot2, plot3);

        var (status, body) = await GetAsync(Owner, Url);
        status.Should().Be(HttpStatusCode.OK, body);
        var members = JsonDocument.Parse(body).RootElement.EnumerateArray().ToDictionary(m => m.GetProperty("userId").GetGuid());

        static Guid[] PlotsOf(JsonElement member) =>
            member.GetProperty("plotIds").EnumerateArray().Select(p => p.GetGuid()).Order().ToArray();

        members[Mukadam].GetProperty("plotScope").GetString().Should().Be("ChosenPlots");
        PlotsOf(members[Mukadam]).Should().Equal([plot2]);
        PlotsOf(members[CoOwner]).Should().Equal(new[] { plot2, plot3 }.Order());
        members[Worker].GetProperty("plotScope").GetString().Should().BeOneOf("AllPlots", "OwnWork");
        PlotsOf(members[Worker]).Should().BeEquivalentTo([PlotA, plot2, plot3], "a seat on every plot covers them all");
        members[Mukadam].GetProperty("displayName").GetString().Should().Be(MukadamName);
        members[Mukadam].GetProperty("role").GetString().Should().Be("Mukadam");

        // The list agrees with the door: a member listed for a plot can be given work on it, one who is not listed cannot.
        (await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, plots: [plot2])).Status.Should().Be("applied");
        (await MakeAsync(Owner, Guid.NewGuid(), assignee: Mukadam, plots: [PlotA])).ErrorCode
            .Should().Be("ShramSafal.PlannedWorkAssigneeOutsidePlots.InvalidCommand");
    }
}
