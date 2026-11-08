// spec: dfes-input-truth-and-mix-check-2026-11-06 - lane IT2 (founders D-92 / D-95).
//
// Migration 20261108090000_AddInputIdentityAssertions creates ssf.input_identity_assertions: his हो / नाही / फोटो answers about
// the products of saved records, one unchangeable row each, FORCE RLS on its own farm_id, the app role holding SELECT + INSERT
// only. Proven here on a real Postgres as agrisync_app (doctrine E3 first in every fact: neither superuser nor BYPASSRLS), through
// the real host and the real push / pull:
//   A  AppRole_CannotUpdateOrDelete: the app role can read and append, and can neither UPDATE, DELETE nor TRUNCATE a row;
//   B  OtherFarm_CannotSeeRows: a farm's answers are invisible under another farm's scope and to a person who is not a member,
//      and a row cannot be written for a farm the scope is not on (WITH CHECK);
//   C  push then pull: the speaker's answer is his own (is_check false), a holder of the confirm-records authority gives the
//      check (is_check true), another member is refused; the pull brings an answer on its OWN delta (the record did not change);
//      the record's version, its stored content and its tasks are untouched (D-92, P7); a repeat is one row;
//   D  the table refuses what the application never writes (an unknown answer, a confirmed answer with no product, a replayed
//      request id);
//   E  the pull's cursor moves with the answers: a second pull with the cursor the server returned repeats nothing, a new answer
//      comes back once, and another farm's answer never comes back to this farm's owner.
// The merge owner runs this class (it needs the throwaway cluster the other RealPostgres suites use).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class InputIdentityAssertionsRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private const string Mutation = "assert_input_identity";
    private const string CalciumNitrate = "p-calcium-nitrate";

    private static readonly string Today = DateOnly.FromDateTime(DateTime.UtcNow).ToString("yyyy-MM-dd");

    private static object MixContent() => new
    {
        schema = 1,
        inputs = new object[]
        {
            new
            {
                id = "e1",
                method = "Drip",
                mix = new object[]
                {
                    new { id = "m0", productName = "calcium nitrate" },
                    new { id = "m1", productName = "19:19:19", npkGrade = "19:19:19" },
                },
            },
        },
    };

    private async Task<Guid> RecordAsync(Guid speaker, string requestId)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, speaker, Guid.NewGuid(), 2, 100m, 200m, [], null);
        payload["logDate"] = Today;
        payload["content"] = MixContent();
        await PushAppliedAsync(speaker, "create_daily_log", requestId, payload);
        return logId;
    }

    private static Dictionary<string, object?> Answer(
        Guid log, string verdict = "confirmed", string eventId = "e1", int slot = 0, string? product = CalciumNitrate, Guid? id = null,
        Guid? farm = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["assertionId"] = id ?? Guid.NewGuid(),
            ["farmId"] = farm ?? FarmA,
            ["dailyLogId"] = log,
            ["inputEventId"] = eventId,
            ["mixIndex"] = slot,
            ["verdict"] = verdict,
            ["catalogVersion"] = "inputs-2.4",
        };
        if (product is not null)
        {
            payload["catalogProductId"] = product;
        }

        return payload;
    }

    private async Task<Guid> RecordInFarmBAsync(string requestId)
    {
        var logId = Guid.NewGuid();
        var payload = LogPayload(logId, OwnerB, Guid.NewGuid(), 2, 100m, 200m, [], null, FarmB);
        payload["plotId"] = PlotB;
        payload["cropCycleId"] = CycleB;
        payload["logDate"] = Today;
        payload["content"] = MixContent();
        await PushAppliedAsync(OwnerB, "create_daily_log", requestId, payload);
        return logId;
    }

    /// <summary>
    /// GET /sync/pull with the cursor EXACTLY as the server handed it back (not rounded down to the second as a phone does):
    /// the question here is whether the server moves its cursor past what it sent. A phone's rounded cursor may send the
    /// newest rows of its last second once more - the harmless, idempotent repeat every kind of record already has.
    /// </summary>
    private async Task<JsonElement> PullExactAsync(Guid user, DateTime since)
    {
        using var response = await SendAsync(
            HttpMethod.Get, $"/sync/pull?since={Uri.EscapeDataString(since.ToUniversalTime().ToString("O"))}", user);
        var body = await response.Content.ReadAsStringAsync();
        response.IsSuccessStatusCode.Should().BeTrue($"the pull must succeed for {user}: {(int)response.StatusCode} {body}");
        return JsonDocument.Parse(body).RootElement.Clone();
    }

    private static IReadOnlyList<Guid> AnswerIds(JsonElement root) =>
        ArrayOf(root, "inputIdentityAssertions").Select(a => a.GetProperty("assertionId").GetGuid()).ToList();

    // ── A ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AppRole_CannotUpdateOrDelete()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync(Worker, "it2-a-log");
        await PushAppliedAsync(Worker, Mutation, "it2-a-answer", Answer(log));

        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            (await ScalarAsync(db, $"SELECT has_table_privilege(current_user, 'ssf.input_identity_assertions', '{privilege}')"))
                .Should().Be(true, $"the app role appends and reads ({privilege})");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE", "TRUNCATE" })
        {
            (await ScalarAsync(db, $"SELECT has_table_privilege(current_user, 'ssf.input_identity_assertions', '{privilege}')"))
                .Should().Be(false, $"an answer is never edited or removed ({privilege} is revoked)");
        }

        foreach (var sql in new[]
                 {
                     "UPDATE ssf.input_identity_assertions SET verdict = 'rejected' WHERE daily_log_id = @id",
                     "DELETE FROM ssf.input_identity_assertions WHERE daily_log_id = @id",
                     "TRUNCATE ssf.input_identity_assertions",
                 })
        {
            (await RefusedWithAsync(FarmA, sql, log)).Should().Be("42501", $"{sql} must be refused by privilege");
        }

        (await CountAsAppAsync(FarmA, null, $"daily_log_id = '{log}'")).Should().Be(1, "the refused writes changed nothing");
    }

    // ── B ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task OtherFarm_CannotSeeRows()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var log = await RecordAsync(Worker, "it2-b-log");
        await PushAppliedAsync(Worker, Mutation, "it2-b-answer", Answer(log));

        (await CountAsAppAsync(FarmA, null, "true")).Should().Be(1, "under its own farm's scope the row is there (else the proof is vacuous)");
        (await CountAsAppAsync(FarmB, null, "true")).Should().Be(0, "farm B's scope sees none of farm A's answers");
        (await CountAsAppAsync(null, null, "true")).Should().Be(0, "no scope sees nothing");
        (await CountAsAppAsync(null, Owner, "true")).Should().Be(1, "farm A's primary account holder reads it by user scope");
        (await CountAsAppAsync(null, OwnerB, "true")).Should().Be(0, "farm B's owner is not a member of farm A");
        (await CountAsAppAsync(null, Paused, "true")).Should().Be(0, "a paused seat reads nothing (m.status = 3)");

        // A row for farm A cannot be written under farm B's scope (WITH CHECK), whatever the SQL says.
        var insert = $"""
            INSERT INTO ssf.input_identity_assertions ("Id", farm_id, daily_log_id, input_event_id, mix_index, spoken_name, verdict,
                                                        catalog_version, asserted_by_user_id, asserted_at_utc, client_mutation_id, is_check)
            VALUES (gen_random_uuid(), '{FarmA}', '{log}', 'e1', 0, 'x', 'rejected', 'inputs-2', '{Worker}', NOW(), 'planted', FALSE)
            """;
        (await RefusedWithAsync(FarmB, insert, log)).Should().Be("42501", "a row policy refuses a row of another farm");
    }

    // ── C ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Assert_StoresRow_AndPullReturnsIt()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ConfirmRecords);
        var log = await RecordAsync(Worker, "it2-c-log");
        var tasksBefore = await ScalarLongAsync("SELECT COUNT(*) FROM ssf.log_tasks WHERE daily_log_id = @id", log);
        var (_, firstRoot) = await PullAsync(Owner);
        var cursor = firstRoot.GetProperty("nextCursorUtc").GetDateTime();
        await Task.Delay(1150);

        var answered = await PushAsync(Worker, Mutation, "it2-c-speaker", Answer(log));
        answered.Status.Should().Be("applied", "{0}: {1}", answered.ErrorCode, answered.ErrorMessage);

        // The speaker's answer is his own; the check is not it.
        var rows = await RowsAsync(log);
        var speakerRow = rows.Should().ContainSingle().Subject;
        speakerRow.By.Should().Be(Worker);
        speakerRow.IsCheck.Should().BeFalse("the speaker's answer is kept as his, never as the check (D-95)");
        speakerRow.SpokenName.Should().Be("calcium nitrate", "his words are the stored item's, not the request's");

        // The owner's pull: the RECORD did not change, yet the answer arrives (its own delta), with the speaker's name.
        var (body, root) = await PullAsync(Owner, cursor);
        Keep("owner-pull-after-speaker-answer", body);
        var answer = ArrayOf(root, "inputIdentityAssertions").Should().ContainSingle().Subject;
        answer.GetProperty("dailyLogId").GetGuid().Should().Be(log);
        answer.GetProperty("verdict").GetString().Should().Be("confirmed");
        answer.GetProperty("isCheck").GetBoolean().Should().BeFalse();
        answer.GetProperty("assertedByUserId").GetGuid().Should().Be(Worker);
        answer.GetProperty("spokenName").GetString().Should().Be("calcium nitrate");
        ArrayOf(root, "operators").Select(o => o.GetProperty("userId").GetGuid()).Should().Contain(Worker, "the phone names who answered");
        IdsOf(root, "dailyLogs").Should().NotContain(log, "an answer never moves its record's clock (D-92)");

        // The check: a holder of the confirm-records authority (the मुकादम holds it through his grant, the owner always).
        var checkedBy = await PushAsync(Mukadam, Mutation, "it2-c-check", Answer(log, "rejected", product: null));
        checkedBy.Status.Should().Be("applied", "{0}: {1}", checkedBy.ErrorCode, checkedBy.ErrorMessage);
        (await RowsAsync(log)).Should().HaveCount(2).And.Contain(r => r.By == Mukadam && r.IsCheck);

        // Another member who may neither speak for the record nor check it is refused, visibly.
        var refused = await PushAsync(CoOwner, Mutation, "it2-c-other", Answer(log));
        refused.Status.Should().NotBe("applied");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await RowsAsync(log)).Should().HaveCount(2);

        // The record is exactly as it was: same version, same stored content, same task lines (D-92, P7).
        (await ScalarLongAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", log)).Should().Be(1);
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.daily_log_contents WHERE daily_log_id = @id", log)).Should().Be(1);
        (await ScalarLongAsync("SELECT COUNT(*) FROM ssf.log_tasks WHERE daily_log_id = @id", log)).Should().Be(
            tasksBefore, "no answer adds, removes or changes a task");
    }

    [Fact]
    public async Task The_pull_cursor_moves_with_the_answers_and_a_second_pull_repeats_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.ConfirmRecords);
        var log = await RecordAsync(Worker, "it2-e-log");
        var firstAnswer = Guid.NewGuid();
        await PushAppliedAsync(Worker, Mutation, "it2-e-first", Answer(log, id: firstAnswer));

        // From the beginning the owner receives the answer, and the cursor moves to (at least) it.
        var first = await PullExactAsync(Owner, DateTime.UnixEpoch);
        AnswerIds(first).Should().Equal(firstAnswer);
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();

        // A second pull with that cursor repeats nothing.
        var second = await PullExactAsync(Owner, cursor);
        AnswerIds(second).Should().BeEmpty("the server's cursor moved past the answer it sent");

        // A new answer comes back once, and the next pull with the new cursor is empty again.
        var secondAnswer = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, Mutation, "it2-e-second", Answer(log, "rejected", product: null, id: secondAnswer));
        var third = await PullExactAsync(Owner, cursor);
        AnswerIds(third).Should().Equal(secondAnswer);
        var fourth = await PullExactAsync(Owner, third.GetProperty("nextCursorUtc").GetDateTime());
        AnswerIds(fourth).Should().BeEmpty();

        // Another farm's answer never comes back to this farm's owner (and farm A's never to farm B's).
        var farmBLog = await RecordInFarmBAsync("it2-e-b-log");
        var farmBAnswer = Guid.NewGuid();
        await PushAppliedAsync(OwnerB, Mutation, "it2-e-b-answer", Answer(farmBLog, id: farmBAnswer, farm: FarmB));
        var ownerFromTheStart = await PullExactAsync(Owner, DateTime.UnixEpoch);
        AnswerIds(ownerFromTheStart).Should().NotContain(farmBAnswer).And.Contain([firstAnswer, secondAnswer]);
        var ownerBFromTheStart = await PullExactAsync(OwnerB, DateTime.UnixEpoch);
        AnswerIds(ownerBFromTheStart).Should().Equal(farmBAnswer);
        AnswerIds(await PullExactAsync(Owner, fourth.GetProperty("nextCursorUtc").GetDateTime())).Should().BeEmpty(
            "farm B's new answer is not farm A's owner's to receive, from any cursor");
    }

    [Fact]
    public async Task Assert_Twice_SameClientMutationId_IsOneRow()
    {
        var log = await RecordAsync(Worker, "it2-c2-log");
        var answer = Answer(log);

        await PushAppliedAsync(Worker, Mutation, "it2-c2-same", answer);
        var again = await PushAsync(Worker, Mutation, "it2-c2-same", answer);

        again.Status.Should().BeOneOf("applied", "duplicate");
        (await RowsAsync(log)).Should().ContainSingle("a re-sent answer is the same row");
    }

    [Fact]
    public async Task Assert_RefusesAnItemTheRecordDoesNotHold_AndAProductTheLibraryDoesNot()
    {
        var log = await RecordAsync(Worker, "it2-c3-log");

        var gone = await PushAsync(Worker, Mutation, "it2-c3-gone", Answer(log, eventId: "e9"));
        var unknown = await PushAsync(Worker, Mutation, "it2-c3-unknown", Answer(log, product: "p-no-such-product"));

        gone.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        unknown.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");
        (await RowsAsync(log)).Should().BeEmpty();
    }

    // ── D ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_table_refuses_what_the_application_never_writes()
    {
        var log = await RecordAsync(Worker, "it2-d-log");

        string Insert(string verdict, string? product, string request) => $"""
            INSERT INTO ssf.input_identity_assertions ("Id", farm_id, daily_log_id, input_event_id, mix_index, spoken_name, verdict,
                                                        catalog_product_id, catalog_version, asserted_by_user_id, asserted_at_utc,
                                                        client_mutation_id, is_check)
            VALUES (gen_random_uuid(), '{FarmA}', '{log}', 'e1', 0, 'x', '{verdict}', {(product is null ? "NULL" : $"'{product}'")},
                    'inputs-2', '{Worker}', NOW(), '{request}', FALSE)
            """;

        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        async Task<string> StateOfAsync(string sql)
        {
            try
            {
                await ExecAsync(db, sql);
                return "none";
            }
            catch (PostgresException ex)
            {
                return ex.SqlState;
            }
        }

        (await StateOfAsync(Insert("maybe", null, "it2-d-1"))).Should().Be("23514", "an unknown answer");
        (await StateOfAsync(Insert("confirmed", null, "it2-d-2"))).Should().Be("23514", "a confirmed answer names its product");
        (await StateOfAsync(Insert("rejected", null, "it2-d-3"))).Should().Be("none");
        (await StateOfAsync(Insert("rejected", null, "it2-d-3"))).Should().Be("23505", "the same request on the same farm is one row");
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────

    private sealed record AnswerRow(Guid By, bool IsCheck, string SpokenName);

    private async Task<List<AnswerRow>> RowsAsync(Guid log)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT asserted_by_user_id, is_check, spoken_name FROM ssf.input_identity_assertions WHERE daily_log_id = @id ORDER BY asserted_at_utc";
        cmd.Parameters.AddWithValue("id", log);
        var rows = new List<AnswerRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new AnswerRow(reader.GetGuid(0), reader.GetBoolean(1), reader.GetString(2)));
        }

        return rows;
    }

    private async Task<long> ScalarLongAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private static async Task<object?> ScalarAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        return await cmd.ExecuteScalarAsync();
    }

    /// <summary>The SQLSTATE the app role gets for <paramref name="sql"/> under <paramref name="farm"/>'s scope, or "none".</summary>
    private async Task<string> RefusedWithAsync(Guid farm, string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText = $"SELECT set_config('agrisync.farm_id', '{farm}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.Transaction = tx;
            cmd.CommandText = sql;
            cmd.Parameters.AddWithValue("id", id);
            await cmd.ExecuteNonQueryAsync();
            return "none";
        }
        catch (PostgresException ex)
        {
            return ex.SqlState;
        }
    }

    /// <summary>Rows the app role sees under a farm scope or a user scope (one of them, or neither).</summary>
    private async Task<long> CountAsAppAsync(Guid? farm, Guid? user, string where)
    {
        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var scope = db.CreateCommand())
        {
            scope.Transaction = tx;
            scope.CommandText =
                $"SELECT set_config('agrisync.farm_id', '{(farm is { } f ? f.ToString() : string.Empty)}', true), "
                + $"set_config('agrisync.user_id', '{(user is { } u ? u.ToString() : string.Empty)}', true)";
            await scope.ExecuteNonQueryAsync();
        }

        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = $"SELECT count(*) FROM ssf.input_identity_assertions WHERE {where}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private void Keep(string name, string body) => Output.WriteLine($"[EVIDENCE] {name}: {body.Length} bytes");
}
