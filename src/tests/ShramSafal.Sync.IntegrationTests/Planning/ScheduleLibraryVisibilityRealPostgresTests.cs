// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 fix round 1 (review H2, H4).
//
// H2: the library listing (the reference route AND the pull, one read) sent every account's Private and Team schedules
// to every phone (ssf.schedule_templates has no row policy: it is author-owned), while adoption already asked whose
// schedule it is. So a phone showed schedules that answered "not found" when tapped (P5), and their names and tasks
// reached every farm (E4). H4: POST /plan/generate wrote a Public row with no author into that shared library on every call.
// Here, on a real Postgres as agrisync_app (E3 first), through the real host: a phone receives only what its person may
// see, what is listed is exactly what can be adopted, the version hash is the caller's own list's, and a generated plan
// is its maker's private row that no other farm lists.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleLibraryVisibilityRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    private static HashSet<Guid> Ids(IEnumerable<JsonElement> templates) =>
        templates.Select(t => t.GetProperty("id").GetGuid()).ToHashSet();

    private async Task<(HashSet<Guid> Ids, string? Hash)> PulledLibraryAsync(Guid user)
    {
        var (_, root) = await PullAsync(user);
        return (Ids(ArrayOf(root, "scheduleTemplates")), root.GetProperty("referenceDataVersionHash").GetString());
    }

    private static string? HashOf(IReadOnlyList<JsonElement> library) =>
        library.Count == 0 ? null : library[0].GetProperty("versionHash").GetString();

    [Fact]
    public async Task Another_accounts_private_and_team_rows_never_reach_a_phone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var shared = await SeedTemplateRowAsync("Grapes - L8b-1 shared");
        var bPrivate = await SeedTemplateRowAsync("Grapes - L8b-1 private of farm B", TenantScope.Private, author: OwnerB);
        var bTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm B", TenantScope.Team, author: OwnerB);

        foreach (var farmA in new[] { Owner, Mukadam, Worker })
        {
            var listed = Ids(await LibraryAsync(farmA));
            listed.Should().Contain(shared, "a Public schedule is everyone's");
            listed.Should().NotContain(new[] { bPrivate, bTeam }, $"{farmA}: another account's private and team schedules stay his (E4)");

            var pulled = await PulledLibraryAsync(farmA);
            pulled.Ids.Should().BeEquivalentTo(listed, "the pull sends exactly the library the reference route lists");
        }

        // His own are his: farm B's owner lists all three.
        var ownerB = await LibraryAsync(OwnerB);
        Ids(ownerB).Should().Contain(new[] { shared, bPrivate, bTeam });

        // The version hash is the caller's own list's: farm B's private work never changes what farm A's phone is told.
        var aLibrary = await LibraryAsync(Owner);
        var aHash = HashOf(aLibrary);
        aHash.Should().NotBe(HashOf(ownerB), "two different lists never share one version");
        await SeedTemplateRowAsync("Grapes - L8b-1 another private of farm B", TenantScope.Private, author: OwnerB);
        HashOf(await LibraryAsync(Owner)).Should().Be(aHash, "a row he may not see is not part of his library's version");
        (await PulledLibraryAsync(Owner)).Hash.Should().Be(aHash);
    }

    [Fact]
    public async Task What_is_listed_is_exactly_what_can_be_adopted()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var shared = await SeedTemplateRowAsync("Grapes - L8b-1 shared");
        var aTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm A", TenantScope.Team, author: Owner);
        var bPrivate = await SeedTemplateRowAsync("Grapes - L8b-1 private of farm B", TenantScope.Private, author: OwnerB);
        var bTeam = await SeedTemplateRowAsync("Grapes - L8b-1 team of farm B", TenantScope.Team, author: OwnerB);

        // L8b-1F (F114, D-91 = 1): his library is his visible rows PLUS every crop's samples (no crop has a checked schedule here).
        var listed = Ids(await LibraryAsync(Owner));
        var samples = new[] { BuiltInGrapes, BuiltInPomegranate, BuiltInSugarcane, BuiltInOnion };
        listed.Should().BeEquivalentTo(new[] { shared, aTeam }.Concat(samples), "farm A's owner lists the public schedule, his team's, and the samples");

        // Every listed schedule a plot may FOLLOW is adopted: the Public row and the samples. His team's own schedule is listed (the phone
        // hides it) but answers "not open yet": it names no farm, so it is not a farm's own schedule (SCH-OWN fix round 1, M001).
        var adopted = new List<Guid>();
        foreach (var id in new[] { shared, BuiltInGrapes })
        {
            var (plot, cycle) = await SeedSeasonAsync("Grapes");
            var (status, body) = await AdoptAsync(Owner, FarmA, plot, cycle, id);
            status.Should().Be(HttpStatusCode.OK, $"{id} is listed: {body}");
            adopted.Add(id);
        }

        var own = await SeedSeasonAsync("Grapes");
        var ownAdopt = await AdoptAsync(Owner, FarmA, own.Plot, own.Cycle, aTeam);
        ErrorCode(ownAdopt.Body).Should().Be("ShramSafal.OwnScheduleNotOpenYet");

        // ... and nothing he may not see: another account's private and team rows, and a made-up id. Each answers like a made-up id.
        foreach (var id in new[] { bPrivate, bTeam, Guid.NewGuid() })
        {
            var (plot, cycle) = await SeedSeasonAsync("Grapes");
            var (status, body) = await AdoptAsync(Owner, FarmA, plot, cycle, id);
            status.Should().Be(HttpStatusCode.NotFound, $"{id} is not listed: {body}");
            ErrorCode(body).Should().Be("ShramSafal.ScheduleTemplateNotFound");
        }

        (await SubscriptionsAsync()).Select(s => s.Template).Should().BeEquivalentTo(adopted, "exactly the schedules a plot may follow were kept");
    }

    [Fact]
    public async Task Plan_generate_writes_its_makers_private_row_that_no_other_farm_lists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        Ids(await LibraryAsync(OwnerB)).Should().Contain(BuiltInGrapes, "with no row he may see, his library is the built-in one");

        var (status, body) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/plan/generate", Owner, new
        {
            cropCycleId = CycleA,
            templateName = "Grapes - L8b-1 season plan",
            stage = "Vegetative",
            planStartDate = "2026-01-01",
            activities = new[] { new { activityName = "फवारणी", offsetDays = 0 }, new { activityName = "पाणी", offsetDays = 3 } },
        });
        status.Should().Be(HttpStatusCode.OK, body);
        var generated = Json(body).GetProperty("templateId").GetGuid();

        (await CountAsync(
                "SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND tenant_scope = 0 AND created_by_user_id = @owner",
                ("id", generated), ("owner", Owner)))
            .Should().Be(1, "a season's plan is its maker's private record, never a Public row with no author");

        var other = await LibraryAsync(OwnerB);
        Ids(other).Should().NotContain(generated, "another farm never lists it (E4)");
        Ids(other).Should().Contain(BuiltInGrapes, "and his library is unchanged: one request never changes every farmer's library");
        (await PulledLibraryAsync(OwnerB)).Ids.Should().NotContain(generated);
    }
}
