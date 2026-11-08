// spec: plr-d10-redesign-real-integration-2026-10-25 - lane SCH-A ("a schedule ShramSafal has checked, day by day").
//
// What the three SCH-A real-Postgres suites share: the seeded farm and library of L8b-1 (ScheduleLaneFarm), plus a schedule
// row that STORES its days (written through the production domain, ScheduleTemplate.Import), the platform seats of the
// check (Owner / Employee / Analyst of a Platform organisation), the other seats that must be refused, and raw reads of
// ssf.schedule_checks as superuser (what is really kept).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class ScheduleCheckLane(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    // Fake numbers only (600000xxxx).
    protected static readonly Guid PlatformOwner = Guid.Parse("5c4a0000-0000-4000-8000-000000000001");
    protected static readonly Guid PlatformEmployee = Guid.Parse("5c4a0000-0000-4000-8000-000000000002");
    protected static readonly Guid PlatformAnalyst = Guid.Parse("5c4a0000-0000-4000-8000-000000000003");
    protected static readonly Guid FpoOwner = Guid.Parse("5c4a0000-0000-4000-8000-000000000004");
    protected static readonly Guid AgronomistSeat = Guid.Parse("5c4a0000-0000-4000-8000-000000000005");
    protected static readonly Guid PlatformAuditor = Guid.Parse("5c4a0000-0000-4000-8000-000000000006");

    protected const string DisplayName = "श्रमसफल कृषी तज्ज्ञ चाचणी";

    private bool _reviewSeatsSeeded;

    /// <summary>
    /// spec: plr-d10 lane L8b-1F (D-82 note) - a schedule row still WAITING for its check is never listed to a farm caller; the library
    /// as the platform reviewer lists it (every row with its state). The reviewer seats are seeded on first use.
    /// </summary>
    protected async Task<IReadOnlyList<JsonElement>> ReviewLibraryAsync()
    {
        if (!_reviewSeatsSeeded)
        {
            await SeedReviewSeatsAsync();
        }

        return await LibraryAsync(PlatformOwner);
    }

    /// <summary>Platform Owner, Employee, Analyst and Auditor seats, an FPO owner, and a farm seat with AppRole.Agronomist.</summary>
    protected async Task SeedReviewSeatsAsync()
    {
        _reviewSeatsSeeded = true;
        await SeedPlatformOwnerAsync(PlatformOwner, Guid.NewGuid(), orgType: 0, role: 0, phone: "6000000001");
        await SeedPlatformOwnerAsync(PlatformEmployee, Guid.NewGuid(), orgType: 0, role: 2, phone: "6000000002");
        await SeedPlatformOwnerAsync(PlatformAnalyst, Guid.NewGuid(), orgType: 0, role: 1, phone: "6000000003");
        await SeedPlatformOwnerAsync(FpoOwner, Guid.NewGuid(), orgType: 1, role: 0, phone: "6000000004");
        await SeedPlatformOwnerAsync(PlatformAuditor, Guid.NewGuid(), orgType: 0, role: 3, phone: "6000000006");
        await ExecOnSuperuserAsync("""
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc,
                                      created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@user, '6000000005', 'agronomist-seat', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status,
                                              permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @user, 'Agronomist', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            """, ("user", AgronomistSeat), ("farm", FarmA), ("account", AccountA));
    }

    protected static readonly StageDefinition[] UnequalStages =
    [
        new("Post Pruning", 0, 12),
        new("Canopy Build", 13, 40),
        new("Berry Development", 41, 99),
    ];

    /// <summary>A Public schedule row that STORES its days, made through the production import rule (stages 0-12, 13-40, 41-99).</summary>
    protected async Task<ScheduleTemplate> SeedStoredRowAsync(
        string name = "Grapes - University Schedule", TenantScope scope = TenantScope.Public, Guid? maker = null,
        IReadOnlyList<ImportedActivity>? activities = null)
    {
        var template = ScheduleTemplate.Import(
            Guid.NewGuid(), name, ScheduleOwnerType.Institution, "Test University recommendation", "grape",
            new UserId(maker ?? PlatformOwner), scope, DateTime.UtcNow, UnequalStages,
            activities ??
            [
                new ImportedActivity("cut", "Pruning", 0, 1, FrequencyMode.OneTime, 1),
                new ImportedActivity("paste", "Paste", 2, 3, FrequencyMode.OneTime, 1, "cut"),
                new ImportedActivity("spray", "बुरशीनाशक फवारणी", 18, 40, FrequencyMode.EveryNDays, 7),
                new ImportedActivity("drip", "Drip Irrigation", 41, 99, FrequencyMode.PerWeek, 2),
            ],
            out var problem);
        problem.Should().BeNull();
        await using var db = NewSuperuserContext();
        db.ScheduleTemplates.Add(template!);
        await db.SaveChangesAsync();
        return template!;
    }

    protected static IReadOnlyList<Guid> ActivityIdsOf(ScheduleTemplate t) => t.Activities.Select(a => a.Id).ToList();

    protected Task<(HttpStatusCode Status, string Body)> CheckAsync(
        Guid user, Guid template, string decision, IEnumerable<Guid>? ticked = null, string? note = null, string? display = DisplayName) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{template}/check", user, new
        {
            decision,
            checkedActivityIds = ticked?.ToArray() ?? [],
            note,
            checkerDisplayName = display,
        });

    protected sealed record CheckRow(Guid Template, int Version, string Decision, Guid[] Ticked, string? Note, Guid Checker, string Display);

    protected async Task<List<CheckRow>> ChecksAsync(Guid? template = null)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT schedule_template_id, template_version, decision, checked_activity_ids, note, checker_user_id, checker_display_name
            FROM ssf.schedule_checks WHERE (@t::uuid IS NULL OR schedule_template_id = @t) ORDER BY checked_at_utc, id
            """;
        cmd.Parameters.AddWithValue("t", (object?)template ?? DBNull.Value);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<CheckRow>();
        while (await reader.ReadAsync())
        {
            rows.Add(new CheckRow(
                reader.GetGuid(0), reader.GetInt32(1), reader.GetString(2), (Guid[])reader.GetValue(3),
                reader.IsDBNull(4) ? null : reader.GetString(4), reader.GetGuid(5), reader.GetString(6)));
        }

        return rows;
    }

    protected static JsonElement? RowOf(IReadOnlyList<JsonElement> library, Guid id) =>
        library.Where(e => e.GetProperty("id").GetGuid() == id).Select(e => (JsonElement?)e).FirstOrDefault();

    /// <summary>When <c>SCHA_P11_BODIES</c> names a folder, the library body this server sent is kept there (the P11 run's input).</summary>
    protected static void KeepP11Body(string who, string body)
    {
        var folder = Environment.GetEnvironmentVariable("SCHA_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            Directory.CreateDirectory(folder);
            File.WriteAllText(Path.Combine(folder, $"{who}.json"), body);
        }
    }
}
