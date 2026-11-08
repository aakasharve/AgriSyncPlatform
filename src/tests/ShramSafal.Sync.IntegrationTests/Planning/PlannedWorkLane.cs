// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 ("the task record on the server"; founder D-24c, D-26, D-79).
//
// The one seeded farm (RoleScopedFarm: owner, सहमालक, मुकादम, two कामगार, a paused seat, a second farm) plus what the planned-work
// suites need: the five queued doors through the real push handler, raw reads of ssf.planned_work as superuser (what is really
// kept), and the pull / REST reads through the real host. Fake phone numbers only (the base farm's 93000000xx).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Domain.Farms;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Planning;

public abstract class PlannedWorkLane(ITestOutputHelper output) : ScheduleLaneFarm(output)
{
    protected static Dictionary<string, object?> TaskPayload(
        Guid id,
        Guid farm,
        Guid? assignee = null,
        Guid[]? plots = null,
        string scope = "Plot",
        string title = "द्राक्षाला फवारणी",
        string? crew = null,
        int? headcount = null,
        string? payMode = null,
        string? quantity = null,
        string? plannedDate = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["plannedWorkId"] = id,
            ["farmId"] = farm,
            ["title"] = title,
            ["scope"] = scope,
        };
        if (plots is not null)
        {
            payload["plotIds"] = plots;
        }

        void Put(string key, object? value)
        {
            if (value is not null)
            {
                payload[key] = value;
            }
        }

        Put("assigneeUserId", assignee);
        Put("crewText", crew);
        Put("expectedHeadcount", headcount);
        Put("payMode", payMode);
        Put("quantityText", quantity);
        Put("plannedDate", plannedDate);
        return payload;
    }

    /// <summary>plannedwork.create on farm A (a Plot task on प्लॉट A unless told otherwise).</summary>
    protected Task<SyncMutationResultDto> MakeAsync(
        Guid actor, Guid id, Guid? assignee = null, Guid[]? plots = null, string scope = "Plot", Guid? farm = null,
        string? crew = null, int? headcount = null, string? payMode = null, string? quantity = null)
    {
        plots ??= scope is "Plot" ? [PlotA] : [];
        return PushAsync(actor, "plannedwork.create", $"pw-create-{id:N}-{Guid.NewGuid():N}",
            TaskPayload(id, farm ?? FarmA, assignee, plots, scope, crew: crew, headcount: headcount, payMode: payMode, quantity: quantity));
    }

    protected Task<SyncMutationResultDto> StepAsync(Guid actor, string verb, Guid id, Guid? farm = null, string? reason = null)
    {
        var payload = new Dictionary<string, object?> { ["plannedWorkId"] = id, ["farmId"] = farm ?? FarmA };
        if (reason is not null)
        {
            payload["reason"] = reason;
        }

        return PushAsync(actor, $"plannedwork.{verb}", $"pw-{verb}-{id:N}-{Guid.NewGuid():N}", payload);
    }

    protected Task<SyncMutationResultDto> EditAsync(
        Guid actor, Guid id, Guid? assignee, Guid[]? plots = null, string scope = "Plot", string title = "द्राक्षाला फवारणी (बदल)", Guid? farm = null)
    {
        plots ??= scope is "Plot" ? [PlotA] : [];
        return PushAsync(actor, "plannedwork.edit", $"pw-edit-{id:N}-{Guid.NewGuid():N}",
            TaskPayload(id, farm ?? FarmA, assignee, plots, scope, title: title));
    }

    protected async Task<SyncMutationResultDto> MadeAsync(
        Guid actor, Guid id, Guid? assignee = null, Guid[]? plots = null, string scope = "Plot", string? crew = null, int? headcount = null)
    {
        var result = await MakeAsync(actor, id, assignee, plots, scope, crew: crew, headcount: headcount);
        result.Status.Should().Be("applied", $"{result.ErrorCode}: {result.ErrorMessage}");
        return result;
    }

    protected sealed record TaskRow(
        Guid Id, Guid Farm, string Title, string Scope, string Status, Guid? Assignee, Guid CreatedBy, DateTime? SeenAt, DateTime? AcceptedAt,
        DateTime? CancelledAt, Guid? CancelledBy, Guid[] Former, string RecordedOn, DateTime Modified);

    /// <summary>What ssf.planned_work really holds for one task (superuser), or null.</summary>
    protected async Task<TaskRow?> RowAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT id, farm_id, title, scope, status, assignee_user_id, created_by_user_id, seen_at_utc, accepted_at_utc,
                   cancelled_at_utc, cancelled_by_user_id, former_assignee_user_ids, recorded_on::text, modified_at_utc
            FROM ssf.planned_work WHERE id = @id
            """;
        cmd.Parameters.AddWithValue("id", id);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new TaskRow(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3), reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetGuid(5), reader.GetGuid(6),
            reader.IsDBNull(7) ? null : reader.GetDateTime(7), reader.IsDBNull(8) ? null : reader.GetDateTime(8),
            reader.IsDBNull(9) ? null : reader.GetDateTime(9), reader.IsDBNull(10) ? null : reader.GetGuid(10),
            reader.GetFieldValue<Guid[]>(11), reader.GetString(12), reader.GetDateTime(13));
    }

    protected async Task<long> TaskCountAsync() => await CountAsync("SELECT count(*) FROM ssf.planned_work");

    protected static IReadOnlyList<JsonElement> TasksOf(JsonElement root) => ArrayOf(root, "plannedWork");

    protected static IReadOnlyList<Guid> PlannedIds(JsonElement root) =>
        TasksOf(root).Select(t => t.GetProperty("id").GetGuid()).ToList();

    protected static IReadOnlyList<(string Kind, Guid Id)> Withdrawn(JsonElement root) =>
        ArrayOf(root, "withdrawnRecords").Select(w => (w.GetProperty("kind").GetString()!, w.GetProperty("id").GetGuid())).ToList();

    protected async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[L8c-1] {user} GET {url} -> {(int)response.StatusCode} {(text.Length > 300 ? text[..300] + "…" : text)}");
        return (response.StatusCode, text);
    }

    protected string TaskUrl(Guid id, Guid? farm = null) => $"/shramsafal/farms/{farm ?? FarmA}/planned-work/{id}";

    protected async Task SetChosenPlotsAsync(Guid person, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = "ChosenPlots", plotIds = plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    protected Task GrantAsync(Guid person, params FarmAuthority[] authorities) => SetAuthoritiesAsync(FarmA, person, authorities);

    /// <summary>A cursor a phone would send: a whole second after everything written so far.</summary>
    protected static async Task<DateTime> CursorAfterNowAsync()
    {
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - DateTime.UtcNow.Millisecond + 30));
        var cursor = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - DateTime.UtcNow.Millisecond + 30));
        return cursor;
    }
}
