// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A Task 4 ("import" - a schedule with all its days).
//
// A ShramSafal platform reviewer loads a schedule with its stages and activities (POST /shramsafal/schedule-templates/import):
// the days are stored, listed exactly as stored, the owner type is INSTITUTION and the source label is kept; an end before its
// start or an activity outside every stage is refused with words; a farm member is refused (403). Round 3 (R34): an order
// between two once-only works imports and lists; an order to another row's activity, from a repeated work, or a loop is
// refused; an edit and a clone keep the order on the NEW activity ids; the role is proposed by WORK-ID at import and stored.
// Real Postgres as agrisync_app (E3 first), through the real host.
using System;
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
public sealed class ScheduleImportRealPostgresTests(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    private static object Stage(string name, int start, int end) => new { name, startDay = start, endDay = end };

    private static object Act(
        string key, string name, int start, int end, string mode = "one_time", int? interval = null,
        string? after = null, string? role = null) =>
        new { key, name, startDay = start, endDay = end, frequencyMode = mode, intervalDays = interval, afterKey = after, role };

    private static object Body(object[]? stages = null, object[]? activities = null, string name = "Grapes - University Schedule") => new
    {
        name,
        cropKey = "grape",
        ownerType = "INSTITUTION",
        sourceLabel = "Test University recommendation 2026",
        stages = stages ?? [Stage("Post Pruning", 0, 12), Stage("Canopy Build", 13, 40), Stage("Berry Development", 41, 99)],
        activities = activities ??
        [
            Act("cut", "Pruning", 0, 1),
            Act("spray", "बुरशीनाशक फवारणी", 18, 40, "every_n_days", 7),
            Act("drip", "Drip Irrigation", 41, 99, "per_week", 2),
        ],
    };

    private Task<(HttpStatusCode Status, string Body)> ImportAsync(Guid user, object body) =>
        SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import", user, body);

    [Fact]
    public async Task A_schedule_with_stages_and_activities_imports_and_lists_with_exactly_its_days()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var imported = await ImportAsync(PlatformOwner, Body());

        imported.Status.Should().Be(HttpStatusCode.Created, imported.Body);
        var result = Json(imported.Body);
        result.GetProperty("hasStoredDays").GetBoolean().Should().BeTrue();
        result.GetProperty("stageCount").GetInt32().Should().Be(3);
        result.GetProperty("activityCount").GetInt32().Should().Be(3);
        var id = result.GetProperty("templateId").GetGuid();

        var dto = RowOf(await ReviewLibraryAsync(), id)!.Value;
        dto.GetProperty("ownerType").GetString().Should().Be("INSTITUTION");
        dto.GetProperty("sourceLabel").GetString().Should().Be("Test University recommendation 2026");
        dto.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked", "an import checks nothing");
        dto.GetProperty("stages").EnumerateArray()
            .Select(s => (s.GetProperty("startDay").GetInt32(), s.GetProperty("endDay").GetInt32()))
            .Should().Equal((0, 12), (13, 40), (41, 99));
        var spray = dto.GetProperty("activities").EnumerateArray().Single(a => a.GetProperty("name").GetString() == "बुरशीनाशक फवारणी");
        (spray.GetProperty("startDay").GetInt32(), spray.GetProperty("endDay").GetInt32()).Should().Be((18, 40));
        spray.GetProperty("frequencyMode").GetString().Should().Be("every_n_days");
        spray.GetProperty("intervalDays").GetInt32().Should().Be(7);

        // The maker is the first version's maker: its owner (ScheduleViewer.OwnerOfAsync) is him, and it is in the waiting list.
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND created_by_user_id = @u AND tenant_scope = 3 AND version = 1",
            ("id", id), ("u", PlatformOwner))).Should().Be(1);
        var waiting = await SendJsonAsync(HttpMethod.Get, "/shramsafal/schedule-templates/checks/waiting", PlatformEmployee, null);
        Json(waiting.Body).EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).Should().Contain(id);
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'schedule.imported' AND entity_id = @id", ("id", id))).Should().Be(1);
    }

    [Fact]
    public async Task End_before_start_or_an_activity_outside_every_stage_is_refused_with_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var endBeforeStart = await ImportAsync(PlatformOwner, Body(activities: [Act("a", "Pruning", 10, 4)]));
        endBeforeStart.Status.Should().Be(HttpStatusCode.BadRequest, endBeforeStart.Body);
        ErrorCode(endBeforeStart.Body).Should().Be("ShramSafal.ScheduleImportActivityDays");
        Json(endBeforeStart.Body).GetProperty("message").GetString().Should().Contain("end day");

        var outside = await ImportAsync(PlatformOwner, Body(activities: [Act("a", "Pruning", 120, 121)]));
        outside.Status.Should().Be(HttpStatusCode.BadRequest, outside.Body);
        ErrorCode(outside.Body).Should().Be("ShramSafal.ScheduleImportOutsideStages");
        Json(outside.Body).GetProperty("message").GetString().Should().Contain("outside every stage");

        var stageBackwards = await ImportAsync(PlatformOwner, Body(stages: [Stage("Bad", 9, 3)], activities: [Act("a", "Pruning", 4, 5)]));
        stageBackwards.Status.Should().Be(HttpStatusCode.BadRequest);

        (await ImportAsync(PlatformOwner, Body(activities: [Act("a", "Pruning", 0, 1, "sometimes")]))).Status
            .Should().Be(HttpStatusCode.BadRequest);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(0, "a refused import stores nothing");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_template_stages")).Should().Be(0);
    }

    [Fact]
    public async Task A_farm_member_and_the_other_seats_cannot_import()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        foreach (var who in new[] { Owner, CoOwner, Mukadam, Worker, AgronomistSeat, FpoOwner, PlatformAnalyst })
        {
            var refused = await ImportAsync(who, Body());
            refused.Status.Should().Be(HttpStatusCode.Forbidden, $"{who}: {refused.Body}");
        }

        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(0);
        // The Employee seat, which holds the module's write, may.
        (await ImportAsync(PlatformEmployee, Body())).Status.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task An_order_between_two_once_only_works_imports_and_lists()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var imported = await ImportAsync(PlatformOwner, Body(activities:
        [
            Act("cut", "Pruning", 0, 1),
            Act("paste", "Paste", 2, 3, after: "cut"),
            Act("spray", "Foliar Spray", 18, 40, "every_n_days", 7),
        ]));

        imported.Status.Should().Be(HttpStatusCode.Created, imported.Body);
        var dto = RowOf(await ReviewLibraryAsync(), Json(imported.Body).GetProperty("templateId").GetGuid())!.Value;
        var byName = dto.GetProperty("activities").EnumerateArray().ToDictionary(a => a.GetProperty("name").GetString()!);
        byName["Pruning"].GetProperty("afterActivityId").ValueKind.Should().Be(JsonValueKind.Null);
        byName["Paste"].GetProperty("afterActivityId").GetGuid().Should().Be(byName["Pruning"].GetProperty("id").GetGuid(),
            "the server turns afterKey into the minted id of the work it follows");
        byName["Foliar Spray"].GetProperty("afterActivityId").ValueKind.Should().Be(JsonValueKind.Null, "no order stored, none listed (Review Focus 15)");
    }

    [Fact]
    public async Task An_order_to_another_rows_activity_or_from_a_repeated_work_or_a_loop_is_refused_with_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var cases = new (string Why, object[] Activities)[]
        {
            ("to another row's activity", [Act("a", "Pruning", 0, 1), Act("b", "Paste", 2, 3, after: Guid.NewGuid().ToString())]),
            ("to a key that is not in the request", [Act("b", "Paste", 2, 3, after: "ghost")]),
            ("from a repeated work", [Act("a", "Pruning", 0, 1), Act("b", "Foliar Spray", 18, 40, "every_n_days", 7, after: "a")]),
            ("to a repeated work", [Act("a", "Foliar Spray", 18, 40, "every_n_days", 7), Act("b", "Paste", 2, 3, after: "a")]),
            ("to itself", [Act("a", "Pruning", 0, 1, after: "a")]),
            ("in a loop", [Act("a", "Pruning", 0, 1, after: "b"), Act("b", "Paste", 2, 3, after: "a")]),
        };

        foreach (var (why, activities) in cases)
        {
            var refused = await ImportAsync(PlatformOwner, Body(activities: activities));
            refused.Status.Should().Be(HttpStatusCode.BadRequest, $"an order {why}: {refused.Body}");
            ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleImportOrder", why);
            Json(refused.Body).GetProperty("message").GetString().Should().NotBeNullOrWhiteSpace();
        }

        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(0);
    }

    [Fact]
    public async Task An_edit_keeps_the_order_on_the_new_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var imported = await ImportAsync(PlatformOwner, Body(activities:
            [Act("cut", "Pruning", 0, 1), Act("paste", "Paste", 2, 3, after: "cut")]));
        var source = Json(imported.Body).GetProperty("templateId").GetGuid();

        // A farmer's own (private) copy is edited through the route; the order must survive BOTH copies.
        var clone = Guid.NewGuid();
        var cloned = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone?farmId={FarmA}", Owner,
            new { newId = clone, newScope = (int)TenantScope.Private, reason = "माझ्या प्लॉटसाठी" });
        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);
        var edited = Guid.NewGuid();

        var edit = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{clone}/edit?farmId={FarmA}", Owner,
            new { newId = edited, newName = "Grapes - University Schedule v2" });

        edit.Status.Should().Be(HttpStatusCode.Created, edit.Body);
        await AssertOrderOnCopyAsync(clone, edited);
        (await CountAsync("SELECT version FROM ssf.schedule_templates WHERE \"Id\" = @e", ("e", edited))).Should().Be(2);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_template_stages WHERE schedule_template_id = @e", ("e", edited))).Should().Be(3);
    }

    [Fact]
    public async Task A_clone_remaps_the_order_to_the_new_activity_ids()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var imported = await ImportAsync(PlatformOwner, Body(activities:
            [Act("cut", "Pruning", 0, 1), Act("paste", "Paste", 2, 3, after: "cut")]));
        var source = Json(imported.Body).GetProperty("templateId").GetGuid();
        var clone = Guid.NewGuid();

        var cloned = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone?farmId={FarmA}", Owner,
            new { newId = clone, newScope = (int)TenantScope.Private, reason = "माझ्या प्लॉटसाठी" });

        cloned.Status.Should().Be(HttpStatusCode.Created, cloned.Body);
        await AssertOrderOnCopyAsync(source, clone);
        (await CountAsync("SELECT count(*) FROM ssf.schedule_template_stages WHERE schedule_template_id = @c", ("c", clone)))
            .Should().Be(3, "a copy carries the stored stages");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @c AND owner_type = 'User' AND crop_key = 'grape'", ("c", clone)))
            .Should().Be(1, "a farmer's copy is his own (USER) schedule for the same crop");
        (await ChecksAsync(clone)).Should().BeEmpty("a copy is never born checked");
    }

    private async Task AssertOrderOnCopyAsync(Guid source, Guid copy)
    {
        async Task<(Guid Cut, Guid Paste, Guid? After)> ReadAsync(Guid id)
        {
            await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
            await db.OpenAsync();
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "SELECT \"Id\", activity_name, after_activity_id FROM ssf.template_activities WHERE schedule_template_id = @t";
            cmd.Parameters.AddWithValue("t", id);
            await using var reader = await cmd.ExecuteReaderAsync();
            Guid cut = default, paste = default;
            Guid? after = null;
            while (await reader.ReadAsync())
            {
                if (reader.GetString(1) == "Pruning")
                {
                    cut = reader.GetGuid(0);
                }
                else
                {
                    paste = reader.GetGuid(0);
                    after = reader.IsDBNull(2) ? null : reader.GetGuid(2);
                }
            }

            return (cut, paste, after);
        }

        var old = await ReadAsync(source);
        var fresh = await ReadAsync(copy);

        old.After.Should().Be(old.Cut);
        fresh.After.Should().Be(fresh.Cut, "the order points at the NEW row's activity");
        fresh.Cut.Should().NotBe(old.Cut, "the copy mints new activity ids");
        fresh.After.Should().NotBe(old.Cut, "and never points back into the old row");
    }

    [Fact]
    public async Task Role_is_proposed_at_import_and_stored()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var imported = await ImportAsync(PlatformOwner, Body(activities:
        [
            Act("f", "बुरशीनाशक फवारणी", 18, 40, "every_n_days", 7),
            Act("b", "बोरॉन फवारणी", 20, 20),
            Act("n", "विद्राव्य खत 0:52:34 (ठिबकातून)", 41, 60, "per_week", 2),
            Act("i", "फवारणी", 22, 40, "every_n_days", 10, role: "insecticide"),
            Act("p", "Pruning", 0, 1),
        ]));
        imported.Status.Should().Be(HttpStatusCode.Created, imported.Body);
        var id = Json(imported.Body).GetProperty("templateId").GetGuid();

        // Stored in the table (not worked out at read time) ...
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND activity_name = 'बुरशीनाशक फवारणी' AND role = 'fungicide' AND part = 'Spray'", ("t", id))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND activity_name = 'बोरॉन फवारणी' AND role = 'nutrient' AND nutrient_key = 'boron'", ("t", id))).Should().Be(1);
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND role = 'nutrient' AND nutrient_key = 'npk-0-52-34'", ("t", id))).Should().Be(1);
        // ... a role the reviewer stated wins over the proposal ...
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND activity_name = 'फवारणी' AND role = 'insecticide'", ("t", id))).Should().Be(1);
        // ... and an unrecognised or role-less work stores none (never a guess).
        (await CountAsync("SELECT count(*) FROM ssf.template_activities WHERE schedule_template_id = @t AND activity_name = 'Pruning' AND role IS NULL AND operation_key LIKE 'op\\_%'", ("t", id))).Should().Be(1);

        // ... listed for the checker to tick with the row.
        var dto = RowOf(await ReviewLibraryAsync(), id)!.Value;
        var byName = dto.GetProperty("activities").EnumerateArray().ToDictionary(a => a.GetProperty("name").GetString()!);
        byName["बुरशीनाशक फवारणी"].GetProperty("role").GetString().Should().Be("fungicide");
        byName["बोरॉन फवारणी"].GetProperty("nutrientKey").GetString().Should().Be("boron");
        byName["बुरशीनाशक फवारणी"].GetProperty("part").GetString().Should().Be("Spray");
        byName["Pruning"].GetProperty("operationKey").GetString().Should().StartWith("op_");

        var badRole = await ImportAsync(PlatformOwner, Body(activities: [Act("a", "फवारणी", 18, 40, "every_n_days", 7, role: "weedkiller")]));
        badRole.Status.Should().Be(HttpStatusCode.BadRequest);
        ErrorCode(badRole.Body).Should().Be("ShramSafal.ScheduleImportRole");
    }

    [Fact]
    public async Task The_library_dto_carries_activity_ids_and_null_stored_frequency_for_thin_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var thin = await SeedTemplateRowAsync("Grapes - thin row");
        var stored = await SeedStoredRowAsync();
        var library = await ReviewLibraryAsync();

        foreach (var activity in RowOf(library, stored.Id)!.Value.GetProperty("activities").EnumerateArray())
        {
            activity.GetProperty("id").GetGuid().Should().NotBeEmpty();
            activity.GetProperty("storedFrequencyMode").GetString().Should().NotBeNullOrEmpty();
            activity.GetProperty("part").GetString().Should().NotBeNullOrEmpty();
        }

        foreach (var activity in RowOf(library, thin)!.Value.GetProperty("activities").EnumerateArray())
        {
            activity.GetProperty("id").ValueKind.Should().Be(JsonValueKind.Null, "a thin row's activities are not addressable");
            activity.GetProperty("storedFrequencyMode").ValueKind.Should().Be(JsonValueKind.Null,
                "null when not stored, so a reader never mistakes the in-memory OneTime default for a stored one");
            activity.GetProperty("part").ValueKind.Should().Be(JsonValueKind.Null);
            activity.GetProperty("afterActivityId").ValueKind.Should().Be(JsonValueKind.Null);
        }

        // The built-in sample is a library of its own (no rows -> no row fields at all).
    }

    [Fact]
    public async Task An_imported_grape_schedule_lists_under_the_same_crop_type_as_the_thin_grape_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();
        var thin = await SeedTemplateRowAsync("Grapes - thin grape row");

        var imported = await ImportAsync(PlatformOwner, Body());
        imported.Status.Should().Be(HttpStatusCode.Created, imported.Body);
        var id = Json(imported.Body).GetProperty("templateId").GetGuid();

        var library = await ReviewLibraryAsync();
        var thinType = RowOf(library, thin)!.Value.GetProperty("cropType").GetString();
        var storedType = RowOf(library, id)!.Value.GetProperty("cropType").GetString();
        thinType.Should().Be("Grapes");
        storedType.Should().Be(thinType, "the phone files both under the crop a plot has, never under the raw key");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND crop_key = 'grape'", ("id", id)))
            .Should().Be(1, "crop_key stays stored as given");
    }

    [Fact]
    public async Task An_unknown_crop_key_is_refused_with_words()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReviewSeatsAsync();

        var refused = await ImportAsync(PlatformOwner, new
        {
            name = "Nothing - Schedule",
            cropKey = "zzz-not-a-crop",
            ownerType = "INSTITUTION",
            stages = new[] { Stage("S", 0, 10) },
            activities = new[] { Act("a", "Pruning", 0, 1) },
        });

        refused.Status.Should().Be(HttpStatusCode.BadRequest, refused.Body);
        ErrorCode(refused.Body).Should().Be("ShramSafal.ScheduleImportCrop");
        Json(refused.Body).GetProperty("message").GetString().Should().Contain("zzz-not-a-crop");
        (await CountAsync("SELECT count(*) FROM ssf.schedule_templates")).Should().Be(0);
    }

    [Fact]
    public async Task The_builtin_sample_is_unchecked_and_carries_no_row_fields()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var library = await LibraryAsync(Owner);

        library.Should().NotBeEmpty();
        foreach (var template in library)
        {
            // L8b-1F: every sample says so in words (NotChecked), no longer by an absent object.
            template.GetProperty("check").GetProperty("state").GetString().Should().Be("NotChecked", "a built-in sample was never checked");
            template.GetProperty("ownerType").ValueKind.Should().Be(JsonValueKind.Null);
            template.GetProperty("hasStoredDays").ValueKind.Should().Be(JsonValueKind.Null);
        }
    }
}
