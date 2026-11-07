// spec: plr-d10-redesign-real-integration-2026-10-25 (I28, lane L4b) — founder D-3 / D-40 / D-46
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
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Farms;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>Lane L4b — one approval path</b>, proved on real Postgres as the non-superuser <c>agrisync_app</c> role
/// (doctrine E3), through the real host (<c>GET /shramsafal/farms/{farm}/labour</c>, the list and count every door of
/// the phone reads) and the real <c>/sync/push</c> (the one <c>VerifyLogHandler</c> every door sends to).
///
/// <list type="number">
/// <item><b>One count per farm</b> (D-40 §1): the number awaiting this person's मंजूर is the size of the list he
/// receives, for the selected farm only, and it never counts a record he may not see (MU-3 role, MU-4 plots, PRV
/// audience).</item>
/// <item><b>The exact version</b> (D-40 §3, D-46 §3): a confirmation naming an older version is refused with
/// <c>ShramSafal.LogVersion.Conflict</c>; the list then carries the new version, and that one is approvable.</item>
/// <item><b>The race</b> (L6 review S7): a correction landing while a confirmation is in flight, or a confirmation
/// landing while a correction is in flight, never leaves Verified standing on an older version.</item>
/// <item><b>शंका needs a reason</b>; a मंजूर does not.</item>
/// <item><b>Bulk</b> (D-40 §4): a batch of selected confirmations confirms only the eligible ones it names.</item>
/// <item><b>P11</b>: 1.0.17's approval (v1 <c>verify_log</c>, no version) of a record that changed is answered with
/// success and records the version the server held.</item>
/// <item><b>D-33</b> (founder, verbatim: "मंजूर no longer moves a काम कार्ड to 'ready to pay'"): approving a record from
/// any phone leaves its job card's payment state unchanged, and a card already ready to pay stays exactly as it was.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OneApprovalPathRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid PlotTwo = Guid.Parse("4b040000-0000-4000-8000-0000000000c1");
    private static readonly Guid CycleTwo = Guid.Parse("4b040000-0000-4000-8000-0000000000c2");
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    // ─────────────────────────────────────────────────────────────────────────
    // 1. ONE COUNT PER FARM, HONOURING MU-3 / MU-4 / PRV
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task One_count_per_farm_is_the_list_he_receives_and_never_counts_a_record_he_may_not_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AddSecondPlotAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.ConfirmRecords);

        var onPlotA = Guid.NewGuid();
        var onPlotTwo = Guid.NewGuid();
        var mukadamOwn = Guid.NewGuid();
        var privateOne = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-c1", Log(onPlotA, Worker, PlotA, CycleA));
        await PushAppliedAsync(Worker2, "create_daily_log", "l4b-c2", Log(onPlotTwo, Worker2, PlotTwo, CycleTwo));
        await PushAppliedAsync(Mukadam, "create_daily_log", "l4b-c3", Log(mukadamOwn, Mukadam, PlotA, CycleA));
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-c4", Log(privateOne, Worker, PlotA, CycleA));
        // PRV — the owner keeps one record to the co-owner only.
        await PushAppliedAsync(Owner, "set_record_audience", "l4b-c4-audience", new Dictionary<string, object?>
        {
            ["recordKind"] = "DailyLog",
            ["recordId"] = privateOne,
            ["audience"] = "Selected",
            ["selectedUserIds"] = new[] { CoOwner },
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        // MU-4 — the मुकादम covers plot A only.
        using (var scoped = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{Mukadam}/plot-scope", Owner,
                   new { plotScope = "ChosenPlots", plotIds = new[] { PlotA } }))
        {
            scoped.StatusCode.Should().Be(HttpStatusCode.OK, await scoped.Content.ReadAsStringAsync());
        }

        // The primary owner: every record of HIS farm awaiting him, and nothing of another farm.
        var owner = await QueueAsync(Owner, FarmA);
        Output.WriteLine($"[EVIDENCE] owner farm A: pending={owner.Pending} ids={owner.Ids.Count} canConfirm={owner.CanConfirm}");
        owner.CanConfirm.Should().BeTrue();
        owner.Ids.Should().Contain([onPlotA, onPlotTwo, mukadamOwn, privateOne]);
        owner.Ids.Should().NotContain(FarmBLog, "one count per SELECTED farm");
        owner.Pending.Should().Be(owner.Ids.Count, "the count is the list he receives, record by record");
        owner.Ids.Should().OnlyHaveUniqueItems("records, never detail rows");

        // The मुकादम who may confirm, on plot A only, without the private record: his count is his list.
        var mukadam = await QueueAsync(Mukadam, FarmA);
        Output.WriteLine($"[EVIDENCE] मुकादम (plot A, confirm): pending={mukadam.Pending} ids={string.Join(',', mukadam.Ids)}");
        mukadam.CanConfirm.Should().BeTrue();
        mukadam.Ids.Should().Contain([onPlotA, mukadamOwn]);
        mukadam.Ids.Should().NotContain(onPlotTwo, "MU-4: a record on a plot he does not cover is not counted for him");
        mukadam.Ids.Should().NotContain(privateOne, "PRV: a record kept from him is not counted for him");
        mukadam.Pending.Should().Be(mukadam.Ids.Count);

        // A worker (MU-3, no confirm right): no confirming, and the list never names another person's record.
        var worker = await QueueAsync(Worker, FarmA);
        Output.WriteLine($"[EVIDENCE] कामगार: canConfirm={worker.CanConfirm} pending={worker.Pending}");
        worker.CanConfirm.Should().NotBe(true, "the phone shows no मंजुरीसाठी count to someone who may not confirm");
        worker.Ids.Should().NotContain([onPlotTwo, mukadamOwn], "MU-3: never another person's record");
        worker.Pending.Should().Be(worker.Ids.Count);

        // Another farm's owner: his farm's records only.
        var other = await QueueAsync(OwnerB, FarmB);
        other.Ids.Should().NotContain([onPlotA, onPlotTwo, mukadamOwn, privateOne]);
        other.Pending.Should().Be(other.Ids.Count);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. THE EXACT VERSION
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_stale_version_is_refused_and_the_new_version_is_listed_and_approvable()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-v-create", Log(logId, Worker, PlotA, CycleA));
        (await QueueAsync(Owner, FarmA)).VersionOf(logId).Should().Be(1);

        // A correction moves the version on while the owner still looks at version 1.
        await PushAppliedAsync(Owner, "add_log_task", "l4b-v-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "irrigation",
        });

        var stale = await PushAsync(Owner, "verify_log_v2", "l4b-v-stale", Verify(logId, Owner, 1));
        Output.WriteLine($"[EVIDENCE] confirm of version 1 after a correction -> {stale.Status} {stale.ErrorCode}");
        stale.Status.Should().Be("failed");
        stale.ErrorCode.Should().Be("ShramSafal.LogVersion.Conflict");
        (await EventsAsync(logId)).Should().NotContain(e => e.Status == "Verified");

        var before = await QueueAsync(Owner, FarmA);
        before.VersionOf(logId).Should().Be(2, "the list now carries the new version for him to look at");

        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-v-new", Verify(logId, Owner, 2));
        var verified = (await EventsAsync(logId)).Single(e => e.Status == "Verified");
        verified.Version.Should().Be(2, "the confirmation names the version he saw");

        var after = await QueueAsync(Owner, FarmA);
        after.Ids.Should().NotContain(logId);
        after.Pending.Should().Be(before.Pending - 1, "approving once updates the one count");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. THE RACE (L6 review S7) — two concurrent writes
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_correction_landing_during_a_confirmation_never_leaves_Verified_on_the_older_version()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-race1-create", Log(logId, Worker, PlotA, CycleA));

        // Writer 1: a correction of the record, holding the row and moving its version to 2, not yet committed.
        await using var correction = new NpgsqlConnection(SuperuserConn);
        await correction.OpenAsync();
        await using var tx = await correction.BeginTransactionAsync();
        await ExecAsync(correction, tx, "SELECT 1 FROM ssf.daily_logs WHERE \"Id\" = @id FOR UPDATE", ("id", logId));
        await ExecAsync(correction, tx, "UPDATE ssf.daily_logs SET content_version = content_version + 1 WHERE \"Id\" = @id", ("id", logId));

        // Writer 2: the owner's confirmation of version 1, sent while writer 1 is in flight.
        var confirm = Task.Run(() => PushAsync(Owner, "verify_log_v2", "l4b-race1-confirm", Verify(logId, Owner, 1)));
        var finishedEarly = await Task.WhenAny(confirm, Task.Delay(TimeSpan.FromSeconds(2))) == confirm;
        Output.WriteLine($"[EVIDENCE] confirmation finished while the correction held the row: {finishedEarly}");

        await tx.CommitAsync();
        var result = await confirm;
        var events = await EventsAsync(logId);
        var version = await ContentVersionAsync(logId);
        Output.WriteLine($"[EVIDENCE] confirmation -> {result.Status} {result.ErrorCode}; content_version={version}; events={Describe(events)}");

        finishedEarly.Should().BeFalse("the confirmation waits for the correction holding the record");
        result.ErrorCode.Should().Be("ShramSafal.LogVersion.Conflict", "it then reads version 2, not the version 1 it was sent for");
        events.Should().NotContain(e => e.Status == "Verified" && e.Version != version);
    }

    [Fact]
    public async Task A_confirmation_landing_during_a_correction_is_re_opened_by_that_correction()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-race2-create", Log(logId, Worker, PlotA, CycleA));

        // Writer 1: the owner's confirmation of version 1, holding the row, not yet committed.
        await using var confirmation = new NpgsqlConnection(SuperuserConn);
        await confirmation.OpenAsync();
        await using var tx = await confirmation.BeginTransactionAsync();
        await ExecAsync(confirmation, tx, "SELECT 1 FROM ssf.daily_logs WHERE \"Id\" = @id FOR UPDATE", ("id", logId));
        await ExecAsync(confirmation, tx, """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, reason, verified_by_user_id, occurred_at_utc, confirmed_log_version, review_basis)
            VALUES (gen_random_uuid(), @id, 'Confirmed', NULL, @owner, clock_timestamp(), NULL, NULL),
                   (gen_random_uuid(), @id, 'Verified', NULL, @owner, clock_timestamp() + interval '1 millisecond', 1, 'read');
            UPDATE ssf.daily_logs SET modified_at_utc = now() WHERE "Id" = @id;
            """, ("id", logId), ("owner", Owner));

        // Writer 2: a correction (the owner adds work to the worker's day) while writer 1 is in flight.
        var correct = Task.Run(() => PushAsync(Owner, "add_log_task", "l4b-race2-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "irrigation",
        }));
        var finishedEarly = await Task.WhenAny(correct, Task.Delay(TimeSpan.FromSeconds(2))) == correct;

        await tx.CommitAsync();
        var result = await correct;
        var events = await EventsAsync(logId);
        var version = await ContentVersionAsync(logId);
        Output.WriteLine($"[EVIDENCE] correction -> {result.Status} {result.ErrorCode}; content_version={version}; finishedEarly={finishedEarly}; events={Describe(events)}");

        result.Status.Should().Be("applied", "the correction is never lost");
        version.Should().Be(2);
        finishedEarly.Should().BeFalse("the correction waits for the confirmation holding the record");
        events[^1].Status.Should().NotBe("Verified", "a confirmation of version 1 must not stand over version 2");
        (await QueueAsync(Owner, FarmA)).VersionOf(logId).Should().Be(2, "the record returns to the owner's list at its new version");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. शंका NEEDS A REASON
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_dispute_without_a_reason_is_refused_and_one_with_a_reason_is_kept_with_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-d-create", Log(logId, Worker, PlotA, CycleA));

        foreach (var (key, reason) in new[] { ("none", (string?)null), ("blank", "   ") })
        {
            var refused = await PushAsync(Owner, "verify_log_v2", $"l4b-d-{key}", Dispute(logId, Owner, reason));
            Output.WriteLine($"[EVIDENCE] शंका with reason '{reason ?? "<none>"}' -> {refused.Status} {refused.ErrorCode}");
            refused.Status.Should().Be("failed");
            refused.ErrorCode.Should().Be("ShramSafal.InvalidVerificationReason");
        }

        (await EventsAsync(logId)).Should().NotContain(e => e.Status == "Disputed");

        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-d-reason", Dispute(logId, Owner, "मजूर ५ नव्हते, ४ होते"));
        var disputed = (await EventsAsync(logId)).Single(e => e.Status == "Disputed");
        disputed.Reason.Should().Be("मजूर ५ नव्हते, ४ होते", "his own words are kept with the शंका");
        (await QueueAsync(Owner, FarmA)).Ids.Should().NotContain(logId, "a disputed record leaves the list awaiting मंजूर");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. BULK — ONLY THE SELECTED, ONLY THE ELIGIBLE
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_batch_of_selected_confirmations_confirms_only_the_eligible_records_it_names()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var eligible = Guid.NewGuid();
        var changed = Guid.NewGuid();
        var disputed = Guid.NewGuid();
        var notSelected = Guid.NewGuid();
        foreach (var (id, key) in new[] { (eligible, "e"), (changed, "c"), (disputed, "d"), (notSelected, "n") })
        {
            await PushAppliedAsync(Worker, "create_daily_log", $"l4b-b-{key}", Log(id, Worker, PlotA, CycleA));
        }

        await PushAppliedAsync(Owner, "add_log_task", "l4b-b-changed", new Dictionary<string, object?>
        {
            ["dailyLogId"] = changed,
            ["activityType"] = "irrigation",
        });
        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-b-dispute", Dispute(disputed, Owner, "काम अपूर्ण"));

        var results = await PushBatchAsync(Owner,
            ("l4b-b-1", "verify_log_v2", Verify(eligible, Owner, 1)),
            ("l4b-b-2", "verify_log_v2", Verify(changed, Owner, 1)),
            ("l4b-b-3", "verify_log_v2", Verify(disputed, Owner, 1)));
        Output.WriteLine($"[EVIDENCE] batch -> {string.Join(" | ", results.Select(r => $"{r.ClientRequestId}:{r.Status}:{r.ErrorCode}"))}");

        results.Single(r => r.ClientRequestId == "l4b-b-1").Status.Should().Be("applied");
        results.Single(r => r.ClientRequestId == "l4b-b-2").ErrorCode.Should().Be("ShramSafal.LogVersion.Conflict");
        results.Single(r => r.ClientRequestId == "l4b-b-3").Status.Should().Be("failed", "a disputed record is never bulk-confirmed");

        (await EventsAsync(eligible)).Should().Contain(e => e.Status == "Verified" && e.Version == 1);
        (await EventsAsync(changed)).Should().NotContain(e => e.Status == "Verified");
        (await EventsAsync(disputed)).Should().NotContain(e => e.Status == "Verified");
        (await EventsAsync(notSelected)).Should().NotContain(e => e.Status == "Verified", "a record he did not select is untouched");
        (await QueueAsync(Owner, FarmA)).Ids.Should().Contain([changed, notSelected]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. P11 — 1.0.17 approving a record that changed since it was shown
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_installed_1_0_17_approval_of_a_changed_record_is_answered_and_records_the_version_held()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-p11-create", Log(logId, Worker, PlotA, CycleA));
        await PushAppliedAsync(Owner, "add_log_task", "l4b-p11-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "irrigation",
        });

        // 1.0.17's review sheet: verify_log (v1) confirmed, then verified — no version, no basis (its exact wire).
        var results = await PushBatchAsync(Owner,
            ("l4b-p11-confirm", "verify_log", V1(logId, Owner, "confirmed")),
            ("l4b-p11-verify", "verify_log", V1(logId, Owner, "verified")));
        Output.WriteLine($"[EVIDENCE] 1.0.17 approval -> {string.Join(" | ", results.Select(r => $"{r.ClientRequestId}:{r.Status}:{r.ErrorCode}"))}");
        results.Should().OnlyContain(r => r.Status == "applied", "an installed phone's queue keeps moving (P11)");
        var verified = (await EventsAsync(logId)).Single(e => e.Status == "Verified");
        verified.Version.Should().Be(2, "an old phone cannot say what it saw, so the version the server held is recorded");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. FOUNDER D-33 — "मंजूर no longer moves a काम कार्ड to 'ready to pay'"
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Approving_a_record_leaves_its_job_cards_payment_state_unchanged_from_every_phone()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // This build's phone: verify_log_v2 with the version it saw.
        var newPhoneLog = Guid.NewGuid();
        var newPhoneCard = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-d33-new", Log(newPhoneLog, Worker, PlotA, CycleA));
        await SeedJobCardAsync(newPhoneCard, newPhoneLog, "Completed");
        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-d33-new-verify", Verify(newPhoneLog, Owner, 1));
        (await EventsAsync(newPhoneLog)).Should().Contain(e => e.Status == "Verified");
        var afterNew = await CardStatusAsync(newPhoneCard);
        Output.WriteLine($"[EVIDENCE] D-33 new phone: record Verified, job card -> {afterNew}");
        afterNew.Should().Be("Completed", "मंजूर confirms the work record; it does not make the card ready to pay (D-33)");

        // An installed 1.0.17: verify_log v1, confirmed then verified, no version.
        var oldPhoneLog = Guid.NewGuid();
        var oldPhoneCard = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-d33-old", Log(oldPhoneLog, Worker, PlotA, CycleA));
        await SeedJobCardAsync(oldPhoneCard, oldPhoneLog, "Completed");
        var results = await PushBatchAsync(Owner,
            ("l4b-d33-old-confirm", "verify_log", V1(oldPhoneLog, Owner, "confirmed")),
            ("l4b-d33-old-verify", "verify_log", V1(oldPhoneLog, Owner, "verified")));
        results.Should().OnlyContain(r => r.Status == "applied");
        var afterOld = await CardStatusAsync(oldPhoneCard);
        Output.WriteLine($"[EVIDENCE] D-33 1.0.17 phone: record Verified, job card -> {afterOld}");
        afterOld.Should().Be("Completed", "an older phone's मंजूर does not trigger it either");
    }

    [Fact]
    public async Task A_job_card_already_ready_to_pay_is_left_as_it_is_when_its_record_is_approved()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var logId = Guid.NewGuid();
        var card = Guid.NewGuid();
        await PushAppliedAsync(Worker, "create_daily_log", "l4b-d33-ready", Log(logId, Worker, PlotA, CycleA));
        await SeedJobCardAsync(card, logId, "VerifiedForPayout");
        var before = await CardRowAsync(card);

        await PushAppliedAsync(Owner, "verify_log_v2", "l4b-d33-ready-verify", Verify(logId, Owner, 1));

        var after = await CardRowAsync(card);
        Output.WriteLine($"[EVIDENCE] D-33 existing ready-to-pay card: {before} -> {after}");
        after.Should().Be(before, "a card already ready to pay stays exactly as it was (P10, no rewrite)");
    }

    private async Task SeedJobCardAsync(Guid cardId, Guid logId, string status)
    {
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await ExecAsync(raw, null, """
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, assigned_worker_user_id, planned_date,
                                       status, created_at_utc, modified_at_utc, started_at_utc, completed_at_utc, linked_daily_log_id, line_items)
            VALUES (@id, @farm, @plot, @cycle, @owner, @worker, DATE '2026-10-30', @status, NOW(), NOW(), NOW(), NOW(), @log,
                    '[{"activityType":"spray","expectedHours":4,"rateAmount":500,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
            """,
            ("id", cardId), ("farm", FarmA), ("plot", PlotA), ("cycle", CycleA), ("owner", Owner), ("worker", Worker),
            ("status", status), ("log", logId));
    }

    private async Task<string> CardStatusAsync(Guid cardId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status FROM ssf.job_cards WHERE id = @id";
        cmd.Parameters.AddWithValue("id", cardId);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<string> CardRowAsync(Guid cardId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT status || '|' || modified_at_utc::text || '|' || coalesce(payout_cost_entry_id::text, '-') FROM ssf.job_cards WHERE id = @id";
        cmd.Parameters.AddWithValue("id", cardId);
        return (string)(await cmd.ExecuteScalarAsync())!;
    }

    // ── Harness ─────────────────────────────────────────────────────────────────────────

    private sealed record Queue(IReadOnlyList<Guid> Ids, int Pending, bool? CanConfirm, IReadOnlyDictionary<Guid, int?> Versions)
    {
        public int? VersionOf(Guid id) => Versions.TryGetValue(id, out var v) ? v : null;
    }

    private sealed record StoredEvent(string Status, string? Reason, int? Version);

    private static string Describe(IEnumerable<StoredEvent> events) =>
        string.Join(" -> ", events.Select(e => $"{e.Status}{(e.Version is { } v ? $"(v{v})" : string.Empty)}"));

    private async Task<Queue> QueueAsync(Guid user, Guid farm)
    {
        using var response = await SendAsync(HttpMethod.Get, $"/shramsafal/farms/{farm}/labour?window=today", user);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        var root = JsonDocument.Parse(body).RootElement;
        var review = root.GetProperty("review").EnumerateArray().ToList();
        return new Queue(
            review.Select(r => Guid.Parse(r.GetProperty("id").GetString()!)).ToList(),
            root.GetProperty("dashboard").GetProperty("pending").GetInt32(),
            root.TryGetProperty("canConfirm", out var c) && c.ValueKind is JsonValueKind.True or JsonValueKind.False ? c.GetBoolean() : null,
            review.ToDictionary(
                r => Guid.Parse(r.GetProperty("id").GetString()!),
                r => r.TryGetProperty("version", out var v) && v.ValueKind == JsonValueKind.Number ? v.GetInt32() : (int?)null));
    }

    private async Task<IReadOnlyList<SyncMutationResultDto>> PushBatchAsync(
        Guid actor, params (string ClientRequestId, string Type, Dictionary<string, object?> Payload)[] mutations)
    {
        await using var scope = HostServices.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(new PushSyncBatchCommand(
            DeviceId: $"device-l4b-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "Worker",
            Mutations: mutations
                .Select(m => new PushSyncMutationCommand(m.ClientRequestId, m.Type, JsonSerializer.SerializeToElement(m.Payload, Web)))
                .ToList(),
            AppVersion: "1.0.18"));
        push.IsSuccess.Should().BeTrue("the batch itself is answered: {0}", push.Error?.ToString() ?? "-");
        return push.Value!.Results;
    }

    private async Task AddSecondPlotAsync()
    {
        await using var raw = new NpgsqlConnection(SuperuserConn);
        await raw.OpenAsync();
        await ExecAsync(raw, null, """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@plot, @farm, 'प्लॉट दोन', 1.0, NOW(), NOW());
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            """, ("plot", PlotTwo), ("cycle", CycleTwo), ("farm", FarmA));
    }

    private async Task<List<StoredEvent>> EventsAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT status, reason, confirmed_log_version FROM ssf.verification_events
            WHERE daily_log_id = @id ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<StoredEvent>();
        while (await reader.ReadAsync())
        {
            rows.Add(new StoredEvent(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetInt32(2)));
        }

        return rows;
    }

    private async Task<int> ContentVersionAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", logId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private static async Task ExecAsync(NpgsqlConnection db, NpgsqlTransaction? tx, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private static Dictionary<string, object?> Log(Guid id, Guid maker, Guid plot, Guid cycle) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
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

    private static Dictionary<string, object?> Dispute(Guid logId, Guid verifier, string? reason)
    {
        var payload = new Dictionary<string, object?>
        {
            ["logId"] = logId,
            ["verifierUserId"] = verifier,
            ["decision"] = "dispute",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        };
        if (reason is not null)
        {
            payload["reason"] = reason;
        }

        return payload;
    }

    private static Dictionary<string, object?> V1(Guid logId, Guid verifier, string status) => new()
    {
        ["verificationEventId"] = Guid.NewGuid(),
        ["dailyLogId"] = logId,
        ["status"] = status,
        ["verifiedByUserId"] = verifier,
    };
}
