// spec: plr-d10 lane PRV fix pass 1 (independent review 28/50) — each finding proved on a real Postgres as agrisync_app
// (E3 first), through the real host, the real routes and the real push path:
//   H1  the हजेरी ledger carries no word of a record kept from the reader; the attendance itself stays;
//   H2  the online labour correction (every REST write door) refuses a record kept from the caller;
//   H3  hidden work still counts as DONE on the board and in compare, and nothing of it is shown;
//   M1  a phone whose cursor is held below a record it holds still hears that the record was withdrawn;
//   M2  money the owner narrowed on its own is never widened by its record;
//   M5  an export leaves a hidden record out instead of being refused;
//   L2  the holder is the registrant, never a second PrimaryOwner seat;
//   L3  the audience change's own audit rows are the holder's alone;
//   L4  jobcard.complete and a lower-case attachment kind are gated too.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

public sealed partial class RecordAudienceRealPostgresTests
{
    private const string SecretTask = "गुप्त-फवारणी-काम";
    private const string SecretFertigation = "Fertigation गुप्त-मिश्रण";
    private static readonly Guid PlannedFertigation = Guid.Parse("3d0a0000-0000-4000-8000-000000000201");
    private static readonly Guid TaskLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000202");
    private static readonly Guid TaskCrew = Guid.Parse("3d0a0000-0000-4000-8000-000000000203");
    private static readonly Guid M2Log = Guid.Parse("3d0a0000-0000-4000-8000-000000000204");
    private static readonly Guid M2Money = ShramSafal.Domain.Finance.MoneyEntryIdentity.ForRecordLine(
        M2Log, ShramSafal.Domain.Finance.MoneyEntryIdentity.Input, "in-1");

    // ── H1 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H1_the_hajeri_ledger_shows_no_word_of_a_record_kept_from_the_reader_and_keeps_the_attendance()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var log = LogPayload(TaskLog, Owner, TaskCrew, 5, null, null, [], null);
        ((object[])log["labour"]!)[0] = new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = TaskCrew,
            ["engagementType"] = "hired_daily",
            ["workerCount"] = 5,
            ["task"] = SecretTask,
            ["engagedThroughFieldOperatorId"] = FieldOperator,
        };
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-h1-task-log", log);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.field_operator_work_rows ("Id", field_operator_id, labour_assignment_id, farm_id, work_date,
                                                      display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (gen_random_uuid(), @op, @crew, @farm, DATE '2026-10-30', 'हजेरी-शंकर', @owner, NOW())
            """, ("op", FieldOperator), ("crew", TaskCrew), ("farm", FarmA), ("owner", Owner));
        await SetAudienceAsync(Owner, "DailyLog", TaskLog, "OnlyMe");

        var (ownerStatus, ownerBody) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        ownerBody.Should().Contain(SecretTask, "the holder's own ledger names his work");

        var (status, body) = await GetAsync($"/shramsafal/farms/{FarmA}/labour?window=alltime", Mukadam);
        status.Should().Be(HttpStatusCode.OK, body);
        body.Should().NotContain(SecretTask, "not one word of a record kept from him, not even in a हजेरी cell");
        body.Should().NotContain(TaskLog.ToString()).And.NotContain(TaskCrew.ToString());
        body.Should().Contain("हजेरी-शंकर", "the attendance itself is shared farm-day truth and stays");
        var cells = JsonDocument.Parse(body).RootElement.GetProperty("ledger").GetProperty("rows").EnumerateArray()
            .SelectMany(r => r.GetProperty("cells").EnumerateArray()).Where(c => c.ValueKind == JsonValueKind.Object).ToList();
        cells.Should().Contain(c => c.GetProperty("day").GetString() == "full", "his day mark is still there");
    }

    // ── H2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H2_the_online_labour_correction_refuses_a_record_kept_from_the_caller_and_tells_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/labour/assignments/{PrivateCrew}/corrections", Mukadam,
            new { clientRequestId = "fix1-h2-online", reason = "चूक", quantity = new { workerCount = 9 } });
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] mukadam POST corrections -> {(int)response.StatusCode} {body}");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, body);
        body.Should().Contain("ShramSafal.RecordAudience.Forbidden", "the rule's own refusal");
        body.Should().NotContain("workerCount").And.NotContain(PrivateLog.ToString()).And.NotContain(PrivateWords);
        (await CountAsync("SELECT count(*) FROM ssf.labour_assignments WHERE \"Id\" = @id AND worker_count = 4", PrivateCrew))
            .Should().Be(1, "the owner's record is unchanged");
        (await CountAsync("SELECT count(*) FROM ssf.labour_corrections WHERE labour_assignment_id = @id", PrivateCrew))
            .Should().Be(0, "nothing of the refused correction is written");
    }

    // ── H3 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H3_hidden_work_still_counts_as_done_on_the_board_and_in_compare_and_nothing_of_it_is_shown()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (@id, @cycle, 'Fertigation', 'Vegetative', DATE '2026-10-30', NOW(), NOW())
            """, ("id", PlannedFertigation), ("cycle", CycleA));
        await PushAppliedAsync(Owner, "add_log_task", "fix1-h3-fertigation", new Dictionary<string, object?>
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = PrivateLog,
            ["activityType"] = SecretFertigation,
            ["occurredAtUtc"] = "2026-10-30T06:00:00Z",
        });

        var (body, mukadam) = await PullAsync(Mukadam);
        var scheduled = mukadam.GetProperty("attentionBoard").GetProperty("scheduledWork").EnumerateArray()
            .Select(w => w.GetProperty("plannedActivityId").GetGuid()).ToList();
        scheduled.Should().NotContain(PlannedFertigation, "the step is done — he is never told to repeat a private fertigation");
        body.Should().NotContain("गुप्त-मिश्रण").And.NotContain(PrivateLog.ToString());

        var comparison = await AsFarmMemberAsync(FarmA, Mukadam, async sp =>
        {
            var handler = sp.GetRequiredService<ComputePlannedVsExecutedDeltaHandler>();
            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(Mukadam, CycleA, "Vegetative"));
            result.IsSuccess.Should().BeTrue();
            return JsonSerializer.Serialize(result.Value);
        });
        Output.WriteLine($"[DOOR] mukadam compare -> {comparison}");
        var fertigation = JsonDocument.Parse(comparison).RootElement.GetProperty("Buckets").EnumerateArray()
            .Single(b => b.GetProperty("Category").GetString() == "fertigation");
        fertigation.GetProperty("Matched").EnumerateArray().Select(m => m.GetString()).Should().Contain("Fertigation");
        fertigation.GetProperty("Missing").EnumerateArray().Should().BeEmpty();
        comparison.Should().NotContain("गुप्त-मिश्रण", "the plan's own words only, never the record's");
    }

    // ── M1 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M1_a_phone_whose_cursor_is_held_below_a_record_it_holds_still_hears_it_was_withdrawn()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, ShramSafal.Domain.Farms.FarmAuthority.SeeMoney, ShramSafal.Domain.Farms.FarmAuthority.SeeWages);
        var (_, first) = await PullAsync(CoOwner);
        IdsOf(first, "dailyLogs").Should().Contain(OwnerLog, "the phone holds it");
        // A degraded answer delivered every row but froze the cursor where it was: an hour before the record existed.
        var heldCursor = DateTime.UtcNow.AddHours(-1);
        await Task.Delay(1100);
        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "OnlyMe");
        await Task.Delay(1100);

        var (_, answer) = await PullAsync(CoOwner, heldCursor);
        ArrayOf(answer, "withdrawnRecords").Select(w => w.GetProperty("id").GetGuid())
            .Should().Contain(OwnerLog, "he holds it; a bare kind + id tells him nothing new");
    }

    // ── M2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M2_money_the_owner_narrowed_on_its_own_keeps_his_choice_when_its_record_is_widened_to_selected_people()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-m2-log",
            LogPayload(M2Log, Owner, Guid.NewGuid(), 2, null, null, [], 1357.91m));
        await PushAppliedAsync(Owner, "add_cost_entry", "fix1-m2-money", CostPayload(M2Money, FarmA, PlotA, CycleA, 1357.91m));
        await SetAudienceAsync(Owner, "CostEntry", M2Money, "OnlyMe");

        await SetAudienceAsync(Owner, "DailyLog", M2Log, "Selected", Mukadam);

        var (_, owner) = await PullAsync(Owner);
        AudienceOf(owner, "costEntries", M2Money).Should().Be("OnlyMe", "his own narrower choice on the money stands");
        var (mukadamBody, _) = await PullAsync(Mukadam);
        mukadamBody.Should().NotContain(M2Money.ToString(), "the money record kept OnlyMe never reaches him");
        mukadamBody.Should().Contain(M2Log.ToString(), "the record itself is his to see");
        // Not asserted, and reported: the record's OWN content states the line's price (its inputs, its task note), and this
        // मुकादम sees money, so that stated price travels with the record he may see — the money ENTRY (its id, bills,
        // corrections) stays OnlyMe. Hiding a record's stated price per its money's audience is outside M2.
    }

    // ── M5 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M5_an_export_with_a_hidden_money_record_in_its_month_is_built_not_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                         created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @farm, @cost, DATE '2026-10-30', 'equal', @owner, NOW(), NOW())
            """, ("farm", FarmA), ("cost", PrivateCost), ("owner", Owner));
        var (status, _) = await GetAsync($"/shramsafal/export/monthly-cost?farmId={FarmA}&year=2026&month=10", CoOwner);
        status.Should().Be(HttpStatusCode.OK, "the month is exported from what he may see, with the rule's line when something is left out");

        // What the PDF is built from (the PDF's text is compressed; this is the service's own seam, read under each
        // reader's own farm scope exactly as the route reads it).
        async Task<ShramSafal.Application.Services.ExportLedgers> LedgersFor(Guid reader) =>
            await AsFarmMemberAsync(FarmA, reader, sp =>
                ActivatorUtilities.CreateInstance<ShramSafal.Infrastructure.Reports.PdfReportExportService>(sp)
                    .LedgersForAsync(FarmA, new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31), reader));
        var coOwner = await LedgersFor(CoOwner);
        coOwner.Shown.Should().NotContain(l => l.SourceCostEntryId == PrivateCost, "the money record kept from him is left out");
        coOwner.RuleNote.Should().Be(ShramSafal.Application.Services.ExportVisibility.RuleNotCountedEn, "and the report says so");
        var owner = await LedgersFor(Owner);
        owner.Shown.Should().Contain(l => l.SourceCostEntryId == PrivateCost, "the holder's report carries it");
        owner.RuleNote.Should().BeNull();
    }

    // ── L2 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task L2_a_second_primary_owner_seat_is_not_the_holder()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        await ExecOnSuperuserAsync("UPDATE ssf.farm_memberships SET role = 'PrimaryOwner' WHERE farm_id = @farm AND user_id = @user",
            ("farm", FarmA), ("user", Worker2));

        var (body, _) = await PullAsync(Worker2);
        body.Should().NotContain(PrivateLog.ToString(), "only the registrant always sees an 'only me' record");
        body.Should().NotContain(PrivateWords);
        (await SetAudienceRawAsync(Worker2, "DailyLog", OwnerLog, "OnlyMe", [])).ErrorCode
            .Should().Be("ShramSafal.RecordAudienceHolder.Forbidden", "only the registrant chooses who sees a record");
    }

    // ── L3 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task L3_the_audience_change_audit_rows_are_the_holders_alone()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, ShramSafal.Domain.Farms.FarmAuthority.SeeMoney, ShramSafal.Domain.Farms.FarmAuthority.SeeWages);
        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "Selected", Mukadam);
        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "Team");

        var (ownerStatus, ownerTrail) = await GetAsync($"/shramsafal/audit?farmId={FarmA}", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerTrail);
        ownerTrail.Should().Contain("AudienceChanged", "the holder sees who he chose, and when");
        var (status, trail) = await GetAsync($"/shramsafal/audit?farmId={FarmA}", CoOwner);
        status.Should().Be(HttpStatusCode.OK, trail);
        trail.Should().NotContain("AudienceChanged", "who was chosen for a record is the holder's alone");
        trail.Should().NotContain(Mukadam.ToString() + "\"]", "nor the people he chose");
    }

    // ── L4 ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task L4_a_lower_case_attachment_kind_and_a_job_card_completion_are_gated_too()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var photo = await PushAsync(CoOwner, "create_attachment", "fix1-l4-photo", new Dictionary<string, object?>
        {
            ["attachmentId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["linkedEntityId"] = PrivateLog,
            ["linkedEntityType"] = "dailylog",
            ["fileName"] = "x.jpg",
            ["mimeType"] = "image/jpeg",
        });
        photo.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden", "the handler reads the kind case-insensitively, so must the gate");

        var complete = await PushAsync(CoOwner, "jobcard.complete", "fix1-l4-complete", new Dictionary<string, object?>
        {
            ["jobCardId"] = JobCard,
            ["dailyLogId"] = PrivateLog,
        });
        complete.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden", "a job card is never linked to a record kept from him");
    }
}
