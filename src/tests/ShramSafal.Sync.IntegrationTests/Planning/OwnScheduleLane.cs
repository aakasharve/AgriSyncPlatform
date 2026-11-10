// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-OWN ("his own schedule", server half; founder D-74, D-82 = 3, D-88) and lane SCH-OWN-c
// (a schedule belongs to the PERSON - owner_user_id; made-for tags; founder D-133 withdrawn, D-136, D-137).
//
// What the SCH-OWN real-Postgres suites share: the seeded farm and library (ScheduleCheckLane), the four doors of a person's own schedule (make it
// empty, copy a checked schedule into it, write its next version, publish it) as REST calls signed in with the account's real global role in the
// token, the same three as sync pushes, a second farm of the same owner, extra seats, and raw reads of what ssf.schedule_templates really holds.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class OwnScheduleLane(ITestOutputHelper output) : ScheduleCheckLane(output)
{
    /// <summary>A second farm of farm A's owner (Owner owns both), made on first use.</summary>
    protected static readonly Guid FarmC = Guid.Parse("3d030000-0000-4000-8000-0000000000c1");
    protected static readonly Guid PlotC = Guid.Parse("3d030000-0000-4000-8000-0000000000c3");
    protected static readonly Guid CycleC = Guid.Parse("3d030000-0000-4000-8000-0000000000c4");

    /// <summary>The global role each person's real token carries (the schedule-template author rule still reads it for a schedule that names no farm).</summary>
    protected static string GlobalRoleOf(Guid user) =>
        user == Owner || user == OwnerB || user == PlatformOwner ? "PrimaryOwner"
        : user == CoOwner ? "SecondaryOwner"
        : user == Mukadam ? "Mukadam"
        : "Worker";

    // ── the doors, as REST ──

    protected Task<(HttpStatusCode Status, string Body)> CreateAsync(
        Guid user, Guid? farm, string crop, string name, Guid? id = null, string? commandId = null,
        string? variety = null, string? soilType = null, string? region = null, string? climate = null) =>
        SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates", user,
            new { scheduleTemplateId = id ?? Guid.NewGuid(), farmId = farm, cropKey = crop, name, clientCommandId = commandId, variety, soilType, region, climate },
            GlobalRoleOf(user));

    protected Task<(HttpStatusCode Status, string Body)> CloneIntoOwnAsync(
        Guid user, Guid source, Guid? farm, Guid newId, string? commandId = null, TenantScope scope = TenantScope.Team) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone{FarmQuery(farm)}", user,
            new { newId, newScope = (int)scope, reason = "माझं शेड्यूल", intoFarmOwn = true, clientCommandId = commandId }, GlobalRoleOf(user));

    protected Task<(HttpStatusCode Status, string Body)> ClonePlainAsync(
        Guid user, Guid source, Guid? farm, Guid newId, TenantScope scope = TenantScope.Private) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/clone{FarmQuery(farm)}", user,
            new { newId, newScope = (int)scope, reason = "माझ्या प्लॉटसाठी" }, GlobalRoleOf(user));

    protected Task<(HttpStatusCode Status, string Body)> EditAsync(
        Guid user, Guid source, Guid? farm, Guid newId, string? name = null, object? stages = null, object? activities = null, string? commandId = null,
        string? variety = null, string? soilType = null, string? region = null, string? climate = null) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{source}/edit{FarmQuery(farm)}", user,
            new { newId, newName = name, stages, activities, clientCommandId = commandId, variety, soilType, region, climate }, GlobalRoleOf(user));

    protected Task<(HttpStatusCode Status, string Body)> PublishAsync(Guid user, Guid template, Guid? farm) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{template}/publish{FarmQuery(farm)}", user, new { }, GlobalRoleOf(user));

    private static string FarmQuery(Guid? farm) => farm is { } f ? $"?farmId={f}" : string.Empty;

    /// <summary>Three stages (0-20, 21-60, 61-120) as the phone sends them.</summary>
    protected static object[] SomeStages() =>
    [
        new { name = "Pruning", startDay = 0, endDay = 20 },
        new { name = "Growth", startDay = 21, endDay = 60 },
        new { name = "Berry", startDay = 61, endDay = 120 },
    ];

    protected static object Work(
        string name, string part = "irrigation", int start = 0, int end = 10, string mode = "every_n_days", int interval = 3, string? operationKey = null) =>
        new { name, part, operationKey, startDay = start, endDay = end, frequencyMode = mode, intervalDays = interval };

    protected static object[] SomeWorks() =>
    [
        Work("ठिबक सिंचन", "irrigation", 0, 20, "every_n_days", 3),
        Work("बुरशीनाशक फवारणी", "spray", 21, 60, "every_n_days", 14),
    ];

    // ── seeds ──

    private bool _reviewSeatsEnsured;

    /// <summary>The platform seats of the check, seeded once per test (a second seeding would collide on the same users).</summary>
    protected async Task EnsureReviewSeatsAsync()
    {
        if (!_reviewSeatsEnsured)
        {
            _reviewSeatsEnsured = true;
            await SeedReviewSeatsAsync();
        }
    }

    /// <summary>The first CHECKED schedule for Grapes (Institution), Approved by the platform owner.</summary>
    protected async Task<ScheduleTemplate> CheckedGrapeScheduleAsync(string name = "Grapes - University Schedule")
    {
        await EnsureReviewSeatsAsync();
        var row = await SeedStoredRowAsync(name);
        var approved = await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row));
        approved.Status.Should().Be(HttpStatusCode.OK, approved.Body);
        return row;
    }

    /// <summary>A CHECKED schedule of another crop (an Institution import, Approved by the platform owner).</summary>
    protected async Task<ScheduleTemplate> CheckedScheduleOfCropAsync(string cropKey, string name)
    {
        await EnsureReviewSeatsAsync();
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), name, ScheduleOwnerType.Institution, "Test University recommendation", cropKey,
            new AgriSync.SharedKernel.Contracts.Ids.UserId(PlatformOwner), TenantScope.Public, DateTime.UtcNow, UnequalStages,
            [
                new ImportedActivity("a", "Pruning", 0, 1, FrequencyMode.OneTime, 1),
                new ImportedActivity("b", "Drip Irrigation", 41, 99, FrequencyMode.PerWeek, 2),
            ],
            out var problem);
        problem.Should().BeNull();
        await using (var db = NewSuperuserContext())
        {
            db.ScheduleTemplates.Add(template!);
            await db.SaveChangesAsync();
        }

        var approved = await CheckAsync(PlatformOwner, template!.Id, "Approved", ActivityIdsOf(template));
        approved.Status.Should().Be(HttpStatusCode.OK, approved.Body);
        return template;
    }

    /// <summary>A person's own schedule (empty), through the production domain: Team, version 1, owned by <paramref name="owner"/>, typed by <paramref name="maker"/>.</summary>
    protected async Task<Guid> SeedOwnEmptyAsync(Guid owner, Guid maker, string name = "माझं द्राक्ष शेड्यूल", string crop = "Grapes", ScheduleMadeFor? madeFor = null)
    {
        var id = Guid.NewGuid();
        await using var db = NewSuperuserContext();
        db.ScheduleTemplates.Add(ScheduleTemplate.CreateOwn(
            id, name, crop, new AgriSync.SharedKernel.Contracts.Ids.UserId(owner), new AgriSync.SharedKernel.Contracts.Ids.UserId(maker), DateTime.UtcNow, madeFor));
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>A person's own schedule that STORES its days (the next version of an empty one), through the production domain.</summary>
    protected async Task<Guid> SeedOwnWithDaysAsync(Guid owner, Guid maker, string name = "माझं द्राक्ष शेड्यूल")
    {
        var v1 = await SeedOwnEmptyAsync(owner, maker, name);
        await using var db = NewSuperuserContext();
        var first = await db.ScheduleTemplates.FindAsync(v1);
        var v2 = first!.EditCopyOnWrite(
            Guid.NewGuid(), null, null,
            [new("Pruning", 0, 20), new("Growth", 21, 60)],
            [new("ठिबक सिंचन", "irrigation", null, 0, 20, FrequencyMode.EveryNDays, 3)],
            new AgriSync.SharedKernel.Contracts.Ids.UserId(maker), DateTime.UtcNow, out var problem);
        problem.Should().BeNull();
        db.ScheduleTemplates.Add(v2!);
        await db.SaveChangesAsync();
        return v2!.Id;
    }

    /// <summary>The owner's second farm (FarmC) with a Grapes plot, his seat and the account behind it.</summary>
    protected async Task SeedSecondFarmOfOwnerAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@farmC, 'SCH-OWN शेत C', @owner, @accountA, NOW(), NOW(), 3.0, 'Unchecked');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farmC, @owner, 'PrimaryOwner', NOW() - INTERVAL '30 days', NOW(), @accountA, 3, NULL, FALSE);
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plotC, @farmC, 'प्लॉट C', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleC, @farmC, @plotC, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """, ("farmC", FarmC), ("owner", Owner), ("accountA", AccountA), ("plotC", PlotC), ("cycleC", CycleC));
    }

    /// <summary>An Active seat of <paramref name="user"/> on <paramref name="farm"/> with exactly these authorities.</summary>
    protected async Task SeedSeatAsync(Guid farm, Guid user, string role, params FarmAuthority[] authorities)
    {
        var account = farm == FarmB ? AccountB : AccountA;
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @user, @role, NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            """, ("farm", farm), ("user", user), ("role", role), ("account", account));
        await SetAuthoritiesAsync(farm, user, authorities);
    }

    // ── what the table really holds ──

    /// <summary>One row of <c>ssf.schedule_templates</c> as the table really holds it (SCH-OWN-c: <c>OwnerUser</c> = owner_user_id, the four made-for tags).</summary>
    protected sealed record TemplateRow(
        Guid? OwnerUser, int Scope, int Version, Guid? CreatedBy, Guid? Previous, Guid? Derived, string Name, string? CropKey, string? OwnerType,
        string Stage, long Activities, long Stages, DateTime? PublishedAt, string? Variety, string? SoilType, string? Region, string? Climate);

    protected async Task<TemplateRow?> RowAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT t.owner_user_id, t.tenant_scope, t.version, t.created_by_user_id, t.previous_version_id, t.derived_from_template_id, t.name,
                   t.crop_key, t.owner_type, t.stage,
                   (SELECT count(*) FROM ssf.template_activities a WHERE a.schedule_template_id = t."Id"),
                   (SELECT count(*) FROM ssf.schedule_template_stages s WHERE s.schedule_template_id = t."Id"),
                   t.published_at_utc, t.variety, t.soil_type, t.region_code, t.climate
            FROM ssf.schedule_templates t WHERE t."Id" = @id
            """;
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new TemplateRow(
            reader.IsDBNull(0) ? null : reader.GetGuid(0), reader.GetInt32(1), reader.GetInt32(2),
            reader.IsDBNull(3) ? null : reader.GetGuid(3), reader.IsDBNull(4) ? null : reader.GetGuid(4),
            reader.IsDBNull(5) ? null : reader.GetGuid(5), reader.GetString(6),
            reader.IsDBNull(7) ? null : reader.GetString(7), reader.IsDBNull(8) ? null : reader.GetString(8),
            reader.GetString(9), reader.GetInt64(10), reader.GetInt64(11), reader.IsDBNull(12) ? null : reader.GetDateTime(12),
            reader.IsDBNull(13) ? null : reader.GetString(13), reader.IsDBNull(14) ? null : reader.GetString(14),
            reader.IsDBNull(15) ? null : reader.GetString(15), reader.IsDBNull(16) ? null : reader.GetString(16));
    }

    protected Task<long> TemplateRowCountAsync() => CountAsync("SELECT count(*) FROM ssf.schedule_templates");

    /// <summary>How many rows are <paramref name="owner"/>'s own (owner_user_id).</summary>
    protected Task<long> OwnRowCountAsync(Guid owner) =>
        CountAsync("SELECT count(*) FROM ssf.schedule_templates WHERE owner_user_id = @o", ("o", owner));

    protected Task<long> ChecksOfAsync(Guid template) =>
        CountAsync("SELECT count(*) FROM ssf.schedule_checks WHERE schedule_template_id = @t", ("t", template));

    protected static Guid IdOf(string body, string property) => Json(body).GetProperty(property).GetGuid();

    /// <summary>The library the phone is sent, one row by id (or null).</summary>
    protected async Task<System.Text.Json.JsonElement?> ListedAsync(Guid user, Guid id) => RowOf(await LibraryAsync(user), id);
}
