// spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b fix round 1) — founder D-33 / D-40 / D-46, CTO D-89
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.ReviseLogContent;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>Lane L4b fix round 1</b>, proved on real Postgres as the non-superuser <c>agrisync_app</c> role (doctrine E3).
/// <list type="number">
/// <item><b>H-1 / D-89.</b> The job-card read tells the phone whether its linked record is approved, so the phone can
/// show the payout step only when the server would let it pass, and say "काम मंजूर · पेआउट तपासा बाकी" truthfully.</item>
/// <item><b>M-2.</b> A शंका or a reopening correction that takes a "ready to pay" card back is audited
/// (<c>jobcard.payout-readiness-withdrawn</c>: the record, its new state, who), and the card says so.</item>
/// <item><b>L-2.</b> Two REAL handlers race: a <c>revise_log_content</c> held open while a confirmation of the old version
/// arrives. The confirmation waits for the row, then is refused as stale.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ApprovalFixRoundOneRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    // ─────────────────────────────────────────────────────────────────────────
    // H-1 — the job-card read says whether its record is approved
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_job_card_read_says_whether_its_linked_record_is_approved()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        var card = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f1-h1-create", Log(logId, Worker));
        await SeedJobCardAsync(card, logId, "Completed");

        var before = await CardJsonAsync(Owner, card);
        Output.WriteLine($"[EVIDENCE] H-1 before मंजूर: linkedDailyLogStatus={Prop(before, "linkedDailyLogStatus")}");
        Prop(before, "linkedDailyLogStatus").Should().Be("Draft");

        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-f1-h1-verify", Verify(logId, Owner, 1));
        var after = await CardJsonAsync(Owner, card);
        Output.WriteLine($"[EVIDENCE] H-1 after मंजूर: status={Prop(after, "status")} linkedDailyLogStatus={Prop(after, "linkedDailyLogStatus")}");
        Prop(after, "status").Should().Be("Completed", "D-33: the card is not made ready to pay by the मंजूर");
        Prop(after, "linkedDailyLogStatus").Should().Be("Verified", "the phone may now offer the payout check");
        Prop(after, "payoutCheckWithdrawn").Should().Be("False");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // M-2 — a withdrawn payout check is audited and said on the card
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_dispute_or_a_reopening_correction_that_withdraws_a_ready_to_pay_card_is_audited_and_shown()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // (a) a शंका on the approved record.
        var disputedLog = Guid.NewGuid();
        var disputedCard = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f1-m2-a", Log(disputedLog, Worker));
        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-f1-m2-a-verify", Verify(disputedLog, Owner, 1));
        await SeedJobCardAsync(disputedCard, disputedLog, "VerifiedForPayout");
        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-f1-m2-a-dispute", new Dictionary<string, object?>
        {
            ["logId"] = disputedLog,
            ["verifierUserId"] = Owner,
            ["decision"] = "dispute",
            ["reason"] = "मजूर कमी होते",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        });
        (await CardStatusAsync(disputedCard)).Should().Be("Completed");
        var disputeAudit = await WithdrawnAuditAsync(disputedCard);
        Output.WriteLine($"[EVIDENCE] M-2 शंका: audit={disputeAudit}");
        disputeAudit.Should().NotBeNull("taking a ready-to-pay card back is a decision the ledger records");
        disputeAudit!.Value.Actor.Should().Be(Owner);
        disputeAudit.Value.Payload.Should().Contain(disputedLog.ToString()).And.Contain("Disputed");
        Prop(await CardJsonAsync(Owner, disputedCard), "payoutCheckWithdrawn").Should().Be("True");

        // (b) a correction that re-opens the approved record (the owner adds work to the worker's day).
        var correctedLog = Guid.NewGuid();
        var correctedCard = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f1-m2-b", Log(correctedLog, Worker));
        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-f1-m2-b-verify", Verify(correctedLog, Owner, 1));
        await SeedJobCardAsync(correctedCard, correctedLog, "VerifiedForPayout");
        await PushAppliedAsync(Owner, "add_log_task", "l4b-f1-m2-b-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = correctedLog,
            ["activityType"] = "irrigation",
        });
        (await CardStatusAsync(correctedCard)).Should().Be("Completed");
        var correctionAudit = await WithdrawnAuditAsync(correctedCard);
        Output.WriteLine($"[EVIDENCE] M-2 correction: audit={correctionAudit}");
        correctionAudit.Should().NotBeNull();
        correctionAudit!.Value.Payload.Should().Contain(correctedLog.ToString()).And.Contain("Draft");
        Prop(await CardJsonAsync(Owner, correctedCard), "payoutCheckWithdrawn").Should().Be("True");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // L-2 — two real handlers race
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_real_correction_held_open_makes_a_real_confirmation_of_the_old_version_wait_then_be_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        var create = Log(logId, Worker);
        create["content"] = new
        {
            schema = 1,
            capturedAtUtc = "2026-10-30T05:00:00.000Z",
            irrigation = new object[] { new { id = "tm-irr-0", method = "Drip", source = "Well", durationHours = 2 } },
        };
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f1-l2-create", create);
        var versionBefore = await ContentVersionAsync(logId);

        // Writer 1: the REAL revise_log_content handler, under the owner's farm scope, its transaction held open.
        await using var correctionScope = HostServices.CreateAsyncScope();
        var sp = correctionScope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var db = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await db.Database.BeginTransactionAsync();
        (await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, Owner)).IsSuccess.Should().BeTrue();
        var revised = await sp.GetRequiredService<ReviseLogContentHandler>().HandleAsync(new ReviseLogContentCommand(
            logId,
            BaseVersion: 1,
            ContentJson: """{"schema":1,"capturedAtUtc":"2026-10-30T05:00:00.000Z","irrigation":[{"id":"tm-irr-0","method":"Drip","source":"Well","durationHours":3}]}""",
            Reason: "दुरुस्ती",
            ActorUserId: Owner,
            ActorRole: "PrimaryOwner",
            ClientRequestId: "l4b-f1-l2-revise",
            ClientAppVersion: "1.0.18"));
        revised.IsSuccess.Should().BeTrue("the real correction applies inside its open transaction: {0}", revised.Error?.ToString() ?? "-");

        // Writer 2: the REAL confirmation path (/sync/push → VerifyLogHandler) for the version the owner saw.
        var confirm = Task.Run(() => PushAsync(Owner, "verify_log_v2", "l4b-f1-l2-confirm", Verify(logId, Owner, versionBefore)));
        var finishedEarly = await Task.WhenAny(confirm, Task.Delay(TimeSpan.FromSeconds(2))) == confirm;

        await tx.CommitAsync();
        var result = await confirm;
        var versionAfter = await ContentVersionAsync(logId);
        Output.WriteLine($"[EVIDENCE] L-2 real handlers: finishedEarly={finishedEarly} confirm={result.Status} {result.ErrorCode} version {versionBefore}->{versionAfter}");

        finishedEarly.Should().BeFalse("the confirmation waits for the correction holding the record");
        versionAfter.Should().Be(versionBefore + 1);
        result.ErrorCode.Should().Be("ShramSafal.LogVersion.Conflict");
        (await VerifiedCountAsync(logId)).Should().Be(0, "nothing is confirmed on the older version");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fix round 2 — L-a / L-f: a record kept from the reader names nothing on its card
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_card_whose_record_is_kept_from_the_reader_names_neither_its_state_nor_a_withdrawn_check()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        var card = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "l4b-f2-la-create", Log(logId, Owner));
        await SeedJobCardAsync(card, logId, "Completed");
        await SeedWithdrawnAuditAsync(card, logId);
        await SetAudienceAsync(Owner, "DailyLog", logId, "OnlyMe");
        // A second card whose record the co-owner DOES see: the farm's list then has links to read for him too.
        var openLog = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f2-la-open", Log(openLog, Worker));
        await SeedJobCardAsync(Guid.NewGuid(), openLog, "Completed");

        // Control: the record's own audience (the owner) sees the state and the withdrawn check.
        var owners = await CardJsonAsync(Owner, card);
        Prop(owners, "linkedDailyLogId").Should().Be(logId.ToString());
        Prop(owners, "linkedDailyLogStatus").Should().Be("Draft");
        Prop(owners, "payoutCheckWithdrawn").Should().Be("True");

        // A co-owner outside the record's audience: no link, so no state and no hint that it was questioned.
        var coOwners = await CardJsonAsync(CoOwner, card);
        Output.WriteLine($"[EVIDENCE] L-a co-owner: link={Prop(coOwners, "linkedDailyLogId")} status={Prop(coOwners, "linkedDailyLogStatus")} withdrawn={Prop(coOwners, "payoutCheckWithdrawn")}");
        Prop(coOwners, "linkedDailyLogId").Should().BeNull("PRV: the card never names a record kept from him");
        Prop(coOwners, "linkedDailyLogStatus").Should().BeNull();
        Prop(coOwners, "payoutCheckWithdrawn").Should().Be("False", "a withdrawn check would say a hidden record was questioned");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fix round 2 — L-e: a job-card refusal carries its code
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_refused_payout_check_says_why_by_its_code()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // (a) the record is kept from him: he holds review money, but may not see the record behind the card.
        var hiddenLog = Guid.NewGuid();
        var hiddenCard = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "l4b-f2-le-hidden", Log(hiddenLog, Owner));
        await SeedJobCardAsync(hiddenCard, hiddenLog, "Completed");
        await SetAudienceAsync(Owner, "DailyLog", hiddenLog, "OnlyMe");
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ReviewMoney,
            FarmAuthority.ConfirmRecords);
        var (closedStatus, closedBody) = await VerifyForPayoutAsync(CoOwner, hiddenCard);
        Output.WriteLine($"[EVIDENCE] L-e record closed: {closedStatus} {closedBody}");
        closedStatus.Should().Be(HttpStatusCode.Forbidden);
        closedBody.Should().Contain("ShramSafal.RecordAudience.Forbidden", "the phone says the record-closed words by this code");

        // (b) a seat without review money.
        var openLog = Guid.NewGuid();
        var openCard = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-f2-le-open", Log(openLog, Worker));
        await SeedJobCardAsync(openCard, openLog, "Completed");
        var (roleStatus, roleBody) = await VerifyForPayoutAsync(Mukadam, openCard);
        Output.WriteLine($"[EVIDENCE] L-e role: {roleStatus} {roleBody}");
        roleStatus.Should().Be(HttpStatusCode.Forbidden);
        roleBody.Should().Contain("ShramSafal.JobCardRoleNotAllowed");
    }

    // ── Harness ─────────────────────────────────────────────────────────────────────────

    private async Task<(HttpStatusCode Status, string Body)> VerifyForPayoutAsync(Guid user, Guid cardId)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/job-cards/{cardId}/verify-for-payout", user);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task SetAudienceAsync(Guid actor, string kind, Guid recordId, string audience)
    {
        var result = await PushAsync(actor, "set_record_audience", $"l4b-f2-aud-{recordId:N}-{audience}", new Dictionary<string, object?>
        {
            ["recordKind"] = kind,
            ["recordId"] = recordId,
            ["audience"] = audience,
            ["selectedUserIds"] = Array.Empty<Guid>(),
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        result.Status.Should().Be("applied", "{0} -> {1}: {2}", recordId, audience, result.ErrorCode ?? "-");
    }

    private async Task SeedWithdrawnAuditAsync(Guid cardId, Guid logId)
    {
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.audit_events
                ("Id", farm_id, entity_type, entity_id, action, actor_user_id, actor_role,
                 payload, occurred_at_utc, client_command_id, app_version, device_id, ip_hash)
            VALUES (@id, @farm, 'JobCard', @card, 'jobcard.payout-readiness-withdrawn', @actor, 'PrimaryOwner',
                    @payload, NOW(), NULL, 'test', 'test-device', 'sha256:test');
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmA);
        cmd.Parameters.AddWithValue("card", cardId);
        cmd.Parameters.AddWithValue("actor", Owner);
        cmd.Parameters.AddWithValue("payload", $"{{\"jobCardId\":\"{cardId}\",\"dailyLogId\":\"{logId}\",\"recordState\":\"Disputed\"}}");
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<JsonElement> CardJsonAsync(Guid user, Guid cardId)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{FarmA}/job-cards", user);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return JsonDocument.Parse(body).RootElement.EnumerateArray()
            .Single(c => c.GetProperty("id").GetGuid() == cardId).Clone();
    }

    private static string? Prop(JsonElement card, string name) =>
        card.TryGetProperty(name, out var v)
            ? v.ValueKind switch
            {
                JsonValueKind.String => v.GetString(),
                JsonValueKind.True => "True",
                JsonValueKind.False => "False",
                JsonValueKind.Null => null,
                _ => v.GetRawText(),
            }
            : "<absent>";

    private async Task SeedJobCardAsync(Guid cardId, Guid logId, string status)
    {
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, assigned_worker_user_id, planned_date,
                                       status, created_at_utc, modified_at_utc, started_at_utc, completed_at_utc, linked_daily_log_id, line_items)
            VALUES (@id, @farm, @plot, @cycle, @owner, @worker, DATE '2026-10-30', @status, NOW(), NOW(), NOW(), NOW(), @log,
                    '[{"activityType":"spray","expectedHours":4,"rateAmount":500,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
            """;
        cmd.Parameters.AddWithValue("id", cardId);
        cmd.Parameters.AddWithValue("farm", FarmA);
        cmd.Parameters.AddWithValue("plot", PlotA);
        cmd.Parameters.AddWithValue("cycle", CycleA);
        cmd.Parameters.AddWithValue("owner", Owner);
        cmd.Parameters.AddWithValue("worker", Worker);
        cmd.Parameters.AddWithValue("status", status);
        cmd.Parameters.AddWithValue("log", logId);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task<string> CardStatusAsync(Guid cardId) =>
        (string)(await ScalarAsync("SELECT status FROM ssf.job_cards WHERE id = @id", cardId))!;

    private async Task<int> ContentVersionAsync(Guid logId) =>
        Convert.ToInt32(await ScalarAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId));

    private async Task<long> VerifiedCountAsync(Guid logId) =>
        Convert.ToInt64(await ScalarAsync("SELECT count(*) FROM ssf.verification_events WHERE daily_log_id = @id AND status = 'Verified'", logId));

    private async Task<(Guid Actor, string Payload)?> WithdrawnAuditAsync(Guid cardId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT actor_user_id, payload::text FROM ssf.audit_events
            WHERE entity_id = @id AND action = 'jobcard.payout-readiness-withdrawn' ORDER BY occurred_at_utc DESC LIMIT 1
            """;
        cmd.Parameters.AddWithValue("id", cardId);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;
        return (reader.GetGuid(0), reader.GetString(1));
    }

    private static Dictionary<string, object?> Log(Guid id, Guid maker) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["plotId"] = PlotA,
        ["cropCycleId"] = CycleA,
        ["operatorUserId"] = maker,
        ["logDate"] = WorkDay,
        ["autoSavedFromVoice"] = true,
    };

    private static Dictionary<string, object?> Verify(Guid logId, Guid verifier, int logVersion) => new()
    {
        ["logId"] = logId,
        ["verifierUserId"] = verifier,
        ["decision"] = "verify",
        ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        ["reviewBasis"] = "read",
        ["logVersion"] = logVersion,
    };
}
