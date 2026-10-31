// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, AC2 + AC5) — proven over the REAL pipeline as the
// non-superuser app role (same harness as the other part of this class):
//   SEC-2 bypass   — a stopped person withdrew his own waiting request, then scanned again: Active.
//   demotion       — a role change kept the old role's stored powers (and the labour grant).
//   money (M-5)    — recording a purchase stays open to every Active member; CORRECTING money is
//                    the AddCost permission, which a co-owner label does not carry (D-22, M-3).
//   planning (M-4) — the crop-schedule doors keep today's rule (role >= Mukadam): the PlanWork
//                    permission is for D-24 tasks, and the schedule integration is on hold (D-24e2).
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public sealed partial class MembershipLifecycleRoutesRealPostgresTests
{
    private static readonly Guid Cycle = Guid.Parse("e2f30001-0000-0000-0000-0000000000c9");

    /// <summary>
    /// SEC-2, all three ways the owner stops someone (pause-then-leave, removal, decline), each
    /// followed by the person withdrawing his OWN waiting request ("विनंती मागे घ्या") and scanning
    /// the farm QR again. Before the fix the withdrawn request — the newest ended seat — hid the
    /// owner's stop and the second scan made a fresh Active seat that read the whole farm.
    /// </summary>
    [Fact]
    public async Task SEC2_withdrawing_his_own_waiting_request_never_reopens_the_farm_QR_for_a_person_the_owner_stopped()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var (token, farmCode) = await IssueQrAsync();

        // A — paused, left, re-scanned (waits), withdrew.
        await DecideOkAsync(HttpMethod.Post, $"{Worker}/suspend", Owner, new { reason = "थांबा" });
        await SelfExitAsync(Worker);
        (await ClaimAsync(Worker, token, farmCode)).Should().Be("PendingApproval", "arrange: the direct re-scan already waits");
        await SelfExitAsync(Worker);

        // B — removed, TYPED the farm code (waits), withdrew.
        await DecideOkAsync(HttpMethod.Post, $"{Worker2}/remove", Owner, new { reason = "x" });
        await JoinAndExpectPendingAsync(Worker2);
        await SelfExitAsync(Worker2);

        // C — declined, typed the code again (waits), withdrew.
        await JoinAndExpectPendingAsync(Joiner);
        await DecideOkAsync(HttpMethod.Post, $"{Joiner}/decline", Owner, new { reason = "ओळखत नाही" });
        await JoinAndExpectPendingAsync(Joiner);
        await SelfExitAsync(Joiner);

        foreach (var stopped in new[] { Worker, Worker2, Joiner })
        {
            (await LiveSeatAsync(Farm, stopped)).Should().BeNull("arrange: his own request was withdrawn");
            var status = await ClaimAsync(stopped, token, farmCode);
            Output.WriteLine($"[EVIDENCE] stopped {stopped}, withdrew his request, scanned the QR again: {status}");
            status.Should().Be("PendingApproval", "the owner's stop outlives a request the person ended himself");
            (await LiveSeatAsync(Farm, stopped))!.Status.Should().Be(2);
            AssertNothingOfTheFarm(await PullAsync(stopped), "a waiting re-scan reads nothing");
        }

        // As often as he tries: withdraw again, scan again — still a request.
        await SelfExitAsync(Worker);
        (await ClaimAsync(Worker, token, farmCode)).Should().Be("PendingApproval");

        // CONTROL: once the OWNER lets him in again, leaving later on his own is no stop — the QR
        // lets him straight back, exactly as for anyone who left on his own.
        await DecideOkAsync(HttpMethod.Post, $"{Worker}/approve", Owner, new { role = "Worker" });
        (await PullAsync(Worker)).Should().Contain(FarmName);
        await SelfExitAsync(Worker);
        (await ClaimAsync(Worker, token, farmCode)).Should().Be("Active");
        (await PullAsync(Worker)).Should().Contain(FarmName);
    }

    /// <summary>
    /// The phone's exact calls: approve काम + हजेरी, the primary owner stores a power for him over
    /// the API, then picks काम सांगणे. The person must be a plain worker afterwards — no stored
    /// powers, no हजेरी व पक्कं. An older body that names only the role is reset the same way.
    /// </summary>
    [Fact]
    public async Task Moving_a_person_to_another_choice_over_PUT_access_takes_the_old_choices_powers_away()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await JoinAndExpectPendingAsync(Joiner);

        await DecideOkAsync(HttpMethod.Post, $"{Joiner}/approve", Owner, new { role = "Mukadam", grantLabour = true });
        (await LiveSeatAsync(Farm, Joiner))!.LabourGrant.Should().BeTrue("arrange: काम + हजेरी");
        await DecideOkAsync(HttpMethod.Put, $"{Joiner}/access", Owner, new { permissions = new[] { "AddCost" } });
        // lane 2b: the named set is the whole stored set; reviewing money brings seeing money (§11.1).
        (await LiveSeatAsync(Farm, Joiner))!.Permissions.Should().Be(1 | 4, "arrange: the primary owner's explicit choice is stored");

        using (var doc = await DecideOkAsync(HttpMethod.Put, $"{Joiner}/access", Owner,
                   new { role = "Worker", resetPermissions = true, labourGrant = false }))
        {
            doc.RootElement.GetProperty("role").GetString().Should().Be("Worker");
            doc.RootElement.GetProperty("permissions").GetArrayLength().Should().Be(0);
            doc.RootElement.GetProperty("canManageLabourRecords").GetBoolean().Should().BeFalse();
        }

        var demoted = await LiveSeatAsync(Farm, Joiner);
        demoted!.Role.Should().Be("Worker");
        demoted.Permissions.Should().BeNull("a new role starts from ITS defaults");
        demoted.LabourGrant.Should().BeFalse();

        var changes = await AuditPayloadsAsync(Farm, "MemberAccessChanged");
        changes.Should().HaveCount(2);
        changes[1].GetProperty("toRole").GetString().Should().Be("Worker");
        changes[1].GetProperty("permissions").GetArrayLength().Should().Be(0);

        // An older body that names ONLY the role (the shape that kept every power before the fix).
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { permissions = new[] { "AddCost" } });
        (await LiveSeatAsync(Farm, Worker3))!.Permissions.Should().Be(1 | 4, "review money brings see money (2b)");
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Worker" });
        var plain = await LiveSeatAsync(Farm, Worker3);
        plain!.Role.Should().Be("Worker");
        plain.Permissions.Should().BeNull("the server resets on a role change even when the body names only the role");
        plain.LabourGrant.Should().BeFalse("a मुकादम moved to काम सांगणे loses हजेरी व पक्कं with the role");
    }

    /// <summary>
    /// M-5 + M-3: every Active member RECORDS a purchase (worker, मुकादम, co-owner alike — the
    /// phone's add_cost_entry push). CORRECTING a cost is the AddCost permission: the primary owner
    /// always; a co-owner only once the primary owner stored it for him (a co-owner label grants
    /// nothing by itself, D-22).
    /// </summary>
    [Fact]
    public async Task Every_active_member_records_a_purchase_but_correcting_money_needs_the_primary_owners_say()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });

        foreach (var who in new[] { Worker, Worker3, Family })
        {
            var cost = Guid.NewGuid();
            var pushed = await PushCostAsync(who, cost, $"record-{who:N}");
            Output.WriteLine($"[EVIDENCE] {who} add_cost_entry: {pushed.Status} {pushed.ErrorCode}");
            pushed.Status.Should().Be("applied", $"every Active member records a purchase: {pushed.ErrorCode} {pushed.ErrorMessage}");
            (await CostRowExistsAsync(cost)).Should().BeTrue();
        }

        var coOwnerRefused = await PushCorrectionAsync(Family, 4000m);
        Output.WriteLine($"[EVIDENCE] co-owner correct_cost_entry (no AddCost stored): {coOwnerRefused.Status} {coOwnerRefused.ErrorCode}");
        coOwnerRefused.Status.Should().Be("failed", "a co-owner label grants no money power (D-22)");
        coOwnerRefused.ErrorCode.Should().EndWith("Forbidden");
        (await CorrectionCountAsync()).Should().Be(0);

        // CONTROLS: the primary owner corrects; once he stores AddCost for the co-owner, so may he.
        (await PushCorrectionAsync(Owner, 4100m)).Status.Should().Be("applied");
        await DecideOkAsync(HttpMethod.Put, $"{Family}/access", Owner, new { permissions = new[] { "AddCost" } });
        var allowed = await PushCorrectionAsync(Family, 4200m);
        allowed.Status.Should().Be("applied", $"{allowed.ErrorCode} {allowed.ErrorMessage}");
        (await CorrectionCountAsync()).Should().Be(2);
    }

    /// <summary>M-4: adding a crop-schedule activity (the door the phone's "add to plan" uses)
    /// keeps today's rule — a मुकादम or above plans, a worker does not — with no PlanWork switch.</summary>
    [Fact]
    public async Task Planning_a_schedule_activity_keeps_todays_rule_mukadam_or_above()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var refusedId = Guid.NewGuid();
        using (var refused = await PlanAsync(Worker, refusedId))
        {
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, await refused.Content.ReadAsStringAsync());
        }

        (await PlannedActivityExistsAsync(refusedId)).Should().BeFalse();

        await DecideOkAsync(HttpMethod.Put, $"{Worker3}/access", Owner, new { role = "Mukadam", resetPermissions = true, labourGrant = true });
        // lane 2b: plan work is STORED only (L8 enforces it) - none is stored for him, and today's
        // rule still lets him plan. (The switch stores confirm records, 128, nothing else.)
        ((await LiveSeatAsync(Farm, Worker3))!.Permissions ?? 0).Should().Be(128, "no PlanWork is stored for him");
        foreach (var who in new[] { Worker3, Owner })
        {
            var id = Guid.NewGuid();
            using var allowed = await PlanAsync(who, id);
            allowed.StatusCode.Should().Be(HttpStatusCode.Created, await allowed.Content.ReadAsStringAsync());
            (await PlannedActivityExistsAsync(id)).Should().BeTrue();
        }
    }

    // -- Harness (this part) ------------------------------------------------------

    /// <summary>One owner decision that must land: 200, and the server's row.</summary>
    private async Task<JsonDocument> DecideOkAsync(HttpMethod method, string path, Guid caller, object body)
    {
        using var response = await SendAsync(method, $"/shramsafal/farms/{Farm}/memberships/{path}", caller, body);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"{method} {path}: {text}");
        return JsonDocument.Parse(text);
    }

    private async Task SelfExitAsync(Guid who)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{Farm}/memberships/self-exit", who);
        response.StatusCode.Should().Be(HttpStatusCode.OK, await response.Content.ReadAsStringAsync());
    }

    /// <summary>The phone's own correction push for the seeded cost.</summary>
    private async Task<PushOutcome> PushCorrectionAsync(Guid who, decimal amount)
    {
        var requestId = $"correct-{Guid.NewGuid():N}";
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    clientCommandId = requestId,
                    mutationType = "correct_cost_entry",
                    payload = new Dictionary<string, object?>
                    {
                        ["costEntryId"] = SeededCost, ["correctedAmount"] = amount,
                        ["currencyCode"] = "INR", ["reason"] = "probe correction",
                    },
                },
            },
        };

        using var response = await SendAsync(HttpMethod.Post, "/sync/push", who, request);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var result = doc.RootElement.GetProperty("results").EnumerateArray().Single();
        return new PushOutcome(
            result.GetProperty("status").GetString()!,
            result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null,
            result.TryGetProperty("errorMessage", out var msg) && msg.ValueKind == JsonValueKind.String ? msg.GetString() : null);
    }

    private async Task<long> CorrectionCountAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id";
        cmd.Parameters.AddWithValue("id", SeededCost);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>The actor_role of every owner-decision audit row on the farm, oldest first.</summary>
    private async Task<List<string>> AuditActorRolesAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT actor_role FROM ssf.audit_events WHERE farm_id = @f AND action IN
              ('MemberApproved','MemberDeclined','MemberSuspended','MemberRestored','MemberRemoved','MemberAccessChanged')
            ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("f", farm);
        var roles = new List<string>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            roles.Add(r.GetString(0));
        }

        return roles;
    }

    /// <summary>The owner's roster (GET labour-permissions) as raw text.</summary>
    private async Task<string> RosterTextAsync()
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{Farm}/labour-permissions", Owner);
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, text);
        return text;
    }

    /// <summary>One person's row on the owner's roster.</summary>
    private async Task<JsonElement> RosterRowAsync(Guid who)
    {
        using var doc = JsonDocument.Parse(await RosterTextAsync());
        return doc.RootElement.EnumerateArray().Single(r => r.GetProperty("userId").GetGuid() == who).Clone();
    }

    private Task<HttpResponseMessage> PlanAsync(Guid who, Guid activityId) =>
        SendAsync(HttpMethod.Post, "/shramsafal/planned-activities", who, new
        {
            cropCycleId = Cycle,
            farmId = Farm,
            activityName = "Probe spray",
            stage = "Vegetative",
            plannedDate = DateTime.UtcNow.ToString("yyyy-MM-dd"),
            reason = "probe",
            newActivityId = activityId,
        });

    private async Task<bool> PlannedActivityExistsAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.planned_activities WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync()) > 0;
    }

    private static Task SeedCropCycleAsync(NpgsqlConnection db)
        => ExecAsync(db, """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """,
            ("id", Cycle), ("farm", Farm), ("plot", Plot), ("start", new DateTime(2026, 1, 1)));
}
