// spec: plr-d10 lane PRV (founder D-26, 2026-10-27; Q3 2026-10-30 "in this release") — who may see ONE record, proved
// on a real Postgres as agrisync_app (E3 first) through the real host, the real routes and the real push path, with
// every cursor sent the way a phone sends it (whole seconds, fed from each answer):
//   1. a since=0 pull hands each person only the records whose audience includes him (content, not just ids);
//   2. an audience change withdraws the record ONCE, a restore brings it back ONCE (never a loop, never a skip);
//   3. a change to a record he may no longer see is refused with a visible reason, and nothing is written;
//   4. the money totals leave the record out and say so (W4);
//   5. export, audit, original voice, /ai/jobs and the attachment reads refuse;
//   6. tenancy both ways (E4): a stranger, another farm's record and a non-primary sender are refused.
// Written against the 6eab2ce0 surface only (raw mutation names, raw JSON), so the same file runs red there.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Application.UseCases.Logs.GetLogOriginalVoice;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class RecordAudienceRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid PrivateLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000101");
    private static readonly Guid PrivatePhoto = Guid.Parse("3d0a0000-0000-4000-8000-000000000102");
    private static readonly Guid PrivateCost = Guid.Parse("3d0a0000-0000-4000-8000-000000000103");
    private static readonly Guid PrivateReceipt = Guid.Parse("3d0a0000-0000-4000-8000-000000000104");
    private static readonly Guid SelectedLog = Guid.Parse("3d0a0000-0000-4000-8000-000000000105");
    private static readonly Guid SelectedCost = Guid.Parse("3d0a0000-0000-4000-8000-000000000106");
    private static readonly Guid PrivateJob = Guid.Parse("3d0a0000-0000-4000-8000-000000000107");

    /// <summary>The money the private record's own input line made (the phone's derived id): it follows its record.</summary>
    private static readonly Guid PrivateMoney = MoneyEntryIdentity.ForRecordLine(PrivateLog, MoneyEntryIdentity.Input, "in-1");

    private const string PrivateWords = "गुप्त-सूत्र-औषध-मिश्रण";
    private const string SelectedWords = "निवडक-लोकांचे-काम";
    private const string PrivateCostWords = "गुप्त-खर्च-नोंद";
    private const decimal PrivateInputCost = 4321.09m;
    private const decimal PrivateCostAmount = 7777.31m;
    private const decimal SelectedCostAmount = 2468.13m;
    private static readonly string[] HiddenFromCoOwnerText =
    [
        PrivateWords, SelectedWords, PrivateCostWords, "4321.09", "7777.31", "2468.13",
        // the मुकादम's own record, made "only me" by the owner: its wage, total and input cost.
        "211.19", "1689.52", "333.37",
    ];

    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    // ── 1 ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_since_zero_pull_hands_each_person_only_the_records_whose_audience_includes_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();

        // The owner (primary account holder): everything, and the audience he chose on each.
        var (ownerBody, owner) = await PullAsync(Owner);
        Keep("owner", ownerBody);
        IdsOf(owner, "dailyLogs").Should().Contain([PrivateLog, SelectedLog, MukadamLog, OwnerLog]);
        IdsOf(owner, "costEntries").Should().Contain([PrivateCost, SelectedCost, PrivateMoney, Cost]);
        IdsOf(owner, "attachments").Should().Contain([PrivatePhoto, PrivateReceipt]);
        ownerBody.Should().Contain(PrivateWords).And.Contain("7777.31").And.Contain("2468.13");
        AudienceOf(owner, "dailyLogs", PrivateLog).Should().Be("OnlyMe");
        AudienceOf(owner, "dailyLogs", MukadamLog).Should().Be("OnlyMe");
        AudienceOf(owner, "dailyLogs", SelectedLog).Should().Be("Selected");
        ChosenOf(owner, "dailyLogs", SelectedLog).Should().Equal([Mukadam]);
        AudienceOf(owner, "costEntries", PrivateMoney).Should().Be("OnlyMe", "a work record's own money follows its record");
        AudienceOf(owner, "dailyLogs", OwnerLog).Should().BeNull("the normal team is not stated");

        // The सहमालक, who sees money and wages: none of it, not an id, a word, an amount or a photo.
        var (coBody, co) = await PullAsync(CoOwner);
        Keep("co-owner", coBody);
        IdsOf(co, "dailyLogs").Should().Contain(OwnerLog).And.Contain(WorkerLog);
        IdsOf(co, "costEntries").Should().Contain(Cost, "he sees the farm's money");
        IdsOf(co, "jobCards").Should().Contain(JobCard, "the card linked to a private record still reaches him, unlinked");
        foreach (var hidden in new[] { PrivateLog, SelectedLog, MukadamLog, PrivateCost, SelectedCost, PrivateMoney, PrivatePhoto, PrivateReceipt, PrivateJob })
        {
            coBody.Should().NotContain(hidden.ToString(), $"{hidden} is not his to see, anywhere in the body");
        }

        foreach (var text in HiddenFromCoOwnerText)
        {
            coBody.Should().NotContain(text, $"'{text}' belongs to a record he may not see");
        }

        ArrayOf(co, "dailyLogs").Concat(ArrayOf(co, "costEntries"))
            .Where(r => r.TryGetProperty("audience", out var a) && a.ValueKind != JsonValueKind.Null)
            .Should().BeEmpty("nobody but the holder is told a record is narrowed");
        ArrayOf(co, "withdrawnRecords").Should().BeEmpty("a pull from the beginning names no restricted record");
        var coScope = ArrayOf(co, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == FarmA);
        coScope.GetProperty("withheldRecordDays").EnumerateArray()
            .Select(d => $"{d.GetProperty("kind").GetString()}:{d.GetProperty("date").GetString()}")
            .Should().BeEquivalentTo([$"work:{WorkDay}", $"money:{WorkDay}"], "his totals say some records are not counted (W4)");

        // The मुकादम, chosen for the "selected" records, and the maker of his own: those, never the private ones.
        var (mukadamBody, mukadam) = await PullAsync(Mukadam);
        IdsOf(mukadam, "dailyLogs").Should().Contain([SelectedLog, MukadamLog], "chosen, and the maker always stays");
        IdsOf(mukadam, "costEntries").Should().Contain(SelectedCost);
        mukadamBody.Should().Contain("2468.13", "chosen, and he sees money");
        mukadamBody.Should().NotContain(SelectedWords, "an audience only narrows: without confirm-records a record's words are not his (MU-3)");
        foreach (var hidden in new[] { PrivateLog, PrivateCost, PrivateMoney, PrivatePhoto, PrivateReceipt })
        {
            mukadamBody.Should().NotContain(hidden.ToString());
        }

        mukadamBody.Should().NotContain(PrivateWords).And.NotContain("7777.31").And.NotContain("4321.09").And.NotContain(PrivateCostWords);

        // The कामगार: his own records only, as before — no restricted record reaches him.
        var (workerBody, worker) = await PullAsync(Worker);
        IdsOf(worker, "dailyLogs").Should().Equal([WorkerLog]);
        foreach (var hidden in new[] { PrivateLog, SelectedLog, MukadamLog, PrivateCost, SelectedCost, PrivateMoney, PrivatePhoto, PrivateReceipt })
        {
            workerBody.Should().NotContain(hidden.ToString());
        }
    }

    // ── 2 ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The सहमालक's phone pulls again and again, each time sending back the previous answer's cursor rounded DOWN to the
    /// whole second (every phone does). The owner makes his own record "only me": it must be withdrawn in exactly ONE
    /// answer (never zero, never twice) and never sent. He then restores it: it must come back (with its photo, which did
    /// not change itself) in exactly one answer, and never be withdrawn again.
    /// </summary>
    [Fact]
    public async Task An_audience_change_withdraws_the_record_once_and_a_restore_brings_it_back_once()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        var (_, first) = await PullAsync(CoOwner);
        IdsOf(first, "dailyLogs").Should().Contain(OwnerLog);
        IdsOf(first, "costEntries").Should().Contain(Cost);
        IdsOf(first, "attachments").Should().Contain([OwnerLogPhoto, Receipt]);
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();
        await Task.Delay(1100);

        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "OnlyMe");
        await SetAudienceAsync(Owner, "CostEntry", Cost, "OnlyMe");

        var withdrawnLog = 0;
        var withdrawnCost = 0;
        for (var i = 0; i < 6; i++)
        {
            var (body, answer) = await PullAsync(CoOwner, cursor);
            if (ArrayOf(answer, "withdrawnRecords").Count > 0)
            {
                Keep("co-owner-withdrawn", body);
            }

            var withdrawn = ArrayOf(answer, "withdrawnRecords").Select(w => (w.GetProperty("kind").GetString(), w.GetProperty("id").GetGuid())).ToList();
            withdrawnLog += withdrawn.Count(w => w == ("DailyLog", OwnerLog));
            withdrawnCost += withdrawn.Count(w => w == ("CostEntry", Cost));
            IdsOf(answer, "dailyLogs").Should().NotContain(OwnerLog, "never sent while it is not his");
            IdsOf(answer, "attachments").Should().NotContain([OwnerLogPhoto, Receipt]);
            body.Should().NotContain("432.17", "nor its wage");
            var next = answer.GetProperty("nextCursorUtc").GetDateTime();
            Output.WriteLine($"[EVIDENCE] withdraw pull {i + 1}: sent {PhoneCursor(cursor)} -> withdrawn {string.Join(",", withdrawn)}; next {next:O}");
            cursor = next;
            await Task.Delay(400);
        }

        withdrawnLog.Should().Be(1, "the record is withdrawn exactly once: never skipped, never looped");
        withdrawnCost.Should().Be(1, "the money record too");

        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "Team");
        await SetAudienceAsync(Owner, "CostEntry", Cost, "Team");
        await Task.Delay(1100);

        var returnedLog = 0;
        var returnedPhoto = 0;
        var returnedReceipt = 0;
        var returnedCost = 0;
        for (var i = 0; i < 6; i++)
        {
            var (_, answer) = await PullAsync(CoOwner, cursor);
            returnedLog += IdsOf(answer, "dailyLogs").Count(id => id == OwnerLog);
            returnedPhoto += IdsOf(answer, "attachments").Count(id => id == OwnerLogPhoto);
            returnedReceipt += IdsOf(answer, "attachments").Count(id => id == Receipt);
            returnedCost += IdsOf(answer, "costEntries").Count(id => id == Cost);
            ArrayOf(answer, "withdrawnRecords").Should().BeEmpty("a record he sees again is never withdrawn");
            var next = answer.GetProperty("nextCursorUtc").GetDateTime();
            Output.WriteLine($"[EVIDENCE] restore pull {i + 1}: sent {PhoneCursor(cursor)} -> log {returnedLog} photo {returnedPhoto} cost {returnedCost} receipt {returnedReceipt}; next {next:O}");
            cursor = next;
            await Task.Delay(400);
        }

        returnedLog.Should().Be(1, "the record comes back exactly once");
        returnedPhoto.Should().Be(1, "with its photo, which did not change itself");
        returnedCost.Should().Be(1);
        returnedReceipt.Should().Be(1, "and the money record's receipt");
    }

    // ── 3 ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_change_to_a_record_he_may_no_longer_see_is_refused_with_a_visible_reason_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        var tasksBefore = await CountAsync("SELECT count(*) FROM ssf.log_tasks WHERE daily_log_id = @id", PrivateLog);

        var edit = await PushAsync(CoOwner, "add_log_task", "prv-coowner-task", new Dictionary<string, object?>
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = PrivateLog,
            ["activityType"] = "spray",
            ["occurredAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        edit.Status.Should().Be("failed");
        edit.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden", "a code every phone parks visibly (its last segment is FORBIDDEN)");
        edit.ErrorMessage.Should().Contain("ShramSafal's rules", "worded as the rule, never pointing at anyone");

        var confirm = await PushAsync(CoOwner, "verify_log_v2", "prv-coowner-confirm", new Dictionary<string, object?>
        {
            ["logId"] = PrivateLog,
            ["verifierUserId"] = CoOwner,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        });
        confirm.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden");

        var correction = await PushAsync(CoOwner, "correct_cost_entry", "prv-coowner-correction", new Dictionary<string, object?>
        {
            ["financeCorrectionId"] = Guid.NewGuid(),
            ["costEntryId"] = PrivateCost,
            ["correctedAmount"] = 1.0m,
            ["currencyCode"] = "INR",
            ["reason"] = "चूक",
            ["correctedByUserId"] = CoOwner,
        });
        correction.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden");

        var photo = await PushAsync(Mukadam, "create_attachment", "prv-mukadam-photo", new Dictionary<string, object?>
        {
            ["attachmentId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["linkedEntityId"] = PrivateLog,
            ["linkedEntityType"] = "DailyLog",
            ["fileName"] = "x.jpg",
            ["mimeType"] = "image/jpeg",
        });
        photo.ErrorCode.Should().Be("ShramSafal.RecordAudience.Forbidden");

        (await CountAsync("SELECT count(*) FROM ssf.log_tasks WHERE daily_log_id = @id", PrivateLog))
            .Should().Be(tasksBefore, "nothing of a refused change is written");
        (await CountAsync("SELECT count(*) FROM ssf.finance_corrections WHERE cost_entry_id = @id", PrivateCost)).Should().Be(0);

        // The maker always stays: the मुकादम may still work on his own record the owner made "only me".
        await PushAppliedAsync(Mukadam, "add_log_task", "prv-mukadam-own-task", new Dictionary<string, object?>
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = MukadamLog,
            ["activityType"] = "pruning",
            ["occurredAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
    }

    // ── 4 ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_money_totals_count_only_records_he_may_see_and_say_so()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();

        var (ownerStatus, ownerBody) = await GetAsync("/shramsafal/finance/summary?groupBy=day", Owner);
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerBody);
        JsonDocument.Parse(ownerBody).RootElement.GetProperty("recordsNotCounted").GetInt32().Should().Be(0, "the holder's total counts everything");
        JsonDocument.Parse(ownerBody).RootElement.GetProperty("grandTotal").GetDecimal()
            .Should().Be(CostAmount + PrivateCostAmount + SelectedCostAmount + PrivateInputCost);

        var (coStatus, coBody) = await GetAsync("/shramsafal/finance/summary?groupBy=day", CoOwner);
        coStatus.Should().Be(HttpStatusCode.OK, coBody);
        var co = JsonDocument.Parse(coBody).RootElement;
        co.GetProperty("grandTotal").GetDecimal().Should().Be(CostAmount, "only the money he may see is added up");
        co.GetProperty("recordsNotCounted").GetInt32().Should().BeGreaterThan(0, "and the total says some records are not counted (W4)");
        foreach (var text in new[] { "7777.31", "2468.13", "4321.09" })
        {
            coBody.Should().NotContain(text);
        }

        var (mukadamStatus, mukadamBody) = await GetAsync("/shramsafal/finance/summary?groupBy=day", Mukadam);
        mukadamStatus.Should().Be(HttpStatusCode.OK, mukadamBody);
        JsonDocument.Parse(mukadamBody).RootElement.GetProperty("grandTotal").GetDecimal()
            .Should().Be(CostAmount + SelectedCostAmount, "the selected money is his, the private money is not");

        var (plotStatus, plotBody) = await GetAsync($"/shramsafal/finance/plot-summary?plotId={PlotA}", CoOwner);
        plotStatus.Should().Be(HttpStatusCode.OK, plotBody);
        foreach (var text in new[] { "7777.31", "2468.13", "4321.09" })
        {
            plotBody.Should().NotContain(text, "the plot's total leaves it out too");
        }

        JsonDocument.Parse(plotBody).RootElement.GetProperty("recordsNotCounted").GetInt32().Should().BeGreaterThan(0);
    }

    // ── 5 ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Export_audit_original_voice_ai_jobs_and_the_attachment_reads_refuse_a_record_he_may_not_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAudiencesAsync();
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;

        var export = $"/shramsafal/export/monthly-cost?farmId={FarmA}&year=2026&month=10";
        (await GetAsync(export, Owner)).Status.Should().Be(HttpStatusCode.OK, "the holder exports his farm");
        (await GetAsync(export, CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden, "a report that would carry a record kept from him");

        (await GetAsync($"/shramsafal/audit?entityType=DailyLog&entityId={PrivateLog}&farmId={FarmA}", Owner)).Status
            .Should().Be(HttpStatusCode.OK, "the holder reads his record's trail");
        (await GetAsync($"/shramsafal/audit?entityType=DailyLog&entityId={PrivateLog}&farmId={FarmA}", CoOwner)).Status
            .Should().Be(HttpStatusCode.Forbidden, "the record's own trail");
        var (trailStatus, trail) = await GetAsync($"/shramsafal/audit?farmId={FarmA}", CoOwner);
        trailStatus.Should().Be(HttpStatusCode.OK, trail);
        foreach (var hidden in new[] { PrivateLog, PrivateCost, PrivateMoney, SelectedLog, SelectedCost, MukadamLog, PrivatePhoto, PrivateReceipt })
        {
            trail.Should().NotContain(hidden.ToString(), "the farm's trail never names a record kept from him");
        }

        // /ai/jobs: the route's own admin probe cannot run in this host at all (it reads the admin tables with no tenant
        // scope — the same at 6eab2ce0), so its handler is asked exactly as the route asks it, in the farm's scope.
        (await JobAsync(Owner)).Should().BeNull("the holder reads the parse of his own record");
        (await JobAsync(CoOwner)).Should().Be("ShramSafal.Forbidden", "the parse of a record kept from him");

        (await GetAsync($"/shramsafal/attachments/{PrivatePhoto}", Owner)).Status.Should().Be(HttpStatusCode.OK);
        (await GetAsync($"/shramsafal/attachments/{PrivatePhoto}", CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/attachments/{PrivatePhoto}/download", CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync($"/shramsafal/attachments/{PrivateReceipt}/download", CoOwner)).Status.Should().Be(HttpStatusCode.Forbidden);
        var (listStatus, list) = await GetAsync($"/shramsafal/attachments?entityId={PrivateLog}&entityType=DailyLog", CoOwner);
        list.Should().NotContain(PrivatePhoto.ToString(), $"the list never names it ({listStatus})");

        // (/logs/{id}/transitions opens no tenant scope and answers every caller with a failure in this host, the same at
        // 6eab2ce0; it carries the same rule — RecordAudienceGate — and no phone calls it.)

        var voice = await AsUserAsync(CoOwner, async sp =>
        {
            var handler = ActivatorUtilities.CreateInstance<GetLogOriginalVoiceHandler>(
                sp, RoleScopedFixOneRealPostgresTests.NeverReached.Of<IRetainedBlobStore>(),
                RoleScopedFixOneRealPostgresTests.NeverReached.Of<IAccountErasureCheck>());
            return await handler.HandleAsync(new GetLogOriginalVoiceQuery(PrivateLog, CoOwner));
        });
        voice.IsSuccess.Should().BeFalse("the original voice of a record kept from him is refused");
        voice.Error.Code.Should().Be("ShramSafal.ReadNotAllowed");
    }

    // ── 6 ────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Tenancy_both_ways_a_stranger_another_farms_record_and_a_non_primary_sender_are_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var stranger = await SetAudienceRawAsync(Owner, "DailyLog", OwnerLog, "Selected", [OwnerB]);
        stranger.Status.Should().Be("failed");
        stranger.ErrorCode.Should().Be("ShramSafal.RecordAudienceMember.Forbidden", "a person of another farm is never chosen");
        (await SetAudienceRawAsync(Owner, "DailyLog", OwnerLog, "Selected", [Paused])).ErrorCode
            .Should().Be("ShramSafal.RecordAudienceMember.Forbidden", "a paused seat is not an active member");

        var foreign = await SetAudienceRawAsync(Owner, "DailyLog", FarmBLog, "OnlyMe", []);
        foreign.Status.Should().Be("failed", "another farm's record id resolves to nothing");
        foreign.ErrorCode.Should().Be("ShramSafal.DailyLogNotFound");
        (await SetAudienceRawAsync(OwnerB, "DailyLog", OwnerLog, "OnlyMe", [])).Status
            .Should().Be("failed", "farm B's holder cannot reach farm A's record");

        var notHolder = await SetAudienceRawAsync(CoOwner, "DailyLog", OwnerLog, "OnlyMe", []);
        notHolder.ErrorCode.Should().Be("ShramSafal.RecordAudienceHolder.Forbidden", "only the primary account holder chooses");
        (await SetAudienceRawAsync(Mukadam, "DailyLog", MukadamLog, "OnlyMe", [])).ErrorCode
            .Should().Be("ShramSafal.RecordAudienceHolder.Forbidden", "not even the maker of the record");

        (await SetAudienceRawAsync(Owner, "DailyLog", OwnerLog, "Selected", [])).ErrorCode
            .Should().Be("ShramSafal.InvalidCommand", "'Selected' names at least one person");

        IdsOf((await PullAsync(CoOwner)).Root, "dailyLogs").Should().Contain(OwnerLog, "nothing refused changed anything");
        (await CountAsync("SELECT count(*) FROM ssf.record_audience_members WHERE record_id = @id", OwnerLog)).Should().Be(0);
    }

    // ── 7 ────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The migration's Down() is a working path (E8): stepping back to the migration before it drops the chosen people
    /// and the audience columns, and stepping forward again restores them. What Down() destroys is every chosen audience
    /// (restricted records return to the normal team); the audit rows of each change stay.
    /// </summary>
    [Fact]
    public async Task The_migration_steps_down_and_up_again()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SetAudienceAsync(Owner, "DailyLog", OwnerLog, "Selected", Mukadam);
        (await ScalarTextAsync("SELECT audience FROM ssf.daily_logs WHERE \"Id\" = @id", OwnerLog)).Should().Be("Selected");

        await using (var db = ChainContext())
        {
            await db.Database.GetService<IMigrator>().MigrateAsync("20261031021129_SplitFarmAuthorities");
        }

        (await ScalarTextAsync("SELECT to_regclass('ssf.record_audience_members')::text WHERE @id IS NOT NULL", Guid.NewGuid())).Should().BeNull("Down() drops the chosen people");
        (await ScalarTextAsync("SELECT column_name FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'daily_logs' AND column_name = 'audience' AND @id IS NOT NULL", Guid.NewGuid()))
            .Should().BeNull("and the audience: the record is the team's again");
        (await CountAsync("SELECT count(*) FROM ssf.audit_events WHERE action = 'AudienceChanged' AND entity_id = @id", OwnerLog))
            .Should().Be(1, "the audit row of the change stays");

        await using (var db = ChainContext())
        {
            await db.Database.MigrateAsync();
        }

        (await ScalarTextAsync("SELECT audience FROM ssf.daily_logs WHERE \"Id\" = @id", OwnerLog)).Should().Be("Team", "up again, every record starts with the team");
        (await ScalarTextAsync("SELECT relforcerowsecurity::text FROM pg_class WHERE oid = 'ssf.record_audience_members'::regclass AND @id IS NOT NULL", Guid.NewGuid()))
            .Should().Be("true", "FORCE row security is back with the table");
    }

    // ── Seed ─────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The brief's farm: the owner; a सहमालक with see money (and wages); a मुकादम with हजेरी and see money; a कामगार;
    /// a second farm. Records made "only me", "selected (मुकादम)" and left to the team, one of them made by the मुकादम.
    /// </summary>
    private async Task SeedAudiencesAsync()
    {
        await SetAuthoritiesAsync(FarmA, CoOwner, FarmAuthority.SeeMoney, FarmAuthority.SeeWages, FarmAuthority.ConfirmRecords);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney);

        await using (var db = NewSuperuserContext())
        {
            db.AiJobs.Add(AiJob.Create(PrivateJob, "prv-private-job", AiOperationType.VoiceToStructuredLog, Owner, FarmA, null, null));
            await db.SaveChangesAsync();
        }

        var privateLog = LogPayload(PrivateLog, Owner, Guid.NewGuid(), 4, null, null, [], PrivateInputCost);
        privateLog["sourceAiJobId"] = PrivateJob;
        privateLog["content"] = new
        {
            schema = 1,
            fullTranscript = PrivateWords,
            inputs = new object[]
            {
                new
                {
                    id = "in-1",
                    productName = "औषध",
                    quantity = 1,
                    unit = "l",
                    cost = PrivateInputCost,
                    numbers = new { cost = new { certainty = "reported", spokenText = PrivateWords } },
                },
            },
        };
        await PushAppliedAsync(Owner, "create_daily_log", "prv-private-log", privateLog);
        var privateMoney = CostPayload(PrivateMoney, FarmA, PlotA, CycleA, PrivateInputCost);
        privateMoney["description"] = "औषध";
        await PushAppliedAsync(Owner, "add_cost_entry", "prv-private-money", privateMoney);
        await PushAppliedAsync(Owner, "create_attachment", "prv-private-photo", Photo(PrivatePhoto, PrivateLog, "DailyLog"));
        var privateCost = CostPayload(PrivateCost, FarmA, PlotA, CycleA, PrivateCostAmount);
        privateCost["description"] = PrivateCostWords;
        await PushAppliedAsync(Owner, "add_cost_entry", "prv-private-cost", privateCost);
        await PushAppliedAsync(Owner, "create_attachment", "prv-private-receipt", Photo(PrivateReceipt, PrivateCost, "CostEntry"));

        var selectedLog = LogPayload(SelectedLog, Owner, Guid.NewGuid(), 3, null, null, [], null);
        selectedLog["content"] = new { schema = 1, fullTranscript = SelectedWords };
        await PushAppliedAsync(Owner, "create_daily_log", "prv-selected-log", selectedLog);
        await PushAppliedAsync(Owner, "add_cost_entry", "prv-selected-cost", CostPayload(SelectedCost, FarmA, PlotA, CycleA, SelectedCostAmount));

        await SetAudienceAsync(Owner, "DailyLog", PrivateLog, "OnlyMe");
        await SetAudienceAsync(Owner, "CostEntry", PrivateCost, "OnlyMe");
        await SetAudienceAsync(Owner, "DailyLog", SelectedLog, "Selected", Mukadam);
        await SetAudienceAsync(Owner, "CostEntry", SelectedCost, "Selected", Mukadam);
        await SetAudienceAsync(Owner, "DailyLog", MukadamLog, "OnlyMe");

        // The farm's job card (planned work, not narrowed in this release) is linked to the private record: the card
        // still reaches its readers, without ever naming the record.
        await ExecOnSuperuserAsync("UPDATE ssf.job_cards SET linked_daily_log_id = @log, modified_at_utc = NOW() WHERE id = @jc",
            ("log", PrivateLog), ("jc", JobCard));
    }

    private async Task SetAudienceAsync(Guid actor, string kind, Guid recordId, string audience, params Guid[] people)
    {
        var result = await SetAudienceRawAsync(actor, kind, recordId, audience, people);
        result.Status.Should().Be("applied", "{0} {1} -> {2}: {3} {4}", kind, recordId, audience, result.ErrorCode, result.ErrorMessage);
    }

    private Task<ShramSafal.Application.Contracts.Dtos.SyncMutationResultDto> SetAudienceRawAsync(
        Guid actor, string kind, Guid recordId, string audience, Guid[] people) =>
        PushAsync(actor, "set_record_audience", $"prv-aud-{recordId:N}-{audience}-{Guid.NewGuid():N}", new Dictionary<string, object?>
        {
            ["recordKind"] = kind,
            ["recordId"] = recordId,
            ["audience"] = audience,
            ["selectedUserIds"] = people,
            ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

    /// <summary>
    /// The P11 run's input: when <c>PRV_P11_BODIES</c> names a folder, the real bodies this server sent are kept there, so
    /// the 1.0.17 phone's own code (release b3d28967) can be fed exactly them.
    /// </summary>
    private static void Keep(string who, string body)
    {
        var folder = Environment.GetEnvironmentVariable("PRV_P11_BODIES");
        if (!string.IsNullOrWhiteSpace(folder))
        {
            System.IO.Directory.CreateDirectory(folder);
            System.IO.File.WriteAllText(System.IO.Path.Combine(folder, $"{who}.json"), body);
        }
    }

    private static Dictionary<string, object?> Photo(Guid id, Guid parent, string parentType) => new()
    {
        ["attachmentId"] = id,
        ["farmId"] = FarmA,
        ["linkedEntityId"] = parent,
        ["linkedEntityType"] = parentType,
        ["fileName"] = $"prv-{parentType}.jpg",
        ["mimeType"] = "image/jpeg",
    };

    private static string? AudienceOf(JsonElement root, string array, Guid id)
    {
        var row = ArrayOf(root, array).Single(r => r.GetProperty("id").GetGuid() == id);
        return row.TryGetProperty("audience", out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() : null;
    }

    private static IReadOnlyList<Guid> ChosenOf(JsonElement root, string array, Guid id) =>
        ArrayOf(root, array).Single(r => r.GetProperty("id").GetGuid() == id)
            .GetProperty("audienceUserIds").EnumerateArray().Select(e => e.GetGuid()).ToList();

    /// <summary>The <c>/ai/jobs/{id}</c> handler for the private record's parse: <c>null</c> = answered, else the refusal code.</summary>
    private Task<string?> JobAsync(Guid user) => AsFarmMemberAsync(FarmA, user, async sp =>
    {
        var handler = ActivatorUtilities.CreateInstance<ShramSafal.Application.UseCases.AI.GetAiJobStatus.GetAiJobStatusHandler>(sp);
        var result = await handler.HandleAsync(new ShramSafal.Application.UseCases.AI.GetAiJobStatus.GetAiJobStatusQuery(PrivateJob, user, false));
        Output.WriteLine($"[DOOR] {user} /ai/jobs/{PrivateJob} -> {(result.IsSuccess ? "200" : result.Error.Code)}");
        return result.IsSuccess ? null : result.Error.Code;
    });

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(string url, Guid user)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        var body = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[DOOR] {user} GET {url} -> {(int)response.StatusCode}");
        return (response.StatusCode, body);
    }

    /// <summary>The ShramSafal context exactly as the migration chain built this database (its own history table).</summary>
    private ShramSafal.Infrastructure.Persistence.ShramSafalDbContext ChainContext() =>
        new(new DbContextOptionsBuilder<ShramSafal.Infrastructure.Persistence.ShramSafalDbContext>().UseNpgsql(SuperuserConn).Options);

    private async Task<string?> ScalarTextAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        var value = await cmd.ExecuteScalarAsync();
        return value is null or DBNull ? null : Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture);
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
