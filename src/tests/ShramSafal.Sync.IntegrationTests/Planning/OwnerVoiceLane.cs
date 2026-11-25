// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice"; approved spec plr-d10-schedule-approved-spec-2026-11-23, "Owner's voice")
//
// The shared arrangement of the owner-voice proofs: a reference schedule (version 1, then a checked version 2 with a changed dose), a grape plot that follows version 1 and took one
// work from it, a job given to the mukadam, the tone fixture (a generated sine, never a voice) and the doors (staff upload, a follower's pushes). Real Postgres as agrisync_app, through
// the real host and the real push handler; the switch row and the arrangement are written as superuser. Fake numbers only; no dose from any real schedule.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Planning;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class OwnerVoiceLane(ITestOutputHelper output) : ScheduleGateLane(output)
{
    protected const string Heard = "schedule.owner_message.heard";
    protected const string Decide = "schedule.owner_message.decide";
    protected const string Answer = "schedule.owner_message.answer";
    protected const string OffCode = "ShramSafal.ScheduleMechanismOff";
    protected const string Invalid = "ShramSafal.OwnScheduleInvalid";
    protected const string DoseOld = "२ ग्रॅम प्रति लिटर";
    protected const string DoseNew = "३ ग्रॅम प्रति लिटर";

    protected static JsonElement Canonical(ScheduleTaskContent t) => JsonDocument.Parse(t.ToCanonicalJson()).RootElement.Clone();

    protected static object StageBody(string name, int start, int end) => new { name, startDay = start, endDay = end, startSign = (string?)null, endSign = (string?)null };

    protected static readonly object[] TwoStages = [StageBody("छाटणी आणि फूट", 0, 40), StageBody("मण्यांची वाढ", 41, 99)];

    protected static IReadOnlyList<ScheduleTaskContent> Tasks(string dose) =>
    [
        new("t-prune", "फळछाटणी", ScheduleTaskKind.Work, ScheduleTaskTiming.OnDays(0), ScheduleBasis.Stated, 0, 0),
        new("t-spray", "बुरशीनाशक फवारणी", ScheduleTaskKind.Spray, ScheduleTaskTiming.OnDays(10, 30), ScheduleBasis.Stated, 0, 1,
            Dose: dose, Products: [new ScheduleProduct("चाचणी औषध", dose, "ग्रॅम", "लिटर")], ReEntryHours: 24, PreHarvestDays: 30),
        new("t-water", "पाणी", ScheduleTaskKind.Irrigation, ScheduleTaskTiming.OnDays(5), ScheduleBasis.Stated, 0, 2),
    ];

    private bool _seatsSeededHere;

    /// <summary>Imports a reference schedule in the task format (by the platform owner); <paramref name="previous"/> makes it the next version of that chain.</summary>
    protected async Task<Guid> ImportVersionAsync(string dose, Guid? previous = null)
    {
        if (!_seatsSeededHere)
        {
            _seatsSeededHere = true;
            await SeedReviewSeatsAsync();
        }

        var body = new
        {
            format = 2,
            name = "द्राक्ष: चाचणी संदर्भ",
            cropKey = "grape",
            ownerType = "INSTITUTION",
            sourceLabel = "चाचणी पुस्तिका",
            previousVersionId = previous,
            stages = TwoStages,
            tasks = Tasks(dose).Select(Canonical).ToArray(),
            challenges = Array.Empty<object>(),
        };
        var (status, text) = await SendJsonAsync(HttpMethod.Post, "/shramsafal/schedule-templates/import/format-2", PlatformOwner, body);
        status.Should().Be(HttpStatusCode.Created, text);
        return Json(text).GetProperty("templateId").GetGuid();
    }

    /// <summary>The check by someone other than the maker (the platform employee), ticking every task.</summary>
    protected async Task ApproveAsync(Guid version)
    {
        var (vs, vt) = await SendJsonAsync(HttpMethod.Get, $"/shramsafal/schedule-templates/{version}/check-view", PlatformEmployee, null);
        vs.Should().Be(HttpStatusCode.OK, vt);
        var view = Json(vt);
        var (ok, okText) = await SendJsonAsync(HttpMethod.Post, $"/shramsafal/schedule-templates/{version}/check", PlatformEmployee, new
        {
            decision = "Approved",
            checkedActivityIds = Array.Empty<Guid>(),
            checkerDisplayName = DisplayName,
            checkedTaskKeys = view.GetProperty("tasks").EnumerateArray().Select(e => e.GetProperty("taskKey").GetString()!).ToArray(),
            checkedChallengeKeys = Array.Empty<string>(),
            contentHash = view.GetProperty("contentHash").GetString(),
        });
        ok.Should().Be(HttpStatusCode.OK, okText);
    }

    protected Task SwitchOnAsync(params Guid[] farms) => ExecOnSuperuserAsync("""
        INSERT INTO ssf.feature_flags (id, flag_name, enabled, cohort_pattern, description, modified_at_utc, modified_by)
        VALUES (gen_random_uuid(), 'schedule_mechanism', TRUE, @cohort, 'slice-12b test row', NOW(), 'test')
        ON CONFLICT (flag_name) DO UPDATE SET enabled = TRUE, cohort_pattern = EXCLUDED.cohort_pattern, modified_at_utc = NOW();
        """, ("cohort", string.Join('|', farms.Select(f => f.ToString()))));

    protected Task GrantAsync(Guid person, params ShramSafal.Domain.Farms.FarmAuthority[] authorities) => SetAuthoritiesAsync(FarmA, person, authorities);

    protected async Task<SyncMutationResultDto> OkAsync(Task<SyncMutationResultDto> push)
    {
        var result = await push;
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    protected static JsonElement Data(SyncMutationResultDto result) => JsonSerializer.SerializeToElement(result.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web));

    protected Task<SyncMutationResultDto> TakeAsync(Guid actor, Guid plot, Guid cycle, Guid source, string key) =>
        PushAsAsync(actor, "schedule.take_task", $"take-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["sourceVersionId"] = source,
            ["taskKey"] = key,
        }, "1.0.18");

    protected Task<SyncMutationResultDto> PlanAsync(Guid actor, Guid plot, Guid cycle, string key, Guid? assignee = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["plannedWorkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["plotId"] = plot,
            ["cropCycleId"] = cycle,
            ["taskKey"] = key,
        };
        if (assignee is { } who)
        {
            payload["assigneeUserId"] = who;
        }

        return PushAsAsync(actor, "ownschedule.item.plan", $"own-plan-{Guid.NewGuid():N}", payload, "1.0.18");
    }

    protected Task<SyncMutationResultDto> HeardAsync(Guid actor, Guid plot, Guid message, Guid? farm = null) =>
        PushAsAsync(actor, Heard, $"heard-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = farm ?? FarmA, ["plotId"] = plot, ["messageId"] = message }, "1.0.18");

    protected Task<SyncMutationResultDto> DecideAsync(Guid actor, Guid plot, Guid cycle, Guid message, string decision, Guid? farm = null) =>
        PushAsAsync(actor, Decide, $"decide-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = farm ?? FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["messageId"] = message, ["decision"] = decision }, "1.0.18");

    protected Task<SyncMutationResultDto> AnswerAsync(Guid actor, Guid plot, Guid cycle, Guid message, string answer) =>
        PushAsAsync(actor, Answer, $"answer-{Guid.NewGuid():N}",
            new Dictionary<string, object?> { ["farmId"] = FarmA, ["plotId"] = plot, ["cropCycleId"] = cycle, ["messageId"] = message, ["answer"] = answer }, "1.0.18");

    protected async Task<string> ScalarAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (n, v) in args)
        {
            cmd.Parameters.AddWithValue(n, v);
        }

        return (await cmd.ExecuteScalarAsync())?.ToString() ?? string.Empty;
    }

    // ---- the tone fixture: a generated sine wave (16 bit mono PCM, 8 kHz), never a voice ----

    /// <summary>A WAV of <paramref name="milliseconds"/> of a 440 Hz tone (or silence).</summary>
    protected static byte[] Tone(int milliseconds, bool silence = false)
    {
        const int rate = 8000;
        var samples = rate * milliseconds / 1000;
        var data = new byte[samples * 2];
        for (var i = 0; i < samples; i++)
        {
            var v = silence ? (short)0 : (short)(Math.Sin(2 * Math.PI * 440 * i / rate) * 8000);
            data[i * 2] = (byte)(v & 0xFF);
            data[i * 2 + 1] = (byte)((v >> 8) & 0xFF);
        }

        using var ms = new System.IO.MemoryStream();
        using var w = new System.IO.BinaryWriter(ms);
        w.Write("RIFF"u8.ToArray());
        w.Write(36 + data.Length);
        w.Write("WAVEfmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(rate);
        w.Write(rate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write("data"u8.ToArray());
        w.Write(data.Length);
        w.Write(data);
        return ms.ToArray();
    }

    // ---- the staff door: a multipart upload ----

    protected async Task<(HttpStatusCode Status, string Body)> SendMessageAsync(
        Guid user, Guid version, string kind, string taskKey, byte[]? audio, string audioType = "audio/wav",
        Guid? newVersion = null, string? first = null, string? second = null, byte[]? followUp = null)
    {
        using var form = new MultipartFormDataContent();
        form.Add(new StringContent(kind), "kind");
        form.Add(new StringContent(taskKey), "taskKey");
        if (newVersion is { } nv)
        {
            form.Add(new StringContent(nv.ToString()), "newVersionId");
        }

        if (first is not null)
        {
            form.Add(new StringContent(first), "answerFirst");
        }

        if (second is not null)
        {
            form.Add(new StringContent(second), "answerSecond");
        }

        void AddFile(string name, byte[] bytes, string type)
        {
            var part = new ByteArrayContent(bytes);
            part.Headers.ContentType = MediaTypeHeaderValue.Parse(type);
            form.Add(part, name, $"{name}.bin");
        }

        if (audio is not null)
        {
            AddFile("audio", audio, audioType);
        }

        if (followUp is not null)
        {
            AddFile("followUp", followUp, "audio/wav");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, $"/shramsafal/schedule-templates/{version}/owner-messages") { Content = form };
        using var response = await SendRequestAsync(request, user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[12b] {user} POST owner-messages {kind} -> {(int)response.StatusCode} {(text.Length > 300 ? text[..300] : text)}");
        return (response.StatusCode, text);
    }

    protected async Task<Guid> SendOkAsync(Guid version, string kind, string taskKey, Guid? newVersion = null, string? first = null, string? second = null, Guid? user = null)
    {
        var (status, text) = await SendMessageAsync(
            user ?? PlatformOwner, version, kind, taskKey, Tone(2000), newVersion: newVersion, first: first, second: second, followUp: kind == "look" ? Tone(1500, silence: true) : null);
        status.Should().Be(HttpStatusCode.Created, text);
        return Json(text).GetProperty("message").GetProperty("id").GetGuid();
    }

    /// <summary>The arrangement every proof starts from.</summary>
    protected sealed record Arranged(Guid Plot, Guid Cycle, Guid V1, Guid V2, Guid? JobId);

    /// <summary>
    /// A grape plot (season began 30 days ago) following version 1 (checked); version 2 (changed dose, checked by someone other than its maker) exists. With <paramref name="took"/>, the farmer
    /// took t-spray into his own schedule, and with <paramref name="job"/> planned it and gave it to the mukadam (who has seen and accepted it).
    /// </summary>
    protected async Task<Arranged> ArrangeAsync(bool took = true, bool job = true)
    {
        await SwitchOnAsync(FarmA);
        var v1 = await ImportVersionAsync(DoseOld);
        await ApproveAsync(v1);
        var v2 = await ImportVersionAsync(DoseNew, v1);
        await ApproveAsync(v2);
        var (plot, cycle) = await SeedSeasonStartingAsync("grape", TodayIst().AddDays(-30));
        await PushAdoptAsync(Owner, plot, cycle, v1);
        Guid? jobId = null;
        if (took)
        {
            await OkAsync(TakeAsync(Owner, plot, cycle, v1, "t-spray"));
            if (job)
            {
                var plan = await OkAsync(PlanAsync(Owner, plot, cycle, "t-spray", Mukadam));
                jobId = Data(plan).GetProperty("id").GetGuid();
                await OkAsync(PushAsAsync(Mukadam, "plannedwork.accept", $"accept-{Guid.NewGuid():N}",
                    new Dictionary<string, object?> { ["plannedWorkId"] = jobId, ["farmId"] = FarmA }, "1.0.18"));
            }
        }

        return new Arranged(plot, cycle, v1, v2, jobId);
    }

    /// <summary>What a message must leave exactly as it was: the own works, their revisions, origins, the plans, the logs and the schedules followed.</summary>
    protected Task<string> UntouchedAsync() => ScalarAsync("""
        SELECT (SELECT count(*) FROM ssf.own_schedule_items) || '/' || (SELECT count(*) FROM ssf.own_schedule_item_revisions) || '/' || (SELECT count(*) FROM ssf.own_schedule_item_origins)
            || '/' || (SELECT count(*) FROM ssf.planned_work) || '/' || (SELECT count(*) FROM ssf.daily_logs) || '/' || (SELECT count(*) FROM ssf.schedule_subscriptions)
            || '/' || (SELECT coalesce(string_agg(md5(row_to_json(i)::text), '' ORDER BY id), '') FROM ssf.own_schedule_items i)
            || '/' || (SELECT coalesce(string_agg(md5(row_to_json(p)::text), '' ORDER BY id), '') FROM ssf.planned_work p)
        """);

    protected sealed record JobRow(string Title, string? Quantity, string Status, bool Seen, bool Accepted, string? Assignee);

    protected async Task<JobRow> JobAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT title, quantity_text, status, seen_at_utc IS NOT NULL, accepted_at_utc IS NOT NULL, assignee_user_id::text FROM ssf.planned_work WHERE id = @i";
        cmd.Parameters.AddWithValue("i", id);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue();
        return new JobRow(r.GetString(0), r.IsDBNull(1) ? null : r.GetString(1), r.GetValue(2).ToString()!, r.GetBoolean(3), r.GetBoolean(4), r.IsDBNull(5) ? null : r.GetString(5));
    }

    // ---- the app role, with a scope exactly as a request sets it ----

    protected async Task<int> AppRowsAsync(Guid? farm, Guid? user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        var n = 0;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            n++;
        }

        return n;
    }

    protected async Task<string?> AppTryAsync(Guid? farm, Guid? user, string sql)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await ScopeAsync(db, farm, user);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    private static async Task ScopeAsync(NpgsqlConnection db, Guid? farm, Guid? user)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @f, true), set_config('agrisync.user_id', @u, true)";
        cmd.Parameters.AddWithValue("f", farm?.ToString() ?? string.Empty);
        cmd.Parameters.AddWithValue("u", user?.ToString() ?? string.Empty);
        await cmd.ExecuteNonQueryAsync();
    }
}
