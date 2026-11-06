// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 5 (the Include bug and R3-L3).
//
// (1) ShramSafalRepository.GetScheduleTemplateByIdAsync included Stages, which the EF map ignores
//     (ScheduleTemplateConfiguration: Ignore(x => x.Stages)): EVERY clone / edit / publish answered 500 (F99's route
//     sweep named the three as KnownOpen, carried to L8b). (2) MU-4 review R3-L3: POST /test-instances/schedule-from-plan
//     wrote a farm's test due dates for any member; every other test write needs the farm seat's "lab records" authority.
// Real Postgres as agrisync_app (E3 first), through the real host.
using System;
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
public sealed class ScheduleTemplateRoutesRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    [Fact]
    public async Task Clone_edit_publish_answer_without_500()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await SeedTemplateRowAsync("Grapes - L8b-1 source");
        var clone = Guid.NewGuid();
        var edited = Guid.NewGuid();

        var cloned = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone?farmId={FarmA}", Owner,
            new { newId = clone, newScope = (int)TenantScope.Private, reason = "माझ्या प्लॉटसाठी" });
        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);
        // The clone is HIS private schedule (scope 0 = Private), exactly as asked — never silently another scope.
        (await CountAsync("SELECT coalesce(max(tenant_scope), -1) FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", clone)))
            .Should().Be(0, "the clone is stored with the scope he chose (0 = Private)");
        (await CountAsync(
                "SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND tenant_scope = 0 AND created_by_user_id = @owner",
                ("id", clone), ("owner", Owner)))
            .Should().Be(1, "the clone is kept as the private schedule of the person who made it");

        var edit = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{clone}/edit?farmId={FarmA}", Owner,
            new { newId = edited, newName = "Grapes - L8b-1 mine", newStage = (string?)null });
        edit.Status.Should().Be(HttpStatusCode.Created, edit.Body);

        var published = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{edited}/publish?farmId={FarmA}", Owner, new { });
        published.Status.Should().Be(HttpStatusCode.OK, published.Body);

        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" IN (@a, @b) ", ("a", clone), ("b", edited)))
            .Should().Be(2, "the clone and its edited copy are kept");
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @b", ("b", edited)))
            .Should().Be(2, "the edited copy carries the schedule's tasks");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @b AND published_at_utc IS NOT NULL", ("b", edited)))
            .Should().Be(1);

        // A made-up id is not found (never a 500) — with a farm named, and with none (a template belongs to no farm: the
        // caller's own user scope is opened for it).
        foreach (var farmQuery in new[] { $"?farmId={FarmA}", string.Empty })
        {
            foreach (var route in new[] { "clone", "edit", "publish" })
            {
                object body = route switch
                {
                    "clone" => new { newId = Guid.NewGuid(), newScope = 0, reason = "x" },
                    "edit" => new { newId = Guid.NewGuid() },
                    _ => new { },
                };
                var (status, answer) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{Guid.NewGuid()}/{route}{farmQuery}", Owner, body);
                status.Should().Be(HttpStatusCode.NotFound, $"{route}{farmQuery}: {answer}");
            }
        }

        // With no farm named, a private copy is still made, edited and published (the user scope carries the work). Another
        // source: a second clone of the same source collides on ix_schedule_templates_derived_version (one clone per root
        // and version — a separate, pre-existing limit, reported, not this lane's).
        var otherSource = await SeedTemplateRowAsync("Grapes - L8b-1 other source");
        var noFarmClone = Guid.NewGuid();
        var noFarmEdit = Guid.NewGuid();
        (await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{otherSource}/clone", Owner,
            new { newId = noFarmClone, newScope = (int)TenantScope.Private, reason = "फक्त माझं" })).Status.Should().Be(HttpStatusCode.Created);
        (await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{noFarmClone}/edit", Owner,
            new { newId = noFarmEdit, newName = "Grapes - L8b-1 no farm" })).Status.Should().Be(HttpStatusCode.Created);
        (await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{noFarmEdit}/publish", Owner, new { })).Status
            .Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Schedule_from_plan_needs_LabRecords()
    {
        await AssertAppRoleIsNotVacuousAsync();
        object Request() => new
        {
            cropCycleId = CycleA,
            farmId = FarmA,
            plotId = PlotA,
            cropType = "Grapes",
            stages = new[] { new { stageName = "Vegetative", startDate = "2026-01-01", endDate = "2026-03-01" } },
        };

        var mukadam = await SendJsonAsync(HttpMethod.Post, "/shramsafal/test-instances/schedule-from-plan", Mukadam, Request());
        mukadam.Status.Should().Be(HttpStatusCode.Forbidden, "a मुकादम without lab records may not write the farm's test dates");
        var worker = await SendJsonAsync(HttpMethod.Post, "/shramsafal/test-instances/schedule-from-plan", Worker, Request());
        worker.Status.Should().Be(HttpStatusCode.Forbidden);

        var owner = await SendJsonAsync(HttpMethod.Post, "/shramsafal/test-instances/schedule-from-plan", Owner, Request());
        owner.Status.Should().Be(HttpStatusCode.OK, owner.Body);

        // Given the authority, the same मुकादम is let in (the seat decides, never the label).
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.LabRecords);
        var granted = await SendJsonAsync(HttpMethod.Post, "/shramsafal/test-instances/schedule-from-plan", Mukadam, Request());
        granted.Status.Should().Be(HttpStatusCode.OK, granted.Body);
    }
}
