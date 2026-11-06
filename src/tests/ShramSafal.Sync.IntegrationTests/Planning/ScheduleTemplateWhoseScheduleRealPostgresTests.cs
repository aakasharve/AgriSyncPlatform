// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 fix round 1 (review H3, M1; founder D-88).
//
// Task 5 brought the clone and edit doors back to life (they had answered 500 for everyone), and with them their missing
// rules: clone copied ANY row, another account's Private or Team one included, into the caller's own copy; edit let any
// farm owner write a new Team version of another account's schedule, with no farm named, stored as written by that
// account. Founder D-88 (answered 2026-11-06, choice 2): the farm's own schedule is changed by "You, plus the people you
// give 'पीक वेळापत्रकाचे नमुने'; each version shows who made it", and the farm is always named. M1: a second copy of the
// same schedule answered 500 (the one-copy-per-version index, which lane SCH-OWN re-keys); it now answers 409 with words.
// Real Postgres as agrisync_app (E3 first), through the real host.
using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleTemplateWhoseScheduleRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    /// <summary>The global role each person's real token carries (the schedule-template author rule still reads it).</summary>
    private static string GlobalRoleOf(Guid user) =>
        user == Owner || user == OwnerB ? "PrimaryOwner" : user == CoOwner ? "SecondaryOwner" : user == Mukadam ? "Mukadam" : "Worker";

    private Task<(HttpStatusCode Status, string Body)> CloneAsync(Guid user, Guid source, Guid? farm, Guid newId) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone{(farm is { } f ? $"?farmId={f}" : string.Empty)}", user,
            new { newId, newScope = (int)TenantScope.Private, reason = "माझ्या प्लॉटसाठी" }, GlobalRoleOf(user));

    private Task<(HttpStatusCode Status, string Body)> EditAsync(Guid user, Guid source, Guid? farm, Guid newId) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/edit{(farm is { } f ? $"?farmId={f}" : string.Empty)}", user,
            new { newId, newName = "Grapes - L8b-1 next version" }, GlobalRoleOf(user));

    private Task<long> RowsFromAsync(Guid source) => CountAsync(
        "SELECT count(*) FROM ssf.schedule_templates WHERE derived_from_template_id = @s OR previous_version_id = @s", ("s", source));

    private async Task<Guid?> MakerOfAsync(Guid id)
    {
        var found = await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND created_by_user_id IS NOT NULL", ("id", id));
        if (found == 0)
        {
            return null;
        }

        foreach (var who in new[] { Owner, CoOwner, Mukadam, Worker, OwnerB })
        {
            if (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND created_by_user_id = @who",
                    ("id", id), ("who", who)) == 1)
            {
                return who;
            }
        }

        return Guid.Empty;
    }

    [Fact]
    public async Task Clone_of_a_schedule_he_may_not_see_is_not_found()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var bPrivate = await SeedTemplateRowAsync("Grapes - L8b-1 private of farm B", TenantScope.Private, author: OwnerB);
        var bTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm B", TenantScope.Team, author: OwnerB);

        foreach (var source in new[] { bPrivate, bTeam })
        {
            foreach (var farm in new Guid?[] { FarmA, null })
            {
                var (status, body) = await CloneAsync(Owner, source, farm, Guid.NewGuid());
                status.Should().Be(HttpStatusCode.NotFound, $"{source} (farm {farm}): {body}");
                ErrorCode(body).Should().Be("ShramSafal.ScheduleTemplateNotFound", "answered exactly like a made-up id (E4)");
            }

            (await RowsFromAsync(source)).Should().Be(0, "nothing of another account's schedule is copied");
        }

        // Not vacuous: a Public schedule is copied.
        var shared = await SeedTemplateRowAsync("Grapes - L8b-1 shared");
        var copy = await CloneAsync(Owner, shared, FarmA, Guid.NewGuid());
        copy.Status.Should().Be(HttpStatusCode.Created, copy.Body);
    }

    [Fact]
    public async Task Edit_of_another_farms_team_schedule_is_refused_and_a_team_write_needs_the_farm_named()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var bTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm B", TenantScope.Team, author: OwnerB);

        // The reviewer's case: farm A's owner (his token says PrimaryOwner, as every farm owner's does) writes a new version of
        // farm B's team schedule, naming no farm, and naming his own.
        foreach (var farm in new Guid?[] { null, FarmA })
        {
            var (status, body) = await EditAsync(Owner, bTeam, farm, Guid.NewGuid());
            status.Should().Be(HttpStatusCode.NotFound, $"farm {farm}: {body}");
        }

        (await RowsFromAsync(bTeam)).Should().Be(0, "no version of farm B's schedule is written from outside farm B");

        // His own farm's team schedule: never with no farm named (D-88's approach), always with his farm named.
        var aTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm A", TenantScope.Team, author: Owner);
        var unnamed = await EditAsync(Owner, aTeam, null, Guid.NewGuid());
        unnamed.Status.Should().Be(HttpStatusCode.Forbidden, unnamed.Body);
        var named = await EditAsync(Owner, aTeam, FarmA, Guid.NewGuid());
        named.Status.Should().Be(HttpStatusCode.Created, named.Body);
        (await RowsFromAsync(aTeam)).Should().Be(1);
    }

    [Fact]
    public async Task A_permitted_editor_makes_the_farms_next_version_and_it_shows_him_as_its_maker()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var aTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm A", TenantScope.Team, author: Owner);

        // Without "पीक वेळापत्रकाचे नमुने" the सहमालक may not change the farm's schedule.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney);
        var refused = await EditAsync(CoOwner, aTeam, FarmA, Guid.NewGuid());
        refused.Status.Should().Be(HttpStatusCode.Forbidden, refused.Body);

        // Given it, he makes the next version: stored as HIS (D-88: each version shows who made it), linked to the one before.
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var byCoOwner = Guid.NewGuid();
        var made = await EditAsync(CoOwner, aTeam, FarmA, byCoOwner);
        made.Status.Should().Be(HttpStatusCode.Created, made.Body);
        (await MakerOfAsync(byCoOwner)).Should().Be(CoOwner, "the version records who made it, not the schedule's first author");
        (await CountAsync(
                "SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND previous_version_id = @prev AND tenant_scope = 1",
                ("id", byCoOwner), ("prev", aTeam)))
            .Should().Be(1, "it stays the farm's team schedule, the next version of the one he edited");

        // The authority decides, never the label (D-26): a मुकादम given it makes the version after his.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);
        var byMukadam = Guid.NewGuid();
        var next = await EditAsync(Mukadam, byCoOwner, FarmA, byMukadam);
        next.Status.Should().Be(HttpStatusCode.Created, next.Body);
        (await MakerOfAsync(byMukadam)).Should().Be(Mukadam);

        // Both versions are still farm A's schedule: farm A's people list them, farm B's owner does not.
        var farmA = (await LibraryAsync(Worker)).Select(t => t.GetProperty("id").GetGuid()).ToList();
        farmA.Should().Contain(new[] { aTeam, byCoOwner, byMukadam });
        var farmB = (await LibraryAsync(OwnerB)).Select(t => t.GetProperty("id").GetGuid()).ToList();
        farmB.Should().NotContain(new[] { aTeam, byCoOwner, byMukadam }, "a farm's own schedule stays inside the farm (E4)");
    }

    [Fact]
    public async Task A_second_copy_of_the_same_schedule_answers_409_with_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var shared = await SeedTemplateRowAsync("Grapes - L8b-1 shared");

        var first = await CloneAsync(Owner, shared, FarmA, Guid.NewGuid());
        first.Status.Should().Be(HttpStatusCode.Created, first.Body);

        var second = await CloneAsync(OwnerB, shared, FarmB, Guid.NewGuid());
        second.Status.Should().Be(HttpStatusCode.Conflict, second.Body);
        var answer = Json(second.Body);
        answer.GetProperty("error").GetString().Should().Be("ShramSafal.ScheduleCopy.Conflict");
        answer.GetProperty("message").GetString().Should().Be("A copy of this schedule already exists.");
        answer.GetProperty("messageMr").GetString().Should().Be("ही प्रत आधीच बनवलेली आहे.");
        (await RowsFromAsync(shared)).Should().Be(1, "the refused copy wrote nothing");
    }
}
