// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN Task 2 ("his own schedule", the write side; founder D-74, D-82 = 3, D-88; R30, R31, R32).
//
// A farm's OWN schedule is a Team chain that names its FARM. Four doors write it - make it empty, copy a CHECKED schedule into it, write its next
// version (whole, as sent), publish it - and the same three as a sync push. One gate decides them all (OwnScheduleGate: the farm's owner, or an Active
// seat of THAT farm holding "पीक वेळापत्रकाचे नमुने"; never the account's global role, never a label); the farm named must be the chain's own, checked
// before any authority is read; a delegate no longer versions the owner's Team chain that names no farm (R32). Real Postgres as agrisync_app (E3 first,
// in every fact), through the real host, the real handlers and the real push.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnScheduleWriteRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private const int Team = (int)TenantScope.Team;

    // ── the happy doors ──

    [Fact]
    public async Task Blank_start_works_for_a_crop_with_no_checked_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (status, body) = await CreateAsync(Owner, FarmA, "Grapes", "माझं द्राक्ष शेड्यूल");

        status.Should().Be(HttpStatusCode.Created, body);
        Json(body).GetProperty("version").GetInt32().Should().Be(1);
        var id = IdOf(body, "scheduleTemplateId");
        var row = (await RowAsync(id))!;
        row.OwnFarm.Should().Be(FarmA);
        row.Scope.Should().Be(Team);
        row.Version.Should().Be(1);
        row.CreatedBy.Should().Be(Owner);
        row.Previous.Should().BeNull();
        row.Derived.Should().BeNull();
        row.OwnerType.Should().Be("User");
        row.CropKey.Should().Be("Grapes");
        row.Name.Should().Be("माझं द्राक्ष शेड्यूल");
        (row.Stage, row.Activities, row.Stages).Should().Be((string.Empty, 0L, 0L), "an empty start stores no stage and no work (P4)");
        (await ChecksOfAsync(id)).Should().Be(0);

        // The library the phone is sent lists it as it is: empty, nothing invented (D6), no check applies.
        var listed = (await ListedAsync(Worker, id))!.Value;
        listed.GetProperty("hasStoredDays").GetBoolean().Should().BeFalse();
        listed.GetProperty("stages").GetArrayLength().Should().Be(0);
        listed.GetProperty("activities").GetArrayLength().Should().Be(0);
        listed.GetProperty("totalDays").GetInt32().Should().Be(0, "no invented 60 days");
        listed.GetProperty("cropType").GetString().Should().Be("Grapes", "the crop is the row's own, not read from its title");
        listed.GetProperty("scope").GetString().Should().Be("Team");
        listed.GetProperty("ownerType").GetString().Should().Be("USER");
        listed.TryGetProperty("check", out var check).Should().BeTrue();
        check.ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null, "no check applies to a farm's own schedule (D-82 = 3)");
    }

    [Fact]
    public async Task The_crop_default_is_never_the_farms_own_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (status, body) = await CreateAsync(Owner, FarmA, "Grapes", "माझं द्राक्ष शेड्यूल");
        status.Should().Be(HttpStatusCode.Created, body);

        // M009 (review): the own row must have MORE works than the built-in sample, or the old "the biggest row" rule also picks the sample and the
        // test cannot tell the new rule from the old one.
        var sampleWorks = (await LibraryAsync(Owner)).Single(t => t.GetProperty("id").GetGuid() == BuiltInGrapes).GetProperty("activities").GetArrayLength();
        var manyWorks = Enumerable.Range(0, sampleWorks + 5).Select(i => Work($"काम {i}", "work", i % 100, i % 100 + 1, "one_time", 1)).ToArray();
        var withDays = Guid.NewGuid();
        (await EditAsync(Owner, IdOf(body, "scheduleTemplateId"), FarmA, withDays, stages: SomeStages(), activities: manyWorks)).Status.Should().Be(HttpStatusCode.Created);
        (await LibraryAsync(Owner)).Single(t => t.GetProperty("id").GetGuid() == withDays).GetProperty("activities").GetArrayLength()
            .Should().BeGreaterThan(sampleWorks, "the own row is the BIGGEST row of the crop");

        var (listStatus, listBody) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/reference/crop-types", Owner, null);

        listStatus.Should().Be(HttpStatusCode.OK, listBody);
        var grapes = Json(listBody).EnumerateArray().Single(c => c.GetProperty("name").GetString() == "Grapes");
        var defaultId = grapes.GetProperty("defaultTemplateId").ValueKind == System.Text.Json.JsonValueKind.Null
            ? (Guid?)null
            : grapes.GetProperty("defaultTemplateId").GetGuid();
        defaultId.Should().NotBe(withDays).And.NotBe(IdOf(body, "scheduleTemplateId"), "F207: the crop's default is an outside schedule, never the farm's own row");
        defaultId.Should().Be(BuiltInGrapes, "the only followable thing for Grapes is the built-in sample");
    }

    [Fact]
    public async Task A_checked_schedule_can_be_copied_into_the_farms_own_with_its_days_and_no_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var newId = Guid.NewGuid();

        var (status, body) = await CloneIntoOwnAsync(Owner, source.Id, FarmA, newId);

        status.Should().Be(HttpStatusCode.Created, body);
        IdOf(body, "newTemplateId").Should().Be(newId);
        var row = (await RowAsync(newId))!;
        row.OwnFarm.Should().Be(FarmA);
        row.Scope.Should().Be(Team);
        row.Version.Should().Be(1);
        row.Derived.Should().Be(source.Id, "it keeps where it came from");
        row.CreatedBy.Should().Be(Owner);
        row.OwnerType.Should().Be("User");
        row.CropKey.Should().Be("grape");
        (row.Activities, row.Stages).Should().Be((4L, 3L), "the stored days travel with the copy");
        (await ChecksOfAsync(newId)).Should().Be(0, "a copy starts NotChecked; no check applies to it");
        (await ChecksOfAsync(source.Id)).Should().Be(1, "the source's own check is not touched");

        var listed = (await ListedAsync(Worker, newId))!.Value;
        listed.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue();
        listed.GetProperty("activities").GetArrayLength().Should().Be(4);
        listed.GetProperty("stages").GetArrayLength().Should().Be(3);
        listed.GetProperty("check").ValueKind.Should().Be(System.Text.Json.JsonValueKind.Null);
    }

    [Fact]
    public async Task An_edit_with_activities_stores_exactly_those_and_version_1_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं शेड्यूल")).Body, "scheduleTemplateId");
        var v2 = Guid.NewGuid();

        var (status, body) = await EditAsync(Owner, v1, FarmA, v2, stages: SomeStages(), activities: SomeWorks());

        status.Should().Be(HttpStatusCode.Created, body);
        IdOf(body, "newTemplateId").Should().Be(v2);
        Json(body).GetProperty("version").GetInt32().Should().Be(2);
        var second = (await RowAsync(v2))!;
        (second.Activities, second.Stages, second.Version).Should().Be((2L, 3L, 2));
        second.Previous.Should().Be(v1);
        second.OwnFarm.Should().Be(FarmA);
        second.Name.Should().Be("माझं शेड्यूल");
        second.Stage.Should().Be("Pruning");
        var first = (await RowAsync(v1))!;
        (first.Activities, first.Stages, first.Version, first.Stage).Should().Be((0L, 0L, 1, string.Empty), "P3: the version before is exactly as it was");

        var listed = (await ListedAsync(Worker, v2))!.Value;
        listed.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue();
        listed.GetProperty("activities").EnumerateArray().Select(a => a.GetProperty("name").GetString())
            .Should().BeEquivalentTo(["ठिबक सिंचन", "बुरशीनाशक फवारणी"]);

        // The next version replaces, never adds: one work only.
        var v3 = Guid.NewGuid();
        (await EditAsync(Owner, v2, FarmA, v3, stages: SomeStages(), activities: new[] { Work("फक्त एक", "work", 0, 5, "one_time", 1) }))
            .Status.Should().Be(HttpStatusCode.Created);
        (await RowAsync(v3))!.Activities.Should().Be(1);
        (await RowAsync(v2))!.Activities.Should().Be(2, "the version before keeps its works");
    }

    [Fact]
    public async Task An_edit_that_breaks_a_day_rule_is_refused_with_the_import_words_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं शेड्यूल")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();

        var outside = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: new[] { Work("बाहेर", "work", 0, 500, "one_time", 1) });
        var badPart = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: new[] { Work("x", "magic", 0, 5, "one_time", 1) });
        var badRepeat = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: new[] { Work("x", "work", 0, 5, "sometimes", 1) });
        var worksOnly = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), activities: SomeWorks());

        outside.Status.Should().Be(HttpStatusCode.BadRequest, outside.Body);
        ErrorCode(outside.Body).Should().Be("ShramSafal.ScheduleImportOutsideStages");
        ErrorCode(badPart.Body).Should().Be("ShramSafal.ScheduleImportPart");
        ErrorCode(badRepeat.Body).Should().Be("ShramSafal.ScheduleImportRepeat");
        worksOnly.Status.Should().Be(HttpStatusCode.BadRequest, "works with no stages to hold them");
        ErrorCode(worksOnly.Body).Should().Be("ShramSafal.InvalidCommand");
        (await TemplateRowCountAsync()).Should().Be(before, "nothing was written");
    }

    [Fact]
    public async Task The_old_edit_payload_still_renames()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var withDays = await SeedOwnWithDaysAsync(FarmA, Owner, "पहिलं नाव");
        var renamed = Guid.NewGuid();

        var (status, body) = await EditAsync(Owner, withDays, FarmA, renamed, name: "नवं नाव");

        status.Should().Be(HttpStatusCode.Created, body);
        var row = (await RowAsync(renamed))!;
        row.Name.Should().Be("नवं नाव");
        (row.Activities, row.Stages, row.Version, row.OwnFarm).Should().Be((1L, 2L, 3, (Guid?)FarmA), "a rename copies the works and stages as it always did (P11)");
    }

    // ── refusals ──

    [Fact]
    public async Task No_farmId_on_the_farms_own_schedule_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var own = await SeedOwnEmptyAsync(FarmA, Owner);
        var before = await TemplateRowCountAsync();

        (await CreateAsync(Owner, null, "Grapes", "बिना शेत")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await CloneIntoOwnAsync(Owner, source.Id, null, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(Owner, own, null, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(Owner, own, null)).Status.Should().Be(HttpStatusCode.Forbidden);

        (await TemplateRowCountAsync()).Should().Be(before, "nothing was written");
        // Not vacuous: with the farm named, the same edit works.
        (await EditAsync(Owner, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task A_crop_the_farm_does_not_grow_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var onion = await CheckedScheduleOfCropAsync("onion", "Onion - University Schedule");
        var before = await TemplateRowCountAsync();

        var create = await CreateAsync(Owner, FarmA, "Onion", "माझा कांदा");
        var unknown = await CreateAsync(Owner, FarmA, "Zzzzz", "काहीतरी");
        var clone = await CloneIntoOwnAsync(Owner, onion.Id, FarmA, Guid.NewGuid());

        foreach (var refused in new[] { create, unknown, clone })
        {
            refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
            ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleCropNotOnFarm");
        }

        (await TemplateRowCountAsync()).Should().Be(before);

        // Not vacuous, and "grows" = ANY season, past ones too (D5): once the farm has had an onion season it may.
        await SeedSeasonAsync("Onion");
        (await CreateAsync(Owner, FarmA, "Onion", "माझा कांदा")).Status.Should().Be(HttpStatusCode.Created);
        (await CloneIntoOwnAsync(Owner, onion.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Another_accounts_Team_schedule_is_invisible_and_untouchable()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var ofB = IdOf((await CreateAsync(OwnerB, FarmB, "Grapes", "दुसऱ्याचं शेड्यूल")).Body, "scheduleTemplateId");
        var ofA = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं शेड्यूल")).Body, "scheduleTemplateId");

        (await LibraryAsync(Owner)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(ofA).And.NotContain(ofB);
        (await LibraryAsync(OwnerB)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(ofB).And.NotContain(ofA);

        var edit = await EditAsync(Owner, ofB, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());
        edit.Status.Should().Be(HttpStatusCode.NotFound, edit.Body);
        ErrorCode(edit.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound", "answered like a made-up id (E4)");
        (await ClonePlainAsync(Owner, ofB, FarmA, Guid.NewGuid(), TenantScope.Team)).Status.Should().Be(HttpStatusCode.NotFound);
        (await EditAsync(OwnerB, ofA, FarmB, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.NotFound);
        (await RowAsync(ofB))!.Version.Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE previous_version_id = @id", ("id", ofB))).Should().Be(0);
    }

    // ── the id the phone made ──

    [Fact]
    public async Task A_phone_minted_id_that_already_exists_is_refused_and_nothing_is_overwritten()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var taken = Guid.NewGuid();
        (await CreateAsync(Owner, FarmA, "Grapes", "पहिलं", taken)).Status.Should().Be(HttpStatusCode.Created);
        var publicRow = await SeedTemplateRowAsync("Grapes - a public row");
        var ofB = IdOf((await CreateAsync(OwnerB, FarmB, "Grapes", "दुसऱ्याचं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();

        foreach (var id in new[] { taken, publicRow, ofB, source.Id })
        {
            var create = await CreateAsync(Owner, FarmA, "Grapes", "बदलायचं", id);
            create.Status.Should().Be(HttpStatusCode.Conflict, $"create over {id}: {create.Body}");
            ErrorCode(create.Body).Should().Be("ShramSafal.ScheduleIdTaken.Conflict");
            Json(create.Body).GetProperty("messageMr").GetString().Should().NotBeNullOrWhiteSpace();
        }

        var clone = await CloneIntoOwnAsync(Owner, source.Id, FarmA, taken);
        clone.Status.Should().Be(HttpStatusCode.Conflict, clone.Body);
        ErrorCode(clone.Body).Should().Be("ShramSafal.ScheduleIdTaken.Conflict");
        var edit = await EditAsync(Owner, taken, FarmA, taken, stages: SomeStages(), activities: SomeWorks());
        edit.Status.Should().Be(HttpStatusCode.Conflict, edit.Body);
        ErrorCode(edit.Body).Should().Be("ShramSafal.ScheduleIdTaken.Conflict");
        var plain = await ClonePlainAsync(Owner, source.Id, FarmA, taken);
        plain.Status.Should().Be(HttpStatusCode.Conflict, plain.Body);

        (await TemplateRowCountAsync()).Should().Be(before, "nothing was written");
        (await RowAsync(taken))!.Name.Should().Be("पहिलं");
        (await RowAsync(publicRow))!.Should().Match<TemplateRow>(r => r.OwnFarm == null && r.Scope == (int)TenantScope.Public);
        (await RowAsync(ofB))!.OwnFarm.Should().Be(FarmB);
        (await RowAsync(source.Id))!.OwnFarm.Should().BeNull();
    }

    [Fact]
    public async Task A_replayed_clientCommandId_is_a_no_op()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var id = Guid.NewGuid();

        var first = await CreateAsync(Owner, FarmA, "Grapes", "एकदा", id, "sown-replay-create");
        var again = await CreateAsync(Owner, FarmA, "Grapes", "एकदा", Guid.NewGuid(), "sown-replay-create");

        first.Status.Should().Be(HttpStatusCode.Created, first.Body);
        again.Status.Should().Be(HttpStatusCode.Created, again.Body);
        IdOf(again.Body, "scheduleTemplateId").Should().Be(id, "the stored answer, not a second schedule");
        (await OwnRowCountAsync(FarmA)).Should().Be(1);

        var cloneId = Guid.NewGuid();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, cloneId, "sown-replay-clone")).Status.Should().Be(HttpStatusCode.Created);
        var cloneAgain = await CloneIntoOwnAsync(Owner, source.Id, FarmA, Guid.NewGuid(), "sown-replay-clone");
        cloneAgain.Status.Should().Be(HttpStatusCode.Created, cloneAgain.Body);
        IdOf(cloneAgain.Body, "newTemplateId").Should().Be(cloneId);
        (await OwnRowCountAsync(FarmA)).Should().Be(2);

        var editId = Guid.NewGuid();
        (await EditAsync(Owner, id, FarmA, editId, stages: SomeStages(), activities: SomeWorks(), commandId: "sown-replay-edit")).Status.Should().Be(HttpStatusCode.Created);
        var editAgain = await EditAsync(Owner, id, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks(), commandId: "sown-replay-edit");
        editAgain.Status.Should().Be(HttpStatusCode.Created, editAgain.Body);
        IdOf(editAgain.Body, "newTemplateId").Should().Be(editId);
        (await OwnRowCountAsync(FarmA)).Should().Be(3);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ScheduleTemplate' AND action = 'schedule.created'")).Should().Be(1);
    }

    // ── who may: the seat decides ──

    [Fact]
    public async Task The_primary_owner_succeeds()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();

        var created = await CreateAsync(Owner, FarmA, "Grapes", "माझं");
        var cloned = await CloneIntoOwnAsync(Owner, source.Id, FarmA, Guid.NewGuid());
        var edited = await EditAsync(Owner, IdOf(created.Body, "scheduleTemplateId"), FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());
        var published = await PublishAsync(Owner, IdOf(edited.Body, "newTemplateId"), FarmA);

        created.Status.Should().Be(HttpStatusCode.Created, created.Body);
        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);
        edited.Status.Should().Be(HttpStatusCode.Created, edited.Body);
        published.Status.Should().Be(HttpStatusCode.OK, published.Body);
    }

    [Fact]
    public async Task The_same_person_without_the_authority_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var own = await SeedOwnEmptyAsync(FarmA, Owner);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);
        (await CreateAsync(Mukadam, FarmA, "Grapes", "मुकादमाचं")).Status.Should().Be(HttpStatusCode.Created, "not vacuous: with the authority he may");

        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.PlanWork);
        var before = await TemplateRowCountAsync();

        (await CreateAsync(Mukadam, FarmA, "Grapes", "पुन्हा")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await CloneIntoOwnAsync(Mukadam, source.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(Mukadam, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(Mukadam, own, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await TemplateRowCountAsync()).Should().Be(before);
    }

    [Fact]
    public async Task Holding_it_on_another_farm_only_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var ownA = await SeedOwnEmptyAsync(FarmA, Owner);
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney);
        await SeedSeatAsync(FarmB, CoOwner, "SecondaryOwner", FarmAuthority.ScheduleTemplates);
        var before = await TemplateRowCountAsync();

        (await CreateAsync(CoOwner, FarmA, "Grapes", "सहमालक")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await CloneIntoOwnAsync(CoOwner, source.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(CoOwner, ownA, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(CoOwner, ownA, FarmB, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden,
            "naming the farm he holds it on is not naming farm A's schedule's farm");
        (await TemplateRowCountAsync()).Should().Be(before);

        // Not vacuous: on farm B, where he holds it, he may.
        (await CreateAsync(CoOwner, FarmB, "Grapes", "बी चं")).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task A_SecondaryOwner_global_role_without_the_seat_authority_gets_403_on_the_farms_own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var own = await SeedOwnEmptyAsync(FarmA, Owner);
        GlobalRoleOf(CoOwner).Should().Be("SecondaryOwner");
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.EditFarmSetup);
        var before = await TemplateRowCountAsync();

        (await CreateAsync(CoOwner, FarmA, "Grapes", "सहमालक")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await CloneIntoOwnAsync(CoOwner, source.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(CoOwner, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(CoOwner, own, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await TemplateRowCountAsync()).Should().Be(before);
    }

    [Fact]
    public async Task A_coowner_holding_ScheduleTemplates_creates_the_farms_own_schedule_and_it_stays_the_farms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);

        var created = await CreateAsync(CoOwner, FarmA, "Grapes", "सहमालकाचं");

        created.Status.Should().Be(HttpStatusCode.Created, created.Body);
        var id = IdOf(created.Body, "scheduleTemplateId");
        var row = (await RowAsync(id))!;
        (row.OwnFarm, row.CreatedBy).Should().Be(((Guid?)FarmA, (Guid?)CoOwner));

        // It is the FARM's: the farm's owner changes it, the farm's people list it, another farm's people do not, and a plot of the farm follows it.
        var withDays = Guid.NewGuid();
        (await EditAsync(Owner, id, FarmA, withDays, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await LibraryAsync(Worker)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(new[] { id, withDays });
        (await LibraryAsync(OwnerB)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(new[] { id, withDays });
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, withDays)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Each_version_shows_its_own_maker()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);

        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं")).Body, "scheduleTemplateId");
        var v2 = Guid.NewGuid();
        var v3 = Guid.NewGuid();
        (await EditAsync(CoOwner, v1, FarmA, v2, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await EditAsync(Mukadam, v2, FarmA, v3, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);

        (await RowAsync(v1))!.CreatedBy.Should().Be(Owner);
        (await RowAsync(v2))!.CreatedBy.Should().Be(CoOwner);
        (await RowAsync(v3))!.CreatedBy.Should().Be(Mukadam);
        (await RowAsync(v3))!.Should().Match<TemplateRow>(r => r.Previous == v2 && r.OwnFarm == FarmA && r.Version == 3);
    }

    [Fact]
    public async Task A_mukadam_holding_ScheduleTemplates_clones_a_checked_schedule_into_the_farms_own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);
        GlobalRoleOf(Mukadam).Should().Be("Mukadam", "the token carries a role the Team author rule does not know (R31)");

        var newId = Guid.NewGuid();
        var (status, body) = await CloneIntoOwnAsync(Mukadam, source.Id, FarmA, newId);

        status.Should().Be(HttpStatusCode.Created, body);
        var row = (await RowAsync(newId))!;
        (row.OwnFarm, row.CreatedBy, row.Activities).Should().Be(((Guid?)FarmA, (Guid?)Mukadam, 4L));
    }

    [Fact]
    public async Task A_mukadam_holding_ScheduleTemplates_starts_blank_and_edits_the_farms_own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);

        var created = await CreateAsync(Mukadam, FarmA, "Grapes", "मुकादमाचं");
        created.Status.Should().Be(HttpStatusCode.Created, created.Body);
        var edited = await EditAsync(Mukadam, IdOf(created.Body, "scheduleTemplateId"), FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());

        edited.Status.Should().Be(HttpStatusCode.Created, edited.Body);
        (await RowAsync(IdOf(edited.Body, "newTemplateId")))!.Activities.Should().Be(2);
        (await PublishAsync(Mukadam, IdOf(edited.Body, "newTemplateId"), FarmA)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_holder_publishes_on_his_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var own = await SeedOwnWithDaysAsync(FarmA, Owner);

        var published = await PublishAsync(CoOwner, own, FarmA);

        published.Status.Should().Be(HttpStatusCode.OK, published.Body);
        (await RowAsync(own))!.PublishedAt.Should().NotBeNull();
    }

    [Fact]
    public async Task The_owner_publishes_his_delegates_version_of_the_farms_own_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं")).Body, "scheduleTemplateId");
        var v2 = Guid.NewGuid();
        (await EditAsync(CoOwner, v1, FarmA, v2, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await RowAsync(v2))!.CreatedBy.Should().Be(CoOwner);

        var published = await PublishAsync(Owner, v2, FarmA);

        published.Status.Should().Be(HttpStatusCode.OK, "the version is his delegate's, the schedule is the farm's: no maker check");
        (await RowAsync(v2))!.PublishedAt.Should().NotBeNull();
    }

    // ── the farm named is the chain's farm ──

    [Fact]
    public async Task A_holder_on_farm_X_editing_farm_Ys_own_schedule_is_refused_even_naming_farm_X()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        await SeedSeatAsync(FarmB, CoOwner, "SecondaryOwner", FarmAuthority.SeeMoney);
        var ofB = IdOf((await CreateAsync(OwnerB, FarmB, "Grapes", "बी चं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();

        // He is a seat of both farms, so farm B's schedule is visible to him; he holds the authority on A only.
        (await EditAsync(CoOwner, ofB, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(CoOwner, ofB, FarmB, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await TemplateRowCountAsync()).Should().Be(before);
    }

    [Fact]
    public async Task A_holder_on_farm_X_editing_farm_Ys_own_schedule_is_refused_even_when_one_person_owns_both_farms()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedSecondFarmOfOwnerAsync();
        var ofA = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "ए चं")).Body, "scheduleTemplateId");
        var ofC = IdOf((await CreateAsync(Owner, FarmC, "Grapes", "सी चं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();

        // The owner holds everything on both farms; the schedule of one is still not changed by naming the other.
        (await EditAsync(Owner, ofA, FarmC, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(Owner, ofC, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(Owner, ofA, FarmC)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await TemplateRowCountAsync()).Should().Be(before);

        // Not vacuous: naming its own farm works.
        (await EditAsync(Owner, ofA, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await EditAsync(Owner, ofC, FarmC, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Naming_a_farm_other_than_the_chains_own_farm_is_refused_before_any_authority_is_read()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // A person who holds the authority on NO farm at all, naming a farm that is not the chain's: Forbidden either way, and the answer is the
        // same as for a holder - the refusal does not depend on what he holds anywhere.
        await SeedSecondFarmOfOwnerAsync();
        var ofA = await SeedOwnWithDaysAsync(FarmA, Owner);
        await SetAuthoritiesAsync(FarmA, Worker, FarmAuthority.SeeMoney);

        var byHolder = await EditAsync(Owner, ofA, FarmC, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());
        var byNobody = await EditAsync(Worker, ofA, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());

        byHolder.Status.Should().Be(HttpStatusCode.Forbidden, "the owner of both farms, naming the wrong one");
        byNobody.Status.Should().Be(HttpStatusCode.Forbidden);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE previous_version_id = @id", ("id", ofA))).Should().Be(0);
    }

    [Fact]
    public async Task A_holder_on_farm_X_is_refused_publishing_farm_Ys_own_schedule_even_naming_X()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        await SeedSeatAsync(FarmB, CoOwner, "SecondaryOwner", FarmAuthority.SeeMoney);
        var ofB = IdOf((await CreateAsync(OwnerB, FarmB, "Grapes", "बी चं")).Body, "scheduleTemplateId");

        (await PublishAsync(CoOwner, ofB, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(CoOwner, ofB, FarmB)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await RowAsync(ofB))!.PublishedAt.Should().BeNull();
    }

    // ── a Team schedule that names no farm: R32 ──

    [Fact]
    public async Task A_delegate_on_farm_A_cannot_version_the_owners_Team_chain_without_own_farm_id_that_farm_B_lists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var chain = await SeedTemplateRowAsync("Grapes - the owner's Team chain", TenantScope.Team, author: Owner);
        // The owner owns a second farm: that farm's people list his Team chain too (the F99 F-8 rule: a Team schedule is its owner's whole team's) -
        // why a delegate of farm A must not version it.
        await EnsureReviewSeatsAsync();
        await SeedSecondFarmOfOwnerAsync();
        await SeedSeatAsync(FarmC, PlatformEmployee, "Worker", FarmAuthority.SeeMoney);
        (await LibraryAsync(PlatformEmployee)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(chain, "the owner's other farm lists it");
        var before = await TemplateRowCountAsync();

        (await EditAsync(CoOwner, chain, FarmA, Guid.NewGuid(), name: "सहमालकाने बदललं")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await EditAsync(CoOwner, chain, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await TemplateRowCountAsync()).Should().Be(before, "no version of the owner's chain was written by a delegate");
    }

    [Fact]
    public async Task A_delegate_on_farm_A_cannot_version_the_owners_Team_chain_without_own_farm_id_that_farm_B_lists_nor_publish_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var chain = await SeedTemplateRowAsync("Grapes - the owner's Team chain", TenantScope.Team, author: Owner);

        (await PublishAsync(CoOwner, chain, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await RowAsync(chain))!.PublishedAt.Should().BeNull();
    }

    [Fact]
    public async Task The_owner_himself_still_versions_and_publishes_his_chain_without_own_farm_id()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var chain = await SeedTemplateRowAsync("Grapes - the owner's Team chain", TenantScope.Team, author: Owner);

        var edited = await EditAsync(Owner, chain, FarmA, Guid.NewGuid(), name: "माझं बदललेलं");
        edited.Status.Should().Be(HttpStatusCode.Created, edited.Body);
        (await RowAsync(IdOf(edited.Body, "newTemplateId")))!.OwnFarm.Should().BeNull("an edit of a chain with no farm names none");
        (await PublishAsync(Owner, chain, FarmA)).Status.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task An_experts_Team_schedule_still_needs_ScopeRoleGate()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);
        // A Team chain made by a मुकादम: his token role is not one the Team author rule knows (it names no farm, so the farm-level gate does not apply).
        var byMukadam = await SeedTemplateRowAsync("Grapes - made by a मुकादम", TenantScope.Team, author: Mukadam);
        var byOwner = await SeedTemplateRowAsync("Grapes - made by the owner", TenantScope.Team, author: Owner);

        (await EditAsync(Mukadam, byMukadam, FarmA, Guid.NewGuid(), name: "x")).Status.Should().Be(HttpStatusCode.Forbidden,
            "the seat holds the authority, the account's role is not an author role: ScopeRoleGate still asks both");
        (await EditAsync(Owner, byOwner, FarmA, Guid.NewGuid(), name: "y")).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Licensed_clone_and_edit_still_need_LicensedRoles()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);
        var shared = await SeedTemplateRowAsync("Grapes - shared");

        var byMukadam = await ClonePlainAsync(Mukadam, shared, FarmA, Guid.NewGuid(), TenantScope.Licensed);
        byMukadam.Status.Should().Be(HttpStatusCode.Forbidden, "a मुकादम is not a Licensed author");
        var licensed = Guid.NewGuid();
        (await ClonePlainAsync(Owner, shared, FarmA, licensed, TenantScope.Licensed)).Status.Should().Be(HttpStatusCode.Created);
        (await EditAsync(Mukadam, licensed, FarmA, Guid.NewGuid(), name: "z")).Status.Should().BeOneOf(HttpStatusCode.Forbidden, HttpStatusCode.NotFound);
        (await EditAsync(Owner, licensed, FarmA, Guid.NewGuid(), name: "z")).Status.Should().Be(HttpStatusCode.Created);
        // and a Licensed copy is never "into the farm's own"
        (await CloneIntoOwnAsync(Owner, shared, FarmA, Guid.NewGuid(), scope: TenantScope.Licensed)).Status.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task A_delegate_on_A_versions_a_chain_whose_own_farm_id_is_A()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        var ofA = await SeedOwnWithDaysAsync(FarmA, Owner);

        var edited = await EditAsync(CoOwner, ofA, FarmA, Guid.NewGuid(), name: "सहमालक");

        edited.Status.Should().Be(HttpStatusCode.Created, edited.Body);
        (await RowAsync(IdOf(edited.Body, "newTemplateId")))!.Should().Match<TemplateRow>(r => r.OwnFarm == FarmA && r.CreatedBy == CoOwner);
    }

    [Fact]
    public async Task A_delegate_on_A_cannot_version_a_chain_whose_own_farm_id_is_B_even_with_the_same_owner()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedSecondFarmOfOwnerAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        // The chain belongs to the owner's SECOND farm; its owner (the person) is the owner of farm A too.
        var ofC = await SeedOwnWithDaysAsync(FarmC, Owner);

        var named = await EditAsync(CoOwner, ofC, FarmA, Guid.NewGuid(), name: "सहमालक");

        named.Status.Should().Be(HttpStatusCode.NotFound, "a seat of farm A does not even see farm C's schedule (E4)");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE previous_version_id = @id", ("id", ofC))).Should().Be(0);
    }

    // ── mine: the re-keyed one-copy rule ──

    [Fact]
    public async Task Two_farms_each_clone_the_same_checked_schedule_into_their_own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();

        var forA = await CloneIntoOwnAsync(Owner, source.Id, FarmA, a);
        var forB = await CloneIntoOwnAsync(OwnerB, source.Id, FarmB, b);

        forA.Status.Should().Be(HttpStatusCode.Created, forA.Body);
        forB.Status.Should().Be(HttpStatusCode.Created, "the one-copy index is re-keyed: one own copy per source PER FARM: " + forB.Body);
        (await RowAsync(a))!.Should().Match<TemplateRow>(r => r.OwnFarm == FarmA && r.Derived == source.Id && r.Version == 1);
        (await RowAsync(b))!.Should().Match<TemplateRow>(r => r.OwnFarm == FarmB && r.Derived == source.Id && r.Version == 1);
    }

    [Fact]
    public async Task The_same_farm_cloning_it_into_its_own_twice_answers_409()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Created);
        var auditBefore = await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.cloned'");

        var second = await CloneIntoOwnAsync(Owner, source.Id, FarmA, Guid.NewGuid());

        second.Status.Should().Be(HttpStatusCode.Conflict, second.Body);
        ErrorCode(second.Body).Should().Be("ShramSafal.ScheduleCopy.Conflict");
        Json(second.Body).GetProperty("messageMr").GetString().Should().Be("ही प्रत आधीच बनवलेली आहे.");
        (await OwnRowCountAsync(FarmA)).Should().Be(1, "the refused copy wrote nothing");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.cloned'")).Should().Be(auditBefore, "and left no audit row");
    }

    [Fact]
    public async Task An_unchecked_source_cannot_be_cloned_into_the_farms_own()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        var thin = await SeedTemplateRowAsync("Grapes - a thin sample row");
        var waiting = await SeedStoredRowAsync("Grapes - waiting for its check");
        var returned = await SeedStoredRowAsync("Grapes - sent back");
        (await CheckAsync(PlatformOwner, returned.Id, "Returned", note: "सुधारा")).Status.Should().Be(HttpStatusCode.OK);
        var withdrawn = await SeedStoredRowAsync("Grapes - withdrawn");
        (await CheckAsync(PlatformOwner, withdrawn.Id, "Approved", ActivityIdsOf(withdrawn))).Status.Should().Be(HttpStatusCode.OK);
        (await CheckAsync(PlatformOwner, withdrawn.Id, "Withdrawn", note: "मागे घेतलं")).Status.Should().Be(HttpStatusCode.OK);
        var before = await TemplateRowCountAsync();

        foreach (var source in new[] { thin, waiting.Id, returned.Id, withdrawn.Id })
        {
            var refused = await CloneIntoOwnAsync(Owner, source, FarmA, Guid.NewGuid());
            refused.Status.Should().Be(HttpStatusCode.BadRequest, $"{source}: {refused.Body}");
            ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleNotChecked");
        }

        var sample = await CloneIntoOwnAsync(Owner, BuiltInGrapes, FarmA, Guid.NewGuid());
        sample.Status.Should().Be(HttpStatusCode.NotFound, "a built-in sample is no row to copy");
        (await TemplateRowCountAsync()).Should().Be(before);

        // Not vacuous: a plain copy of the same waiting row is still allowed, and a checked one goes into the farm's own.
        (await ClonePlainAsync(Owner, waiting.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Created);
        var good = await CheckedGrapeScheduleAsync("Grapes - the checked one");
        (await CloneIntoOwnAsync(Owner, good.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Created);
    }

    // ── the same doors as a sync push (Task 4) ──

    [Fact]
    public async Task A_push_makes_the_same_rows_as_the_REST_doors()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();

        // REST by farm A's owner; push by farm B's owner (the one-own-copy-per-farm rule is per farm).
        var restCreate = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रेस्ट")).Body, "scheduleTemplateId");
        var restClone = Guid.NewGuid();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, restClone)).Status.Should().Be(HttpStatusCode.Created);
        var restEdit = Guid.NewGuid();
        (await EditAsync(Owner, restCreate, FarmA, restEdit, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);

        var pushCreate = Guid.NewGuid();
        var created = await PushAsync(OwnerB, "schedule.create", "sown-push-create", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = pushCreate,
            ["farmId"] = FarmB,
            ["cropKey"] = "Grapes",
            ["name"] = "रेस्ट",
        });
        var pushClone = Guid.NewGuid();
        var cloned = await PushAsync(OwnerB, "schedule.clone", "sown-push-clone", new Dictionary<string, object?>
        {
            ["sourceScheduleTemplateId"] = source.Id,
            ["newScheduleTemplateId"] = pushClone,
            ["actorUserId"] = OwnerB,
            ["newScope"] = "Team",
            ["farmId"] = FarmB,
            ["intoFarmOwn"] = true,
        });
        var pushEdit = Guid.NewGuid();
        var edited = await PushAsync(OwnerB, "schedule.edit", "sown-push-edit", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = pushCreate,
            ["newScheduleTemplateId"] = pushEdit,
            ["actorUserId"] = OwnerB,
            ["farmId"] = FarmB,
            ["stages"] = SomeStages(),
            ["activities"] = SomeWorks(),
        });

        created.Status.Should().Be("applied", $"{created.ErrorCode}: {created.ErrorMessage}");
        cloned.Status.Should().Be("applied", $"{cloned.ErrorCode}: {cloned.ErrorMessage}");
        edited.Status.Should().Be("applied", $"{edited.ErrorCode}: {edited.ErrorMessage}");
        foreach (var (rest, push, farm, maker) in new[] { (restCreate, pushCreate, FarmB, OwnerB), (restClone, pushClone, FarmB, OwnerB), (restEdit, pushEdit, FarmB, OwnerB) })
        {
            var r = (await RowAsync(rest))!;
            var p = (await RowAsync(push))!;
            (p.Scope, p.Version, p.OwnerType, p.CropKey, p.Stage, p.Activities, p.Stages)
                .Should().Be((r.Scope, r.Version, r.OwnerType, r.CropKey, r.Stage, r.Activities, r.Stages), "push and REST write the same row");
            p.OwnFarm.Should().Be(farm);
            p.CreatedBy.Should().Be(maker);
        }

        (await RowAsync(pushEdit))!.Previous.Should().Be(pushCreate);
        (await RowAsync(pushClone))!.Derived.Should().Be(source.Id);
    }

    [Fact]
    public async Task A_push_uses_the_authenticated_user_never_the_body_and_the_same_gate()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney);

        // A body that names the owner as the actor does not make the push his: the authenticated person (the सहमालक, without the authority) is asked.
        var created = await PushAsync(CoOwner, "schedule.create", "sown-push-forged", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["cropKey"] = "Grapes",
            ["name"] = "बनावट",
        });
        var cloned = await PushAsync(CoOwner, "schedule.clone", "sown-push-forged-clone", new Dictionary<string, object?>
        {
            ["sourceScheduleTemplateId"] = source.Id,
            ["newScheduleTemplateId"] = Guid.NewGuid(),
            ["actorUserId"] = Owner,
            ["actorRole"] = "PrimaryOwner",
            ["newScope"] = "Team",
            ["farmId"] = FarmA,
            ["intoFarmOwn"] = true,
        });
        var noFarm = await PushAsync(Owner, "schedule.clone", "sown-push-no-farm", new Dictionary<string, object?>
        {
            ["sourceScheduleTemplateId"] = source.Id,
            ["newScheduleTemplateId"] = Guid.NewGuid(),
            ["actorUserId"] = Owner,
            ["newScope"] = "Team",
            ["intoFarmOwn"] = true,
        });

        created.Status.Should().Be("failed");
        created.ErrorCode.Should().Be("ShramSafal.Forbidden");
        cloned.Status.Should().Be("failed");
        cloned.ErrorCode.Should().Be("ShramSafal.Forbidden");
        noFarm.Status.Should().Be("failed");
        noFarm.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await OwnRowCountAsync(FarmA)).Should().Be(0);
    }

    [Fact]
    public async Task A_mukadam_holder_clones_into_his_farms_own_schedule_through_the_real_handler()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var first = await CheckedGrapeScheduleAsync();
        var second = await CheckedGrapeScheduleAsync("Grapes - the second checked one");
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);

        var viaRest = Guid.NewGuid();
        (await CloneIntoOwnAsync(Mukadam, first.Id, FarmA, viaRest)).Status.Should().Be(HttpStatusCode.Created);
        var viaPush = Guid.NewGuid();
        var pushed = await PushAsync(Mukadam, "schedule.clone", "sown-mukadam-clone", new Dictionary<string, object?>
        {
            ["sourceScheduleTemplateId"] = second.Id,
            ["newScheduleTemplateId"] = viaPush,
            ["actorUserId"] = Mukadam,
            ["newScope"] = "Team",
            ["farmId"] = FarmA,
            ["intoFarmOwn"] = true,
        });

        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        foreach (var id in new[] { viaRest, viaPush })
        {
            (await RowAsync(id))!.Should().Match<TemplateRow>(r => r.OwnFarm == FarmA && r.CreatedBy == Mukadam && r.Scope == Team && r.Activities == 4);
        }
    }

    [Fact]
    public async Task A_push_with_an_id_that_exists_is_refused_permanently_and_a_repeated_push_is_the_same_schedule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var id = Guid.NewGuid();
        var payload = new Dictionary<string, object?> { ["scheduleTemplateId"] = id, ["farmId"] = FarmA, ["cropKey"] = "Grapes", ["name"] = "एकच" };

        var first = await PushAsync(Owner, "schedule.create", "sown-push-once", payload);
        var again = await PushAsync(Owner, "schedule.create", "sown-push-once", payload);
        var taken = await PushAsync(Owner, "schedule.create", "sown-push-other", payload);

        first.Status.Should().Be("applied");
        again.Status.Should().BeOneOf(new[] { "applied", "duplicate" }, "the same request is the same schedule: one row");
        taken.Status.Should().Be("failed");
        taken.ErrorCode.Should().Be("ShramSafal.ScheduleIdTaken.Conflict", "its tail is CONFLICT, which every shipped phone parks as permanent");
        (await OwnRowCountAsync(FarmA)).Should().Be(1);
    }

    [Fact]
    public async Task A_push_edit_with_only_the_old_fields_renames()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var own = await SeedOwnWithDaysAsync(FarmA, Owner, "जुनं नाव");
        var renamed = Guid.NewGuid();

        var pushed = await PushAsync(Owner, "schedule.edit", "sown-push-rename", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = own,
            ["newScheduleTemplateId"] = renamed,
            ["actorUserId"] = Owner,
            ["farmId"] = FarmA,
            ["newName"] = "नवं नाव",
        });

        pushed.Status.Should().Be("applied", $"{pushed.ErrorCode}: {pushed.ErrorMessage}");
        (await RowAsync(renamed))!.Should().Match<TemplateRow>(r => r.Name == "नवं नाव" && r.Activities == 1 && r.Stages == 2 && r.Version == 3);
    }

    // ── the save itself answers a rival that took the id (the check above it can lose a race) ──

    [Fact]
    public async Task A_rival_that_took_the_id_first_is_answered_by_the_save_itself_and_the_transaction_goes_on()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var taken = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "पहिलं")).Body, "scheduleTemplateId");
        var source = await CheckedGrapeScheduleAsync();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, Guid.NewGuid())).Status.Should().Be(HttpStatusCode.Created);
        var before = await TemplateRowCountAsync();

        // Inside a transaction (the posture of a REST scope and of a sync push): the refusal rolls back to a savepoint, so the transaction is usable after.
        var outcomes = await AsFarmMemberAsync(FarmA, Owner, async sp =>
        {
            var repository = sp.GetRequiredService<ShramSafal.Application.Ports.IShramSafalRepository>();

            // 1. the same id as a row that exists (the primary key)
            var sameId = ScheduleTemplate.CreateOwn(
                taken, "बदलायचं", "Grapes", FarmA, new AgriSync.SharedKernel.Contracts.Ids.UserId(Owner), DateTime.UtcNow);
            await repository.AddScheduleTemplateAsync(sameId);
            var first = await repository.TrySaveNewScheduleAsync();

            // 2. a second own copy of the same source for the same farm (the own-copy index)
            var plain = await repository.GetScheduleTemplateByIdAsync(source.Id);
            var secondCopy = plain!.Clone(Guid.NewGuid(), new AgriSync.SharedKernel.Contracts.Ids.UserId(Owner), TenantScope.Team, "फिरून", DateTime.UtcNow, ownFarmId: FarmA);
            await repository.AddScheduleTemplateAsync(secondCopy);
            var second = await repository.TrySaveNewScheduleAsync();

            // 3. the transaction goes on: a fresh row saves
            var fresh = ScheduleTemplate.CreateOwn(
                Guid.NewGuid(), "नवं", "Grapes", FarmA, new AgriSync.SharedKernel.Contracts.Ids.UserId(Owner), DateTime.UtcNow);
            await repository.AddScheduleTemplateAsync(fresh);
            var third = await repository.TrySaveNewScheduleAsync();
            return (first, second, third);
        });

        outcomes.first.Should().Be(ShramSafal.Application.Ports.ScheduleCopySave.IdTaken);
        outcomes.second.Should().Be(ShramSafal.Application.Ports.ScheduleCopySave.CopyExists);
        outcomes.third.Should().Be(ShramSafal.Application.Ports.ScheduleCopySave.Saved);
        (await TemplateRowCountAsync()).Should().Be(before, "the scope's transaction is rolled back by the harness; nothing of the refused saves was kept");
        (await RowAsync(taken))!.Name.Should().Be("पहिलं", "nothing was overwritten");
    }

    // ── fix round 1, M002: what does not fit the column or the contract is a refusal, never a 500 and never a retry for ever ──

    [Fact]
    public async Task An_operation_key_that_does_not_fit_is_refused_over_REST_and_push_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();
        var tooLong = "op_" + new string('a', 42); // 45 characters; the column holds 40

        var rest = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(),
            activities: new[] { Work("x", "work", 0, 5, "one_time", 1, operationKey: tooLong) });
        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.ScheduleImportOperationKey");
        var emptyKey = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(),
            activities: new[] { Work("x", "work", 0, 5, "one_time", 1, operationKey: "") });
        emptyKey.Status.Should().Be(HttpStatusCode.BadRequest, emptyKey.Body);

        var pushed = await PushAsync(Owner, "schedule.edit", "sown-m002-key", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = v1,
            ["newScheduleTemplateId"] = Guid.NewGuid(),
            ["actorUserId"] = Owner,
            ["farmId"] = FarmA,
            ["stages"] = SomeStages(),
            ["activities"] = new[] { Work("x", "work", 0, 5, "one_time", 1, operationKey: tooLong) },
        });
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleImportOperationKey", "a validation refusal is permanent; the unhandled-fault code is the one a phone retries");
        (await TemplateRowCountAsync()).Should().Be(before, "nothing was written");

        // Not vacuous: 40 characters fit.
        var fits = "op_" + new string('a', 37);
        var ok = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: new[] { Work("x", "work", 0, 5, "one_time", 1, operationKey: fits) });
        ok.Status.Should().Be(HttpStatusCode.Created, ok.Body);
    }

    [Fact]
    public async Task Counts_and_days_beyond_the_contract_bounds_are_refused_over_REST_and_push()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "माझं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();
        var manyStages = Enumerable.Range(0, 41).Select(i => (object)new { name = "S" + i, startDay = i * 10, endDay = i * 10 + 9 }).ToArray();
        var manyWorks = Enumerable.Range(0, 301).Select(i => Work("W" + i, "work", 0, 1, "one_time", 1)).ToArray();

        var stages = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: manyStages);
        var works = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: manyWorks);
        var days = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: new object[] { new { name = "Long", startDay = 0, endDay = 3651 } });

        stages.Status.Should().Be(HttpStatusCode.BadRequest, stages.Body);
        ErrorCode(stages.Body).Should().Be("ShramSafal.ScheduleImportStages");
        works.Status.Should().Be(HttpStatusCode.BadRequest, works.Body);
        ErrorCode(works.Body).Should().Be("ShramSafal.ScheduleImportActivities");
        days.Status.Should().Be(HttpStatusCode.BadRequest, days.Body);
        ErrorCode(days.Body).Should().Be("ShramSafal.ScheduleImportStageDays");

        var pushed = await PushAsync(Owner, "schedule.edit", "sown-m002-bounds", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = v1,
            ["newScheduleTemplateId"] = Guid.NewGuid(),
            ["actorUserId"] = Owner,
            ["farmId"] = FarmA,
            ["stages"] = manyStages,
        });
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleImportStages");
        (await TemplateRowCountAsync()).Should().Be(before);
    }

    // ── fix round 1, M008: a replay is the same PERSON's replay ──

    [Fact]
    public async Task Another_user_replaying_the_same_clientCommandId_does_not_get_the_first_users_result()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var source = await CheckedGrapeScheduleAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        await SetAuthoritiesAsync(FarmA, Worker, FarmAuthority.SeeMoney);
        var first = await CreateAsync(Owner, FarmA, "Grapes", "पहिलं", Guid.NewGuid(), "sown-m008-shared");
        first.Status.Should().Be(HttpStatusCode.Created, first.Body);
        var firstId = IdOf(first.Body, "scheduleTemplateId");

        // a person who may not make it learns nothing of the stored answer (the gate, not the stored answer, is what he meets)
        var refused = await CreateAsync(Worker, FarmA, "Grapes", "घुसखोर", Guid.NewGuid(), "sown-m008-shared");
        refused.Status.Should().Be(HttpStatusCode.Forbidden, refused.Body);
        refused.Body.Should().NotContain(firstId.ToString());

        // a person who may gets HIS OWN schedule, not the first user's result
        var otherId = Guid.NewGuid();
        var second = await CreateAsync(CoOwner, FarmA, "Grapes", "दुसरं", otherId, "sown-m008-shared");
        second.Status.Should().Be(HttpStatusCode.Created, second.Body);
        IdOf(second.Body, "scheduleTemplateId").Should().Be(otherId);
        (await RowAsync(otherId))!.CreatedBy.Should().Be(CoOwner);

        // the same holds for clone and edit
        var cloneId = Guid.NewGuid();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, cloneId, "sown-m008-clone")).Status.Should().Be(HttpStatusCode.Created);
        var cloneRefused = await CloneIntoOwnAsync(Worker, source.Id, FarmA, Guid.NewGuid(), "sown-m008-clone");
        cloneRefused.Status.Should().Be(HttpStatusCode.Forbidden, cloneRefused.Body);
        var editId = Guid.NewGuid();
        (await EditAsync(Owner, firstId, FarmA, editId, stages: SomeStages(), activities: SomeWorks(), commandId: "sown-m008-edit")).Status.Should().Be(HttpStatusCode.Created);
        var editRefused = await EditAsync(Worker, firstId, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks(), commandId: "sown-m008-edit");
        editRefused.Status.Should().Be(HttpStatusCode.Forbidden, editRefused.Body);
        editRefused.Body.Should().NotContain(editId.ToString());
    }

    // ── fix round 1, M011 (session A, F219): a unique violation on the id is answered by re-reading the id, whatever the key is called ──

    [Fact]
    public async Task A_unique_violation_on_the_id_is_answered_ScheduleIdTaken_whatever_the_primary_key_is_called()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // Production's table may have been made by an older script with another key name: rename it here and prove the answer does not depend on it.
        await ExecOnSuperuserAsync("ALTER TABLE ssf.schedule_templates RENAME CONSTRAINT schedule_templates_pkey TO sown_other_name_pk");
        var taken = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "पहिलं")).Body, "scheduleTemplateId");
        var before = await TemplateRowCountAsync();

        var outcome = await AsFarmMemberAsync(FarmA, Owner, async sp =>
        {
            var repository = sp.GetRequiredService<ShramSafal.Application.Ports.IShramSafalRepository>();
            await repository.AddScheduleTemplateAsync(ScheduleTemplate.CreateOwn(
                taken, "बदलायचं", "Grapes", FarmA, new AgriSync.SharedKernel.Contracts.Ids.UserId(Owner), DateTime.UtcNow));
            var first = await repository.TrySaveNewScheduleAsync();
            // the transaction goes on
            await repository.AddScheduleTemplateAsync(ScheduleTemplate.CreateOwn(
                Guid.NewGuid(), "नवं", "Grapes", FarmA, new AgriSync.SharedKernel.Contracts.Ids.UserId(Owner), DateTime.UtcNow));
            var second = await repository.TrySaveNewScheduleAsync();
            return (first, second);
        });

        outcome.first.Should().Be(ShramSafal.Application.Ports.ScheduleCopySave.IdTaken);
        outcome.second.Should().Be(ShramSafal.Application.Ports.ScheduleCopySave.Saved);
        (await TemplateRowCountAsync()).Should().Be(before);
        (await RowAsync(taken))!.Name.Should().Be("पहिलं");

        // and through the door: the id-exists check wins here, so this is the 409 of every day
        var again = await CreateAsync(Owner, FarmA, "Grapes", "फिरून", taken);
        again.Status.Should().Be(HttpStatusCode.Conflict, again.Body);
    }

    [Fact]
    public async Task Two_saves_of_the_same_id_at_once_never_answer_500()
    {
        await AssertAppRoleIsNotVacuousAsync();
        for (var round = 0; round < 6; round++)
        {
            var id = Guid.NewGuid();
            var a = CreateAsync(Owner, FarmA, "Grapes", "एकच", id, $"sown-m011-a-{round}");
            var b = CreateAsync(Owner, FarmA, "Grapes", "एकच", id, $"sown-m011-b-{round}");
            var both = await Task.WhenAll(a, b);

            both.Select(r => (int)r.Status).Should().OnlyContain(s => s == 201 || s == 409, $"round {round}: {string.Join(" / ", both.Select(r => r.Body))}");
            both.Should().Contain(r => r.Status == HttpStatusCode.Created);
            (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id", ("id", id))).Should().Be(1);
        }
    }
}
