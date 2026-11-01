// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — the WRITE half of a
// role-scoped download: a write the seat may not make for that farm is refused as ShramSafal.Forbidden (the
// phone parks it where the farmer sees it, P9 — never lost) and stages nothing; a working seat's own writes
// still land (no over-refusal); and an edit by someone who was sent a record WITHOUT its amounts never
// deletes them (the amounts are carried forward). Real /sync/push, real Postgres as agrisync_app (E3 first).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RoleScopedPushRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid Joiner = Guid.Parse("3d030000-0000-4000-8000-000000000018");

    [Fact]
    public async Task A_paused_a_waiting_and_a_foreign_seat_are_refused_as_forbidden_and_nothing_lands()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (gen_random_uuid(), @farm, @joiner, 'Worker', NOW(), NOW(), @account, 2, 2);
            """, ("farm", FarmA), ("joiner", Joiner), ("account", AccountA));

        foreach (var (who, label) in new[] { (Paused, "paused"), (Joiner, "waiting"), (OwnerB, "another farm's owner") })
        {
            var logId = Guid.NewGuid();
            var costId = Guid.NewGuid();
            var markId = Guid.NewGuid();
            var attempts = new (string Type, string RequestId, Dictionary<string, object?> Payload)[]
            {
                ("create_daily_log", $"mu3-push-log-{label}",
                    LogPayload(logId, who, Guid.NewGuid(), 4, null, null, [], null)),
                ("add_cost_entry", $"mu3-push-cost-{label}", CostPayload(costId, FarmA, PlotA, CycleA, 1234.56m)),
                ("attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:2026-10-29:Full:-:-:-:{label}",
                    new Dictionary<string, object?>
                    {
                        ["attendanceMarkId"] = markId,
                        ["farmId"] = FarmA,
                        ["fieldOperatorId"] = FieldOperator,
                        ["workDate"] = "2026-10-29",
                        ["dayMark"] = "Full",
                    }),
            };

            foreach (var (type, requestId, payload) in attempts)
            {
                var result = await PushAsync(who, type, requestId, payload);
                result.Status.Should().Be("failed", $"{label}: {type} is not his to write on this farm");
                result.ErrorCode.Should().Be("ShramSafal.Forbidden",
                    $"{label}: refused as Forbidden, which the phone parks visibly (never dropped)");
            }

            (await CountAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(0);
            (await CountAsync("SELECT COUNT(*) FROM ssf.cost_entries WHERE \"Id\" = @id", costId)).Should().Be(0);
            (await CountAsync("SELECT COUNT(*) FROM ssf.attendance_marks WHERE \"Id\" = @id", markId)).Should().Be(0);
        }
    }

    [Fact]
    public async Task A_working_seat_still_records_its_own_work_and_takes_attendance()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "mu3-push-worker-own",
            LogPayload(logId, Worker, Guid.NewGuid(), 2, null, null, [], null));
        (await CountAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(1);

        await PushAppliedAsync(Mukadam, "attendance.mark", $"attendance.mark:{FarmA}:{FieldOperator}:2026-10-28:Full:-:-:-",
            new Dictionary<string, object?>
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = FieldOperator,
                ["workDate"] = "2026-10-28",
                ["dayMark"] = "Full",
            });
    }

    /// <summary>
    /// The मुकादम (take हजेरी — he may correct records) was sent the owner's record WITHOUT its amounts. He
    /// changes the quantity on exactly the document his pull gave him. The record keeps its ₹777.73: the
    /// absence of an amount he was never shown is not a deletion (P10 — acknowledged money is never lost).
    /// </summary>
    [Fact]
    public async Task An_edit_by_someone_sent_the_record_without_its_amounts_keeps_every_amount()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (_, root) = await PullAsync(Mukadam);
        var log = ArrayOf(root, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == OwnerLog);
        var content = log.GetProperty("content");
        var version = content.GetProperty("version").GetInt32();
        var sent = content.GetProperty("document").GetRawText();
        Output.WriteLine($"[EVIDENCE] the document the मुकादम was sent (v{version}): {sent}");

        // His phone holds exactly that: the record with no amount anywhere (removed here as well, so the
        // fact proves the server's carry-forward on its own, whatever the pull sent).
        var held = System.Text.Json.Nodes.JsonNode.Parse(sent)!;
        var item = held["inputs"]![0]!.AsObject();
        item.Remove("cost");
        item["numbers"]?.AsObject().Remove("cost");
        item["quantity"] = 3;
        var edited = held.ToJsonString();
        edited.Should().NotContain("777.73");

        var result = await PushAsync(Mukadam, "revise_log_content", "mu3-push-revise", new Dictionary<string, object?>
        {
            ["dailyLogId"] = OwnerLog,
            ["baseVersion"] = version,
            ["content"] = JsonDocument.Parse(edited).RootElement,
            ["reason"] = "दुरुस्ती",
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        result.Status.Should().Be("applied", "{0}: {1}", result.ErrorCode, result.ErrorMessage);

        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT document::text FROM ssf.daily_log_contents
            WHERE daily_log_id = @id ORDER BY content_version DESC LIMIT 1
            """;
        cmd.Parameters.AddWithValue("id", OwnerLog);
        var stored = (string)(await cmd.ExecuteScalarAsync())!;
        Output.WriteLine($"[EVIDENCE] stored after his edit: {stored}");
        using var doc = JsonDocument.Parse(stored);
        var input = doc.RootElement.GetProperty("inputs")[0];
        input.GetProperty("quantity").GetInt32().Should().Be(3, "his edit stands");
        input.GetProperty("cost").GetDecimal().Should().Be(OwnerInputCost, "the amount he was never shown is kept");
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }
}
