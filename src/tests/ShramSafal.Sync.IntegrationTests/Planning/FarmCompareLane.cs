// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D2 ("तुलना worked out on the server"; D-68, R12, R28, R33, R34).
//
// What the compare suite shares, on top of the SCH-GATE lane (the owner's paid account, seasons that start on a day of our
// choosing, a follow through the real push door): the compare reads (the new farm route and the two old season routes), a
// RECORD of work made through the real push path on a day of our choosing (with an optional note and status), the owner hiding
// it (set_record_audience), and the owner's switch "तुलना पाहणे" on one seat. Fake phone numbers only.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class FarmCompareLane(ITestOutputHelper output) : ScheduleGateLane(output)
{
    protected Task<(HttpStatusCode Status, string Body)> CompareAsync(Guid user, Guid farm) =>
        SendJsonAsync(HttpMethod.Get, $"/shramsafal/farms/{farm}/compare", user, null);

    protected Task<(HttpStatusCode Status, string Body)> OldCompareAsync(Guid user, Guid cycle) =>
        SendJsonAsync(HttpMethod.Get, $"/shramsafal/compare?cropCycleId={cycle}", user, null);

    protected Task<(HttpStatusCode Status, string Body)> OldCompareStageAsync(Guid user, Guid cycle, string stage = "Vegetative") =>
        SendJsonAsync(HttpMethod.Get, $"/shramsafal/compare/stage?cropCycleId={cycle}&stage={Uri.EscapeDataString(stage)}", user, null);

    protected Task PaidAccountAsync() =>
        SetStandingAsync(AccountA, Owner, Active, DateTime.UtcNow.AddDays(-100), DateTime.UtcNow.AddDays(200));

    protected static string Day(DateOnly d) => d.ToString("yyyy-MM-dd");

    /// <summary>The owner (or a switch holder) gets "तुलना पाहणे" and nothing else on this seat.</summary>
    protected Task HoldsSeeCompareAsync(Guid user) => SetAuthoritiesAsync(FarmA, user, FarmAuthority.SeeCompare);

    /// <summary>A Public checked schedule row with stages and works of the test's own choosing (production import + the platform's check).</summary>
    protected async Task<ScheduleTemplate> CheckedScheduleAsync(
        string name, IReadOnlyList<StageDefinition> stages, IReadOnlyList<ImportedActivity> activities)
    {
        await CheckedInstitutionSeatsAsync();
        var row = await SeedStoredRowWithStagesAsync(name, stages, activities);
        (await CheckAsync(PlatformOwner, row.Id, "Approved", ActivityIdsOf(row))).Status.Should().Be(HttpStatusCode.OK);
        return row;
    }

    /// <summary>The platform seats of the check, seeded once (a test that already asked for the University schedule has them).</summary>
    private async Task CheckedInstitutionSeatsAsync()
    {
        if (await CountAsync("SELECT count(*) FROM public.users WHERE \"Id\" = @u", ("u", PlatformOwner)) == 0)
        {
            await SeedReviewSeatsAsync();
        }
    }

    /// <summary>A new plot with a season whose day 0 is <paramref name="dayToday"/> days ago, following <paramref name="template"/> (day 0 = the season's start).</summary>
    protected async Task<(Guid Plot, Guid Cycle, Guid Sub)> FollowingAsync(Guid template, int dayToday, Guid? by = null)
    {
        var (plot, cycle) = await SeedSeasonStartingAsync("Grapes", TodayIst().AddDays(-dayToday));
        var sub = await PushAdoptAsync(by ?? Owner, plot, cycle, template);
        return (plot, cycle, sub);
    }

    /// <summary>
    /// One record of work through the real door: a record by <paramref name="actor"/> on <paramref name="date"/> with ONE task
    /// <paramref name="title"/> (the words the farmer said). <paramref name="status"/> other than 0 (Completed) is arranged as superuser
    /// afterwards (the push door writes Completed only). Returns the record's id.
    /// </summary>
    protected async Task<Guid> RecordAsync(
        Guid actor, Guid plot, Guid cycle, DateOnly date, string title, string? notes = null, int status = 0, bool hide = false)
    {
        var log = Guid.NewGuid();
        await PushOkAsync(actor, "create_daily_log", $"cmpd2-log-{log:N}", new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["operatorUserId"] = actor,
            ["logDate"] = Day(date),
        });
        var task = Guid.NewGuid();
        var payload = new Dictionary<string, object?>
        {
            ["logTaskId"] = task,
            ["dailyLogId"] = log,
            ["activityType"] = title,
            ["occurredAtUtc"] = date.ToDateTime(new TimeOnly(6, 30), DateTimeKind.Utc).ToString("O"),
        };
        if (notes is not null)
        {
            payload["notes"] = notes;
        }

        await PushOkAsync(actor, "add_log_task", $"cmpd2-task-{task:N}", payload);
        if (status != 0)
        {
            await ExecOnSuperuserAsync(
                "UPDATE ssf.log_tasks SET execution_status = @s, deviation_reason_code = 'cmpd2-arranged' WHERE \"Id\" = @t",
                ("s", status), ("t", task));
        }

        if (hide)
        {
            await HideAsync(log);
        }

        return log;
    }

    /// <summary>The owner makes a record "only me" (PRV, D-26): the co-owner and every other seat no longer see it.</summary>
    protected Task HideAsync(Guid log) =>
        PushOkAsync(Owner, "set_record_audience", $"cmpd2-hide-{log:N}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = log,
            ["audience"] = "OnlyMe",
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

    protected async Task<JsonElement> CompareOkAsync(Guid user, Guid farm)
    {
        var (status, body) = await CompareAsync(user, farm);
        status.Should().Be(HttpStatusCode.OK, body);
        return Json(body);
    }

    protected static JsonElement PlotOf(JsonElement root, Guid plot) =>
        root.GetProperty("plots").EnumerateArray().Single(p => p.GetProperty("plotId").GetGuid() == plot);

    protected static IReadOnlyList<JsonElement> SchedulesOf(JsonElement plot) =>
        plot.GetProperty("schedules").EnumerateArray().ToList();

    /// <summary>The counts of schedule <paramref name="scheduleIndex"/> in plot stage <paramref name="stageIndex"/>; a JSON null when the stage carries no numbers.</summary>
    protected static JsonElement CountsOf(JsonElement plot, int scheduleIndex, int stageIndex) =>
        SchedulesOf(plot)[scheduleIndex].GetProperty("stages").EnumerateArray().ElementAt(stageIndex);

    protected static IEnumerable<JsonElement> ItemsOf(JsonElement counts) =>
        counts.GetProperty("parts").EnumerateArray().SelectMany(p => p.GetProperty("items").EnumerateArray());

    /// <summary>Every property name in a JSON answer.</summary>
    protected static SortedSet<string> NamesIn(JsonElement e)
    {
        var names = new SortedSet<string>(StringComparer.Ordinal);
        void Walk(JsonElement x)
        {
            switch (x.ValueKind)
            {
                case JsonValueKind.Object:
                    foreach (var p in x.EnumerateObject())
                    {
                        names.Add(p.Name);
                        Walk(p.Value);
                    }

                    break;
                case JsonValueKind.Array:
                    foreach (var c in x.EnumerateArray())
                    {
                        Walk(c);
                    }

                    break;
            }
        }

        Walk(e);
        return names;
    }

    /// <summary>The answer with its clock removed, so two readers' answers can be compared byte for byte.</summary>
    protected static string WithoutClock(JsonElement root)
    {
        using var doc = JsonDocument.Parse(root.GetRawText());
        var copy = new Dictionary<string, JsonElement>();
        foreach (var p in doc.RootElement.EnumerateObject().Where(p => p.Name != "serverTimeUtc"))
        {
            copy[p.Name] = p.Value.Clone();
        }

        return JsonSerializer.Serialize(copy);
    }

    protected static readonly StageDefinition[] CompareStages =
    [
        new("आधी", 0, 30),
        new("फुलोरा ते फळधारणा", 31, 60),
        new("नंतर", 61, 90),
    ];
}
