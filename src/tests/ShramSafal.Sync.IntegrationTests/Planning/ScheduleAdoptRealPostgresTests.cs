// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 Task 1 ("one library").
//
// The phone's शेड्यूल लायब्ररी lists the server's reference schedules (GET /shramsafal/reference/schedule-templates: the
// ssf.schedule_templates rows, else the built-in catalog). Adoption looked the id up in a SECOND model nobody lists
// (ssf.crop_schedule_templates), so every adopt from the library answered ScheduleTemplateNotFound. Here, on a real Postgres
// as agrisync_app (E3 first), through the real host: what the library lists is what the server adopts and keeps, another
// account's private schedule is answered exactly like a made-up id, and the crop rule is the phone's own (one shared
// fixture, sync-contract/tests/fixtures/crop-schedule-match.json).
using System;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class ScheduleAdoptRealPostgresTests(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    [Fact]
    public async Task Adopting_a_listed_built_in_schedule_succeeds()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var listed = (await LibraryAsync(Owner)).Single(t => t.GetProperty("id").GetGuid() == BuiltInGrapes);
        var versionHash = listed.GetProperty("versionHash").GetString()!;

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInGrapes);
        status.Should().Be(HttpStatusCode.OK, body);
        Json(body).GetProperty("scheduleTemplateId").GetGuid().Should().Be(BuiltInGrapes);

        var row = (await SubscriptionsAsync()).Should().ContainSingle("the choice is kept on the server (P10)").Which;
        row.Should().BeEquivalentTo(new { Farm = FarmA, Plot = PlotA, Cycle = CycleA, Template = BuiltInGrapes, State = 0, CropKey = "grapes" });
        versionHash.Should().StartWith(row.VersionTag, "the subscription keeps the listed schedule's version hash");
        row.VersionTag.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task Adopting_a_listed_row_schedule_succeeds()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var rowTemplate = await SeedTemplateRowAsync("Grapes - L8b-1 Irrigation");

        var library = await LibraryAsync(Owner);
        var listed = library.Should().ContainSingle(t => t.GetProperty("id").GetGuid() == rowTemplate, "the row is what the library lists").Which;
        listed.GetProperty("cropType").GetString().Should().Be("Grapes");
        // L8b-1F (F114, D-91 = 1): his rows never hide the samples; a crop's samples stay until THAT crop has a checked schedule.
        library.Should().Contain(t => t.GetProperty("id").GetGuid() == BuiltInGrapes, "a row of his does not hide the grape sample");
        library.Should().Contain(t => t.GetProperty("id").GetGuid() == BuiltInPomegranate);

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, rowTemplate);
        status.Should().Be(HttpStatusCode.OK, body);

        var row = (await SubscriptionsAsync()).Should().ContainSingle().Which;
        row.Template.Should().Be(rowTemplate);
        // L8b-1F: a new adopt keeps the row's OWN version ("v<Version>"), not the list hash.
        listed.GetProperty("rowVersionTag").GetString().Should().Be(row.VersionTag);

        // L8b-1 fix round 1 (review H2) made a built-in id unadoptable once his library listed rows. L8b-1F (F114) replaces that
        // with the per-crop rule: this row is a thin Public row = a SAMPLE; while no checked grape schedule exists, the built-in
        // grape sample is still listed, so it is still choosable (the check-rule cases are in ScheduleAdoptCheckRealPostgresTests).
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var builtIn = await AdoptAsync(Owner, FarmA, plot2, cycle2, BuiltInGrapes);
        builtIn.Status.Should().Be(HttpStatusCode.OK, builtIn.Body);
    }

    [Fact]
    public async Task Another_accounts_private_template_answers_like_an_unknown_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var hisOwn = await SeedTemplateRowAsync("Grapes - his own", TenantScope.Private, author: Owner);
        var theirsPrivate = await SeedTemplateRowAsync("Grapes - private of farm B", TenantScope.Private, author: OwnerB);
        var theirsTeam = await SeedTemplateRowAsync("Grapes - team of farm B", TenantScope.Team, author: OwnerB);

        var madeUp = await AdoptAsync(Owner, FarmA, PlotA, CycleA, Guid.NewGuid());
        madeUp.Status.Should().Be(HttpStatusCode.NotFound, madeUp.Body);
        var notFoundCode = ErrorCode(madeUp.Body);
        notFoundCode.Should().Be("ShramSafal.ScheduleTemplateNotFound");

        foreach (var foreign in new[] { theirsPrivate, theirsTeam })
        {
            var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, foreign);
            status.Should().Be(HttpStatusCode.NotFound, body);
            ErrorCode(body).Should().Be(notFoundCode, "another account's schedule is answered exactly like a made-up id (E4)");
        }

        (await SubscriptionsAsync()).Should().BeEmpty("nothing was written for a schedule he may not see");

        // L8b-1F (E4 / R23): what a plot may follow depends on the PLOT's farm - his own PRIVATE schedule answers like an unknown id
        // on this plot too (a private copy is not a thing a plot follows; SCH-OWN opens the Team branch).
        var own = await AdoptAsync(Owner, FarmA, PlotA, CycleA, hisOwn);
        own.Status.Should().Be(HttpStatusCode.NotFound, own.Body);
        ErrorCode(own.Body).Should().Be(notFoundCode);
        (await SubscriptionsAsync()).Should().BeEmpty();

        // Not vacuous: a Public schedule IS adoptable (a sample while no checked schedule exists for its crop).
        var publicRow = await SeedTemplateRowAsync("Grapes - public sample", TenantScope.Public, author: OwnerB);
        var pub = await AdoptAsync(Owner, FarmA, PlotA, CycleA, publicRow);
        pub.Status.Should().Be(HttpStatusCode.OK, pub.Body);
        (await SubscriptionsAsync()).Should().ContainSingle().Which.Template.Should().Be(publicRow);
    }

    [Fact]
    public async Task Marathi_crop_name_matches_like_the_phone_library()
    {
        await AssertAppRoleIsNotVacuousAsync();
        using var fixture = CropRuleFixture();
        var builtIns = fixture.RootElement.GetProperty("builtInTemplates").EnumerateArray()
            .Select(t => (Id: t.GetProperty("id").GetGuid(), Code: t.GetProperty("cropCode").GetString()!))
            .ToList();
        var cases = fixture.RootElement.GetProperty("cases").EnumerateArray().ToList();
        cases.Should().Contain(c => c.GetProperty("cycleCrop").GetString() == "द्राक्ष", "the fixture must hold the Marathi grape name");

        foreach (var c in cases)
        {
            var name = c.GetProperty("name").GetString();
            var crop = c.GetProperty("cycleCrop").GetString()!;
            var code = c.GetProperty("cropCode").GetString()!;

            // Its own crop's schedule (when the library has one) is adopted ...
            if (builtIns.FirstOrDefault(b => b.Code == code) is { Id: var own } && own != Guid.Empty)
            {
                var (plot, cycle) = await SeedSeasonAsync(crop);
                var (status, body) = await AdoptAsync(Owner, FarmA, plot, cycle, own);
                status.Should().Be(HttpStatusCode.OK, $"{name}: '{crop}' reads as {code}: {body}");
            }

            // ... and every other crop's schedule is refused as another crop's.
            foreach (var other in builtIns.Where(b => b.Code != code))
            {
                var (plot, cycle) = await SeedSeasonAsync(crop);
                var (status, body) = await AdoptAsync(Owner, FarmA, plot, cycle, other.Id);
                status.Should().Be(HttpStatusCode.BadRequest, $"{name}: '{crop}' is not {other.Code}: {body}");
                ErrorCode(body).Should().Be("ShramSafal.ScheduleTemplateCropMismatch", name);
            }
        }
    }

    [Fact]
    public async Task Wrong_crop_is_refused_with_crop_mismatch()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (status, body) = await AdoptAsync(Owner, FarmA, PlotA, CycleA, BuiltInPomegranate);
        status.Should().Be(HttpStatusCode.BadRequest, body);
        ErrorCode(body).Should().Be("ShramSafal.ScheduleTemplateCropMismatch");
        (await SubscriptionsAsync()).Should().BeEmpty("a schedule of another crop is never kept");
    }
}
