// spec: plr-d10-redesign-real-integration-2026-10-25 - lane REM-1 (founder D-78, D-79, D-84 = 1).
//
// What the reminder suites share, on top of the planned-work lane: the owner's settings routes, a spoken reminder made through the real
// log save (its id is the same every time), a log hidden "फक्त मी", raw reads of what the settings tables really keep, and the audit rows.
// Fake phone numbers only (the base farm's 93000000xx).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class ReminderLane(ITestOutputHelper output) : PlannedWorkLane(output)
{
    protected const string Day = "2026-11-08";
    protected const string SpokenTitle = "पाईप बघायचा";

    /// <summary>The P11 run's input: when <c>REM1_P11_BODIES</c> names a folder, the bodies this server sent are kept there.</summary>
    protected static void Keep(string name, string body)
    {
        var folder = Environment.GetEnvironmentVariable("REM1_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, $"{name}.json"), body);
        }
    }

    protected string SettingsUrl(Guid? farm = null) => $"/shramsafal/farms/{farm ?? FarmA}/reminder-settings";

    protected string MarkUrl(Guid person, Guid? farm = null) => $"{SettingsUrl(farm)}/always-show/{person}";

    /// <summary>PUT /reminder-settings with the named choices.</summary>
    protected async Task<(HttpStatusCode Status, string Body)> PutSettingsAsync(
        Guid user, string? log = null, string? own = null, string? schedule = null, Guid? farm = null)
    {
        var body = new Dictionary<string, object?>();
        if (log is not null) body["logRemindersAudience"] = log;
        if (own is not null) body["ownRemindersAudience"] = own;
        if (schedule is not null) body["scheduleRemindersAudience"] = schedule;
        using var response = await SendAsync(HttpMethod.Put, SettingsUrl(farm), user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REM-1] {user} PUT settings {string.Join(",", body)} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    protected async Task SetSettingsAsync(Guid user, string? log = null, string? own = null, string? schedule = null)
    {
        var (status, body) = await PutSettingsAsync(user, log, own, schedule);
        status.Should().Be(HttpStatusCode.OK, body);
    }

    protected async Task<(HttpStatusCode Status, string Body)> MarkAsync(Guid user, Guid person, bool mark = true, Guid? farm = null)
    {
        using var response = await SendAsync(mark ? HttpMethod.Put : HttpMethod.Delete, MarkUrl(person, farm), user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[REM-1] {user} {(mark ? "PUT" : "DELETE")} always-show {person} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    /// <summary>A spoken reminder of <paramref name="speaker"/> on plot A, made through the real log save; returns (log id, task id).</summary>
    protected async Task<(Guid Log, Guid Task)> SpokenAsync(Guid speaker, string title = SpokenTitle, Guid? plot = null)
    {
        var log = Guid.NewGuid();
        var item = Guid.NewGuid().ToString("N");
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["farmId"] = FarmA,
            ["plotId"] = plot ?? PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = speaker,
            ["logDate"] = Day,
            ["content"] = new Dictionary<string, object?>
            {
                ["schema"] = 1,
                ["capturedAtUtc"] = "2026-11-08T05:00:00.000Z",
                ["fullTranscript"] = "आज फवारणी अर्धी झाली उद्या पाईप बघायचा",
                ["plannedTasks"] = new object[]
                {
                    new Dictionary<string, object?>
                    {
                        ["id"] = item, ["title"] = title, ["status"] = "pending", ["priority"] = "normal", ["sourceType"] = "ai_extracted",
                        ["plotId"] = "FARM_GLOBAL", ["cropId"] = "FARM_GLOBAL", ["createdAt"] = "2026-11-08T05:00:00.000Z",
                    },
                },
            },
        };
        var result = await PushAsync(speaker, "create_daily_log", $"rem1-log-{log:N}", payload);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return (log, PlannedWorkIds.ForSpokenItem(log, item));
    }

    /// <summary>The farm's registrant hides (or restores) a log.</summary>
    protected async Task SetLogAudienceAsync(Guid log, string audience, params Guid[] chosen)
    {
        var result = await PushAsync(Owner, "set_record_audience", $"rem1-aud-{log:N}-{audience}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = log,
            ["audience"] = audience,
            ["selectedUserIds"] = chosen,
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
    }

    protected async Task<bool> SeesOnPullAsync(Guid user, Guid task, DateTime? since = null) =>
        PlannedIds((await PullAsync(user, since)).Root).Contains(task);

    protected async Task<bool> SeesOnRestAsync(Guid user, Guid task)
    {
        var (status, body) = await GetAsync(user, TaskUrl(task));
        var (listStatus, list) = await GetAsync(user, $"/shramsafal/farms/{FarmA}/planned-work");
        listStatus.Should().Be(HttpStatusCode.OK, list);
        var inList = JsonDocument.Parse(list).RootElement.EnumerateArray().Any(t => t.GetProperty("id").GetGuid() == task);
        (status == HttpStatusCode.OK).Should().Be(inList, "the single read and the list agree");
        if (status != HttpStatusCode.OK)
        {
            status.Should().Be(HttpStatusCode.NotFound, body);
        }

        return inList;
    }

    /// <summary>The task as one reader's pull sends it, or null.</summary>
    protected async Task<JsonElement?> PulledAsync(Guid user, Guid task, DateTime? since = null) =>
        TasksOf((await PullAsync(user, since)).Root).Where(t => t.GetProperty("id").GetGuid() == task).Select(t => (JsonElement?)t).FirstOrDefault();

    /// <summary>What ssf.farm_reminder_settings really keeps for farm A (superuser), or null when the owner never changed anything.</summary>
    protected async Task<(string Log, string Own, string Schedule, Guid? By)?> SettingsRowAsync(Guid? farm = null)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT log_reminders_audience, own_reminders_audience, schedule_reminders_audience, updated_by_user_id FROM ssf.farm_reminder_settings WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm ?? FarmA);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync()
            ? (reader.GetString(0), reader.GetString(1), reader.GetString(2), reader.IsDBNull(3) ? null : reader.GetGuid(3))
            : null;
    }

    protected Task<long> MarkCountAsync(Guid? farm = null) =>
        CountAsync("SELECT count(*) FROM ssf.reminder_always_show WHERE farm_id = @f", ("f", farm ?? FarmA));

    /// <summary>The payloads of the audit rows of one entity type (superuser).</summary>
    protected async Task<List<(string Action, string Payload, Guid Actor)>> AuditOfAsync(string entityType)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT action, payload::text, actor_user_id FROM ssf.audit_events WHERE entity_type = @t ORDER BY occurred_at_utc";
        cmd.Parameters.AddWithValue("t", entityType);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<(string, string, Guid)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetString(1), reader.GetGuid(2)));
        }

        return rows;
    }
}
