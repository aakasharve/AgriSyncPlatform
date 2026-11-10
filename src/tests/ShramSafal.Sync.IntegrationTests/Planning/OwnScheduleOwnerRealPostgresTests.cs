// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN-c (founder D-133 withdrawn, D-136, D-137 Q9 = 1 / Q10 = 1; register F218, F222 (a)-(f),
// F223, F225, F227, F228).
//
// A schedule belongs to the PERSON: ssf.schedule_templates.owner_user_id is the owner of the farm it was made on (read from the farm row the gate trusted,
// never from the body); the version names its typist (D-88). Made-for tags (variety / soil / region / climate) are list codes, never a refusal of a follow.
// A version with stages and no works lists no stage (M004) but carries draftStages. After the farm's owner changes (no door does this today, F223 - the test
// simulates a FUTURE transfer by raw SQL), the plot keeps its version, its readers still receive it in the pull, and the new owner cannot adopt it afresh.
// Real Postgres as agrisync_app (E3 first, in every fact), through the real host, the real handlers, the real push and the real pull. Every negative
// asserts that NOTHING was written.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

[Trait("Category", "RequiresPostgres")]
public sealed class OwnScheduleOwnerRealPostgresTests(ITestOutputHelper output) : OwnScheduleLane(output)
{
    private static Dictionary<string, object?> Adopt(Guid farm, Guid plot, Guid cycle, Guid template, Guid actor) => new()
    {
        ["farmId"] = farm,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["scheduleTemplateId"] = template,
        ["actorUserId"] = actor,
        ["subscriptionId"] = Guid.NewGuid(),
    };

    private sealed record Marks(string? Origin, string? CheckAtAdopt, short? Slot, int State, Guid Template);

    private async Task<List<Marks>> MarksOfPlotAsync(Guid plot)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT origin, check_state_at_adopt, slot, state, schedule_template_id FROM ssf.schedule_subscriptions
            WHERE plot_id = @plot ORDER BY adopted_at_utc, id
            """;
        cmd.Parameters.AddWithValue("plot", plot);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<Marks>();
        while (await reader.ReadAsync())
        {
            rows.Add(new Marks(
                reader.IsDBNull(0) ? null : reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetInt16(2), reader.GetInt32(3), reader.GetGuid(4)));
        }

        return rows;
    }

    private Task<long> CreatedAuditRowsAsync() =>
        CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ScheduleTemplate' AND action = 'schedule.created'");

    private static (string? Variety, string? SoilType, string? Region, string? Climate) TagsOf(TemplateRow row) => (row.Variety, row.SoilType, row.Region, row.Climate);

    private static (string? Variety, string? SoilType, string? Region, string? Climate) TagsOf(JsonElement entry) =>
        (Text(entry, "variety"), Text(entry, "soilType"), Text(entry, "region"), Text(entry, "climate"));

    private static string? Text(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static readonly (string, string, string, string) AllFour = ("Thompson Seedless", "black", "mh_nashik", "dry");

    // ── 1. Q9 = 1: the OWNER owns a holder-typed schedule; the version names the typist ──

    [Fact]
    public async Task A_schedule_typed_by_a_holder_is_the_owners_and_each_version_names_its_typist()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.ScheduleTemplates);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ScheduleTemplates);

        var created = await CreateAsync(CoOwner, FarmA, "Grapes", "सहमालकाने टाइप केलेलं");
        created.Status.Should().Be(HttpStatusCode.Created, created.Body);
        var v1 = IdOf(created.Body, "scheduleTemplateId");
        var r1 = (await RowAsync(v1))!;
        (r1.OwnerUser, r1.CreatedBy).Should().Be(((Guid?)Owner, (Guid?)CoOwner), "the farm's OWNER owns it; the version names its typist");

        var v2 = Guid.NewGuid();
        (await EditAsync(Mukadam, v1, FarmA, v2, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        var r2 = (await RowAsync(v2))!;
        (r2.OwnerUser, r2.CreatedBy, r2.Previous).Should().Be(((Guid?)Owner, (Guid?)Mukadam, (Guid?)v1), "the owner never changes with the typist");

        // The library entry carries whose it is, who typed THIS version, when, and the version before - in the owner's pull and in a seat's library.
        var (_, root) = await PullAsync(Owner);
        var e2 = ArrayOf(root, "scheduleTemplates").Single(t => t.GetProperty("id").GetGuid() == v2);
        e2.GetProperty("ownerUserId").GetGuid().Should().Be(Owner);
        e2.GetProperty("madeByUserId").GetGuid().Should().Be(Mukadam);
        e2.GetProperty("madeAtUtc").ValueKind.Should().Be(JsonValueKind.String);
        e2.GetProperty("previousVersionId").GetGuid().Should().Be(v1);
        var w1 = (await ListedAsync(Worker, v1))!.Value;
        w1.GetProperty("ownerUserId").GetGuid().Should().Be(Owner);
        w1.GetProperty("madeByUserId").GetGuid().Should().Be(CoOwner);
        (w1.TryGetProperty("previousVersionId", out var prev) ? prev.ValueKind : JsonValueKind.Null).Should().Be(JsonValueKind.Null, "version 1 has none");

        // P11: a 1.0.17-header pull still parses and still carries every field that release reads.
        using var old = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", Owner, null, "1.0.17", null);
        var body = await old.Content.ReadAsStringAsync();
        old.IsSuccessStatusCode.Should().BeTrue(body);
        var oldEntry = ArrayOf(Json(body), "scheduleTemplates").Single(t => t.GetProperty("id").GetGuid() == v2);
        foreach (var key in new[] { "id", "name", "cropType", "totalDays", "stages", "activities", "versionHash" })
        {
            oldEntry.TryGetProperty(key, out _).Should().BeTrue($"the field {key} release 1.0.17 reads is still there");
        }
    }

    // ── 4. R-c8 (founder-eyes): a holder on the owner's OTHER farm versions and publishes his schedule naming that farm ──

    [Fact]
    public async Task A_holder_on_the_owners_farm_C_versions_and_publishes_the_owners_schedule_naming_farm_C()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await EnsureReviewSeatsAsync();
        await SeedSecondFarmOfOwnerAsync();
        await SeedSeatAsync(FarmC, PlatformEmployee, "Worker", FarmAuthority.ScheduleTemplates);
        var ofA = await SeedOwnWithDaysAsync(Owner, Owner); // made on farm A; the row stores no farm - it is the OWNER's
        var versionsBefore = await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE previous_version_id = @id", ("id", ofA));

        var v = Guid.NewGuid();
        var edited = await EditAsync(PlatformEmployee, ofA, FarmC, v, stages: SomeStages(), activities: SomeWorks());
        edited.Status.Should().Be(HttpStatusCode.Created, edited.Body);
        var row = (await RowAsync(v))!;
        (row.OwnerUser, row.CreatedBy).Should().Be(((Guid?)Owner, (Guid?)PlatformEmployee), "the owner stays; the version names the holder");
        var published = await PublishAsync(PlatformEmployee, v, FarmC);
        published.Status.Should().Be(HttpStatusCode.OK, published.Body);
        (await RowAsync(v))!.PublishedAt.Should().NotBeNull();

        // Naming farm A, where he holds nothing: refused, nothing written.
        (await EditAsync(PlatformEmployee, ofA, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        (await PublishAsync(PlatformEmployee, ofA, FarmA)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await RowAsync(ofA))!.PublishedAt.Should().BeNull();
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE previous_version_id = @id", ("id", ofA))).Should().Be(versionsBefore + 1);
    }

    // ── 7, 8. Q10 = 1: tags are list codes; a code outside its list is refused with words; the variety is checked per crop ──

    [Fact]
    public async Task A_made_for_tag_outside_its_list_is_refused_over_REST_and_push_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var v1 = await SeedOwnEmptyAsync(Owner, Owner);
        var before = await TemplateRowCountAsync();
        var auditBefore = await CreatedAuditRowsAsync();

        var rest = await CreateAsync(Owner, FarmA, "Grapes", "वाळूसारखी", soilType: "sandyish");
        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.ScheduleMadeFor");
        Json(rest.Body).GetProperty("messageMr").GetString().Should().Be("ही निवड यादीत नाही.");
        Json(rest.Body).GetProperty("message").GetString().Should().Contain("sandyish").And.Contain("soilType");

        var pushed = await PushAsync(Owner, "schedule.create", "sownc-tag-create", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["cropKey"] = "Grapes",
            ["name"] = "वाळूसारखी",
            ["soilType"] = "sandyish",
        });
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleMadeFor", "a validation refusal is permanent for a phone; never the retryable unhandled code");

        var edit = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks(), climate: "monsoon");
        edit.Status.Should().Be(HttpStatusCode.BadRequest, edit.Body);
        ErrorCode(edit.Body).Should().Be("ShramSafal.ScheduleMadeFor");
        var pushedEdit = await PushAsync(Owner, "schedule.edit", "sownc-tag-edit", new Dictionary<string, object?>
        {
            ["scheduleTemplateId"] = v1,
            ["newScheduleTemplateId"] = Guid.NewGuid(),
            ["actorUserId"] = Owner,
            ["farmId"] = FarmA,
            ["stages"] = SomeStages(),
            ["activities"] = SomeWorks(),
            ["climate"] = "monsoon",
        });
        pushedEdit.Status.Should().Be("failed");
        pushedEdit.ErrorCode.Should().Be("ShramSafal.ScheduleMadeFor");

        var label = await CreateAsync(Owner, FarmA, "Grapes", "लेबल", soilType: "काळी");
        label.Status.Should().Be(HttpStatusCode.BadRequest, "a Marathi label is data for the phone, never a code");
        ErrorCode(label.Body).Should().Be("ShramSafal.ScheduleMadeFor");

        var renameWithTag = await EditAsync(Owner, v1, FarmA, Guid.NewGuid(), name: "नवं", climate: "dry");
        renameWithTag.Status.Should().Be(HttpStatusCode.BadRequest, "R-c18: a tag comes only with a whole version");
        ErrorCode(renameWithTag.Body).Should().Be("ShramSafal.InvalidCommand");

        (await TemplateRowCountAsync()).Should().Be(before, "nothing was written");
        (await CreatedAuditRowsAsync()).Should().Be(auditBefore, "and no audit row");
    }

    [Fact]
    public async Task A_variety_of_another_crop_is_refused_and_Local_is_accepted_only_for_a_crop_without_a_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var before = await TemplateRowCountAsync();

        var otherCrop = await CreateAsync(Owner, FarmA, "Grapes", "डाळिंबाची जात", variety: "Bhagwa");
        var local = await CreateAsync(Owner, FarmA, "Grapes", "लोकल", variety: "Local");
        otherCrop.Status.Should().Be(HttpStatusCode.BadRequest, otherCrop.Body);
        ErrorCode(otherCrop.Body).Should().Be("ShramSafal.ScheduleMadeFor");
        Json(otherCrop.Body).GetProperty("message").GetString().Should().Contain("Bhagwa").And.Contain("variety");
        local.Status.Should().Be(HttpStatusCode.BadRequest, "a Grapes schedule may not say Local: Grapes has its own list");
        (await TemplateRowCountAsync()).Should().Be(before);

        var grape = await CreateAsync(Owner, FarmA, "Grapes", "थॉम्पसन", variety: "Thompson Seedless");
        grape.Status.Should().Be(HttpStatusCode.Created, grape.Body);
        (await RowAsync(IdOf(grape.Body, "scheduleTemplateId")))!.Variety.Should().Be("Thompson Seedless");

        await SeedSeasonAsync("Sugarcane");
        var sugarcane = await CreateAsync(Owner, FarmA, "Sugarcane", "ऊस लोकल", variety: "Local");
        sugarcane.Status.Should().Be(HttpStatusCode.Created, sugarcane.Body);
        (await RowAsync(IdOf(sugarcane.Body, "scheduleTemplateId")))!.Variety.Should().Be("Local", "a crop without a list takes _other");
    }

    // ── 9. tags: written on create, carried by clone and rename, written as sent by a whole edit, listed and hashed ──

    [Fact]
    public async Task Tags_are_written_on_create_carried_by_clone_and_a_rename_and_written_as_sent_by_a_whole_edit_and_listed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var created = await CreateAsync(Owner, FarmA, "Grapes", "टॅग केलेलं", variety: "Thompson Seedless", soilType: "black", region: "mh_nashik", climate: "dry");
        created.Status.Should().Be(HttpStatusCode.Created, created.Body);
        var v1 = IdOf(created.Body, "scheduleTemplateId");
        TagsOf((await RowAsync(v1))!).Should().Be(AllFour);

        var renamed = Guid.NewGuid();
        (await EditAsync(Owner, v1, FarmA, renamed, name: "नवं नाव")).Status.Should().Be(HttpStatusCode.Created);
        TagsOf((await RowAsync(renamed))!).Should().Be(AllFour, "a rename carries what it was made for");
        var hashBefore = (await LibraryAsync(Owner))[0].GetProperty("versionHash").GetString();

        var whole = Guid.NewGuid();
        (await EditAsync(Owner, renamed, FarmA, whole, stages: SomeStages(), activities: SomeWorks(), variety: "Sharad Seedless")).Status.Should().Be(HttpStatusCode.Created);
        TagsOf((await RowAsync(whole))!).Should().Be(("Sharad Seedless", (string?)null, (string?)null, (string?)null), "written whole, as sent");
        TagsOf((await RowAsync(renamed))!).Should().Be(AllFour, "P3: the version before keeps its own tags");
        var noTags = Guid.NewGuid();
        (await EditAsync(Owner, whole, FarmA, noTags, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        TagsOf((await RowAsync(noTags))!).Should().Be(((string?)null, (string?)null, (string?)null, (string?)null), "absent = none");

        // A clone of a Checked Public source into his own carries the SOURCE's tags: none today.
        var source = await CheckedGrapeScheduleAsync();
        var copy = Guid.NewGuid();
        (await CloneIntoOwnAsync(Owner, source.Id, FarmA, copy)).Status.Should().Be(HttpStatusCode.Created);
        var copyRow = (await RowAsync(copy))!;
        TagsOf(copyRow).Should().Be(((string?)null, (string?)null, (string?)null, (string?)null));
        copyRow.OwnerUser.Should().Be(Owner);

        // The library lists the tags, and the list's hash moved after the tag edit.
        var library = await LibraryAsync(Owner);
        TagsOf(RowOf(library, renamed)!.Value).Should().Be(AllFour);
        TagsOf(RowOf(library, whole)!.Value).Should().Be(("Sharad Seedless", (string?)null, (string?)null, (string?)null));
        TagsOf(RowOf(library, noTags)!.Value).Should().Be(((string?)null, (string?)null, (string?)null, (string?)null));
        library[0].GetProperty("versionHash").GetString().Should().NotBe(hashBefore);
    }

    // ── 10. M004: a version with stages and no works lists no stage (1.0.17) but carries draftStages, and cannot be followed ──

    [Fact]
    public async Task A_version_with_stages_and_no_works_lists_draft_stages_but_no_stages_and_cannot_be_followed()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var empty = IdOf((await CreateAsync(Owner, FarmA, "Grapes", "रिकामं")).Body, "scheduleTemplateId");
        var stagesOnly = Guid.NewGuid();
        (await EditAsync(Owner, empty, FarmA, stagesOnly, stages: SomeStages())).Status.Should().Be(HttpStatusCode.Created);

        var entry = (await ListedAsync(Owner, stagesOnly))!.Value;
        entry.GetProperty("stages").GetArrayLength().Should().Be(0, "M004: no stage for a phone that would churn on it");
        entry.GetProperty("totalDays").GetInt32().Should().Be(0);
        entry.GetProperty("hasStoredDays").GetBoolean().Should().BeFalse();
        var draft = entry.GetProperty("draftStages");
        draft.GetArrayLength().Should().Be(3);
        draft.EnumerateArray().Select(s => s.GetProperty("name").GetString()).Should().Equal("Pruning", "Growth", "Berry");
        draft.EnumerateArray().Select(s => s.GetProperty("endDay").GetInt32()).Should().Equal(20, 60, 120);
        (await ListedAsync(Owner, empty))!.Value.TryGetProperty("draftStages", out var none).Should().BeTrue();
        none.ValueKind.Should().Be(JsonValueKind.Null, "an empty version has no stage to draft");

        var rest = await AdoptAsync(Owner, FarmA, PlotA, CycleA, stagesOnly);
        rest.Status.Should().Be(HttpStatusCode.BadRequest, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.OwnScheduleEmpty");
        var pushed = await PushAsync(Owner, "adopt_schedule", "sownc-stages-only", Adopt(FarmA, PlotA, CycleA, stagesOnly, Owner));
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.OwnScheduleEmpty");
        (await SubscriptionsAsync()).Should().BeEmpty("nothing was written");

        // Kept for the P11 run (5.5): release 1.0.17's own catalog must DROP this row (no stage on the wire).
        using var old = await SendAsync(HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(PhoneCursor(DateTime.UnixEpoch))}", Owner, null, "1.0.17", null);
        var body = await old.Content.ReadAsStringAsync();
        old.IsSuccessStatusCode.Should().BeTrue(body);
        KeepP11Body("owner-with-a-stages-only-version", body);
    }

    // ── 12. F222 (a), (e): a FUTURE transfer of the farm (no door does this today, F223) ──

    [Fact]
    public async Task After_the_farms_owner_changes_the_plot_keeps_its_version_its_readers_still_receive_it_and_the_new_owner_cannot_adopt_it_afresh()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedSecondFarmOfOwnerAsync();
        var own = await SeedOwnWithDaysAsync(Owner, Owner);
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, own)).Status.Should().Be(HttpStatusCode.OK);
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.Should().Be(new Marks("Own", null, 0, 0, own));
        var rowsBefore = await TemplateRowCountAsync();

        // No route, handler or push changes ssf.farms.owner_user_id (F223): this simulates a transfer that does not exist yet, as the superuser. A real transfer
        // would move the PrimaryOwner seat with the column (the seat is a label, FarmAuthority.IsHeld gives it every authority), so the new owner gets one too:
        // his pull window and his doors on farm A then run as the farm's owner.
        await ExecOnSuperuserAsync("UPDATE ssf.farms SET owner_user_id = @ownerB WHERE \"Id\" = @farmA", ("ownerB", OwnerB), ("farmA", FarmA));
        await SeedSeatAsync(FarmA, OwnerB, "PrimaryOwner");

        // (1) the subscription row is untouched: same version row, Active, origin Own (Q8: nothing moves a plot).
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.Should().Be(new Marks("Own", null, 0, 0, own));

        // (2) the pull keeps carrying the followed version row and its subscription to everyone who reads the plot: the new owner and a seat of A that reads
        // the farm overview (a सहमालक; a कामगार seat is own-only and never receives subscriptions, FarmReadScope - the pull's own rule, not this lane's).
        foreach (var (who, user) in new[] { ("the new owner", OwnerB), ("a seat of farm A", CoOwner) })
        {
            var (_, root) = await PullAsync(user);
            IdsOf(root, "scheduleTemplates").Should().Contain(own, $"{who}: the followed extra bypasses the viewer (R-c9)");
            ArrayOf(root, "scheduleSubscriptions").Should().Contain(s => s.GetProperty("scheduleTemplateId").GetGuid() == own, who);
        }

        // (3) but it is not the new owner's: his library does not list it, and he cannot adopt it afresh, switch to it or change it.
        (await LibraryAsync(OwnerB)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(own);
        var (plot2, cycle2) = await SeedSeasonAsync("Grapes");
        var afresh = await AdoptAsync(OwnerB, FarmA, plot2, cycle2, own);
        afresh.Status.Should().Be(HttpStatusCode.NotFound, afresh.Body);
        ErrorCode(afresh.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await AdoptAsync(OwnerB, FarmA, plot2, cycle2, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK, "not vacuous: the new owner adopts on the farm he now owns");
        var switched = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot2}/cycles/{cycle2}/schedule/migrate", OwnerB,
            new { farmId = FarmA, newScheduleTemplateId = own, reason = "BetterFit" });
        switched.Status.Should().Be(HttpStatusCode.NotFound, switched.Body);
        (await MarksOfPlotAsync(plot2)).Should().ContainSingle().Which.Template.Should().Be(BuiltInGrapes);
        var editByNewOwner = await EditAsync(OwnerB, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks());
        editByNewOwner.Status.Should().Be(HttpStatusCode.NotFound, "not visible to him (E4)");

        // (4) the old owner keeps his library: naming farm A (no longer his) is refused; naming farm C (still his) writes the next version; PlotC follows it.
        (await EditAsync(Owner, own, FarmA, Guid.NewGuid(), stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Forbidden);
        var onC = Guid.NewGuid();
        (await EditAsync(Owner, own, FarmC, onC, stages: SomeStages(), activities: SomeWorks())).Status.Should().Be(HttpStatusCode.Created);
        (await RowAsync(onC))!.OwnerUser.Should().Be(Owner);
        (await LibraryAsync(Owner)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(new[] { own, onC });
        (await AdoptAsync(Owner, FarmC, PlotC, CycleC, own)).Status.Should().Be(HttpStatusCode.OK);

        // Nothing else was written.
        (await TemplateRowCountAsync()).Should().Be(rowsBefore + 1, "only the version written naming farm C");
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.Should().Be(new Marks("Own", null, 0, 0, own));
    }

    // ── fix round 1 (review P001): a followed extra is the SAME entry the full mapping gives for that id ──

    /// <summary>A thin Public sample of Grapes (no stored days): its stage and the offsets of its works feed the crop's equal split.</summary>
    private async Task<Guid> SeedThinSampleAsync(string name, string stage, params int[] offsets)
    {
        var id = Guid.NewGuid();
        await using var db = NewSuperuserContext();
        var thin = ScheduleTemplate.Create(id, name, stage, DateTime.UtcNow);
        foreach (var offset in offsets)
        {
            thin.AddActivity(Guid.NewGuid(), "Drip Irrigation", offset, FrequencyMode.EveryNDays, 3);
        }

        db.ScheduleTemplates.Add(thin);
        await db.SaveChangesAsync();
        return id;
    }

    private static string ShapeOf(JsonElement entry) =>
        string.Join("|", new[] { "stages", "totalDays", "activities", "hasStoredDays" }.Select(p => $"{p}={entry.GetProperty(p).GetRawText()}"))
        + "|check=" + entry.GetProperty("check").GetProperty("state").GetString();

    [Fact]
    public async Task A_followed_thin_sample_the_listing_stops_offering_arrives_in_the_pull_with_the_stages_and_totalDays_it_was_listed_with()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var postPruning = await SeedThinSampleAsync("Grapes - Post Pruning", "Pruning", 0, 7);
        var flowering = await SeedThinSampleAsync("Grapes - Flowering", "Flowering", 90);

        // Listed and adopted over the whole library: the equal split spans BOTH thin rows of the crop (two stages, 120 days).
        var listed = (await ListedAsync(Owner, postPruning))!.Value;
        listed.GetProperty("stages").GetArrayLength().Should().Be(2, "not vacuous: the thin split of the crop holds two stages");
        listed.GetProperty("totalDays").GetInt32().Should().Be(120);
        var shapeBefore = ShapeOf(listed);
        (await AdoptAsync(Owner, FarmA, PlotA, CycleA, postPruning)).Status.Should().Be(HttpStatusCode.OK);

        // A Checked Grapes schedule appears: the listing stops offering both samples for a new choice.
        await CheckedGrapeScheduleAsync();
        (await LibraryAsync(Owner)).Select(t => t.GetProperty("id").GetGuid()).Should().NotContain(new[] { postPruning, flowering });

        // The pull still carries the followed sample - as the SAME entry (stages, totalDays, works, check), not one re-split over itself alone.
        var (_, root) = await PullAsync(Owner);
        var extra = RowOf(ArrayOf(root, "scheduleTemplates"), postPruning);
        extra.Should().NotBeNull("a plot that follows a sample keeps it (R7)");
        ShapeOf(extra!.Value).Should().Be(shapeBefore, "P001: the visibility filter may change who receives a row, never the input to the mapping");
        IdsOf(root, "scheduleTemplates").Should().NotContain(flowering, "only the followed id is added");
    }

    // ── fix round 1 (review P003): the owner comparison in Classify is the only wall on this path ──

    [Fact]
    public async Task A_person_with_a_seat_on_the_owners_farm_A_who_can_adopt_on_OwnerBs_farm_B_cannot_follow_the_owners_own_schedule_on_a_plot_of_B()
    {
        await AssertAppRoleIsNotVacuousAsync();
        // CoOwner works on Owner's farm A (so the Team rule shows him Owner's own chain) AND may plan work on OwnerB's farm B.
        await SeedSeatAsync(FarmB, CoOwner, "SecondaryOwner", FarmAuthority.PlanWork);
        var own = await SeedOwnWithDaysAsync(Owner, Owner);
        (await LibraryAsync(CoOwner)).Select(t => t.GetProperty("id").GetGuid()).Should().Contain(own, "not vacuous: he SEES the owner's own schedule through farm A");
        var (plotOnB, cycleOnB) = await SeedSeasonAsync("Grapes", FarmB);
        var rowsBefore = await TemplateRowCountAsync();
        var auditBefore = await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ScheduleSubscription'");

        var rest = await AdoptAsync(CoOwner, FarmB, plotOnB, cycleOnB, own);
        var pushed = await PushAsync(CoOwner, "adopt_schedule", "sownc-p003", Adopt(FarmB, plotOnB, cycleOnB, own, CoOwner));

        rest.Status.Should().Be(HttpStatusCode.NotFound, rest.Body);
        ErrorCode(rest.Body).Should().Be("ShramSafal.ScheduleTemplateNotFound", "the row is Owner's, the plot's farm is OwnerB's: not followable there (Classify)");
        pushed.Status.Should().Be("failed");
        pushed.ErrorCode.Should().Be("ShramSafal.ScheduleTemplateNotFound");
        (await SubscriptionsAsync()).Should().BeEmpty("nothing was followed");
        (await MarksOfPlotAsync(plotOnB)).Should().BeEmpty();
        (await TemplateRowCountAsync()).Should().Be(rowsBefore);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ScheduleSubscription'")).Should().Be(auditBefore, "and no audit row");

        // Not vacuous: the same person adopts a sample on farm B, and adopts the owner's own schedule on a plot of farm A (Owner's own farm).
        (await AdoptAsync(CoOwner, FarmB, plotOnB, cycleOnB, BuiltInGrapes)).Status.Should().Be(HttpStatusCode.OK, "he may adopt on farm B");
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.PlanWork);
        (await AdoptAsync(CoOwner, FarmA, PlotA, CycleA, own)).Status.Should().Be(HttpStatusCode.OK, "and the owner's own schedule is followable on the owner's own farm");
        (await MarksOfPlotAsync(PlotA)).Should().ContainSingle().Which.Origin.Should().Be("Own");
    }
}
