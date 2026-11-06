// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8b-1 ("the schedule he sees is the schedule the server keeps").
//
// The one seeded farm (RoleScopedFarm: owner, सहमालक, मुकादम, two कामगार, a paused seat, a second farm) plus what the
// schedule suites need: the library the phone lists (GET /shramsafal/reference/schedule-templates, the SAME read the pull
// sends), schedule rows written through the production EF model, plots and crop seasons with any crop name, and raw reads
// of ssf.schedule_subscriptions / ssf.schedule_migration_events as superuser (what is really kept).
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
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class ScheduleLaneFarm(ITestOutputHelper output) : RoleScopedFarm(output)
{
    /// <summary>The built-in library's ids (ReferenceDataCatalog): what the phone lists while the farm has no rows.</summary>
    protected static readonly Guid BuiltInGrapes = Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77301");
    protected static readonly Guid BuiltInPomegranate = Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77302");
    protected static readonly Guid BuiltInSugarcane = Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77303");
    protected static readonly Guid BuiltInOnion = Guid.Parse("f3b8b9aa-0a53-4f7b-84a7-6ba6f1f77304");

    /// <summary>A season of a crop on its own plot of farm A (the base farm's one season is "Grapes" on प्लॉट A).</summary>
    protected async Task<(Guid Plot, Guid Cycle)> SeedSeasonAsync(string cropName, Guid? farmId = null)
    {
        var farm = farmId ?? FarmA;
        var plot = Guid.NewGuid();
        var cycle = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot, @farm, 'L8b-1 प्लॉट', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycle, @farm, @plot, @crop, 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """, ("plot", plot), ("farm", farm), ("cycle", cycle), ("crop", cropName));
        return (plot, cycle);
    }

    /// <summary>A schedule ROW (ssf.schedule_templates) through the production model: the library then lists rows only.</summary>
    protected async Task<Guid> SeedTemplateRowAsync(string name, TenantScope scope = TenantScope.Public, Guid? author = null)
    {
        var id = Guid.NewGuid();
        await using var db = NewSuperuserContext();
        var template = ScheduleTemplate.Create(
            id, name, "Pruning", DateTime.UtcNow,
            createdByUserId: author is { } a ? new UserId(a) : null,
            tenantScope: scope);
        template.AddActivity(Guid.NewGuid(), "Drip Irrigation", 0, FrequencyMode.EveryNDays, 3);
        template.AddActivity(Guid.NewGuid(), "Powdery Mildew Spray", 7, FrequencyMode.EveryNDays, 14);
        db.ScheduleTemplates.Add(template);
        await db.SaveChangesAsync();
        return id;
    }

    /// <summary>The library exactly as the phone receives it.</summary>
    protected async Task<IReadOnlyList<JsonElement>> LibraryAsync(Guid user)
    {
        var (status, body) = await SendJsonAsync(HttpMethod.Get, "/shramsafal/reference/schedule-templates", user, null);
        status.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.Clone().EnumerateArray().ToList();
    }

    protected Task<(HttpStatusCode Status, string Body)> AdoptAsync(Guid user, Guid farm, Guid plot, Guid cycle, Guid template) =>
        SendJsonAsync(HttpMethod.Post, $"/shramsafal/plots/{plot}/cycles/{cycle}/schedule/adopt", user,
            new { farmId = farm, scheduleTemplateId = template });

    protected async Task<(HttpStatusCode Status, string Body)> SendJsonAsync(HttpMethod method, string url, Guid user, object? body)
    {
        using var response = await SendAsync(method, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[L8b-1] {user} {method} {url} -> {(int)response.StatusCode} {(text.Length > 400 ? text[..400] + "…" : text)}");
        return (response.StatusCode, text);
    }

    protected static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    protected static string? ErrorCode(string body) =>
        string.IsNullOrWhiteSpace(body) ? null
            : Json(body).TryGetProperty("error", out var e) ? e.GetString() : null;

    protected sealed record SubscriptionRow(
        Guid Id, Guid Farm, Guid Plot, Guid Cycle, string CropKey, Guid Template, string VersionTag, int State,
        Guid? MigratedFrom, Guid? MigratedTo, DateOnly? ReferenceDate);

    /// <summary>
    /// What ssf.schedule_subscriptions really holds (superuser). <paramref name="withReferenceDate"/>: read the L8b-1 day-0
    /// column too (false while it may not exist: a red run against the code before this lane, or between Down and Up).
    /// </summary>
    protected async Task<List<SubscriptionRow>> SubscriptionsAsync(bool withReferenceDate = true)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            SELECT id, farm_id, plot_id, crop_cycle_id, crop_key, schedule_template_id, schedule_version_tag, state,
                   migrated_from_subscription_id, migrated_to_subscription_id, {(withReferenceDate ? "reference_date" : "NULL::date")}
            FROM ssf.schedule_subscriptions ORDER BY adopted_at_utc, id
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<SubscriptionRow>();
        while (await reader.ReadAsync())
        {
            rows.Add(new SubscriptionRow(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3), reader.GetString(4),
                reader.GetGuid(5), reader.GetString(6), reader.GetInt32(7),
                reader.IsDBNull(8) ? null : reader.GetGuid(8),
                reader.IsDBNull(9) ? null : reader.GetGuid(9),
                reader.IsDBNull(10) ? null : DateOnly.FromDateTime(reader.GetDateTime(10))));
        }

        return rows;
    }

    protected async Task<long> CountAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>The audit rows the schedule doors wrote (entity ScheduleSubscription), as (action, actor).</summary>
    protected async Task<List<(string Action, Guid Actor)>> ScheduleAuditAsync()
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT action, actor_user_id FROM ssf.audit_events
            WHERE entity_type = 'ScheduleSubscription' ORDER BY occurred_at_utc
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<(string, Guid)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetGuid(1)));
        }

        return rows;
    }

    /// <summary>The one shared crop ↔ schedule fixture (the phone's TemplateCatalog vitest reads the same file).</summary>
    protected static JsonDocument CropRuleFixture()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);
        while (current is not null)
        {
            var candidate = Path.Combine(current.FullName, "sync-contract", "tests", "fixtures", "crop-schedule-match.json");
            if (File.Exists(candidate))
            {
                return JsonDocument.Parse(File.ReadAllText(candidate));
            }

            current = current.Parent;
        }

        throw new FileNotFoundException("sync-contract/tests/fixtures/crop-schedule-match.json was not found above the test output.");
    }
}
