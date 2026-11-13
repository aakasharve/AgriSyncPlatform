// spec: plr-d10 lane MU-4 fix pass 1 (FIX-1.md; review REQUEST_CHANGES 32/50) — the review's findings, each proved on a real
// Postgres as agrisync_app (E3 first) through the real host, routes and push path, and each red without its own fix:
//   H1 every write asks the plot question (REST and sync): Ramesh on {P2, P4} cannot settle P1's job card (no money is
//      written), resolve or acknowledge P1's warning, make a job card, collect a test, change planned work, save a record or
//      money on P1 — while the same door on P2 works for him; M6 a refused sync write is kept whole for the owner;
//   H2 an own-work seat (a मुकादम label with see wages) reads the labour page's own row only; M1 a chosen-plots seat's labour
//      money (paid, owed) counts his plots' job cards and payouts only; item 4 a crew's work words on P1 never reach him;
//   M2 a record moved off his plots is withdrawn from his phone, one moved onto them arrives with its photo, and a move
//      between places he never covered is never hinted at; M3 a move from his narrowed copy keeps the plots he cannot see;
//   M4 "left out by rule" counts only records he would see by plot; M5 his own money submissions reach him (any plot, with
//      or without see money); L3 his plots' total is one number on both summaries;
//   M7 the owner's card says what is not in force and /me/context stops claiming it; M9 the farm audit stream is not a
//      chosen-plots seat's; L1 the "my cards" route matches the pull.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Adapters;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Compliance.AcknowledgeSignal;
using ShramSafal.Application.UseCases.Compliance.ResolveSignal;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;
using ShramSafal.Application.UseCases.Tests.RecordTestCollected;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class PlotScopeFixPass1RealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid P2 = Guid.Parse("3d050000-0000-4000-8000-0000000000c2");
    private static readonly Guid P4 = Guid.Parse("3d050000-0000-4000-8000-0000000000c4");
    private static readonly Guid CycleP2 = Guid.Parse("3d050000-0000-4000-8000-0000000000d2");
    private static readonly Guid CycleP4 = Guid.Parse("3d050000-0000-4000-8000-0000000000d4");
    private static readonly Guid OwnWorker = Guid.Parse("3d050000-0000-4000-8000-000000000018");

    private static readonly Guid SignalP1 = Guid.Parse("3d050000-0000-4000-8000-000000000101");
    private static readonly Guid SignalP2 = Guid.Parse("3d050000-0000-4000-8000-000000000102");
    private static readonly Guid CardP1 = Guid.Parse("3d050000-0000-4000-8000-000000000103");
    private static readonly Guid CardP2 = Guid.Parse("3d050000-0000-4000-8000-000000000104");
    private static readonly Guid TestP2 = Guid.Parse("3d050000-0000-4000-8000-000000000105");
    private static readonly Guid PlannedP2 = Guid.Parse("3d050000-0000-4000-8000-000000000106");
    private static readonly Guid CardMukP1 = Guid.Parse("3d050000-0000-4000-8000-000000000107");
    private static readonly Guid CardMukP2 = Guid.Parse("3d050000-0000-4000-8000-000000000108");

    private const string Forbidden = "ShramSafal.PlotScope.Forbidden";
    private const string CrewWordP1 = "पहिल्या-प्लॉटची-खुरपणी";

    // ── H1 + M6 ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H1_M6_every_write_asks_the_plot_question_on_REST_and_sync_and_a_refused_one_is_kept_for_the_owner()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        // lane L8b-1 (founder D-73): and "plan work", so the planning doors refuse him by the PLOT rule this test is about,
        // not for want of the planning authority.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney,
            FarmAuthority.ConfirmRecords, FarmAuthority.LabRecords, FarmAuthority.PlanWork);
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        var him = new UserId(Mukadam);

        // REST — each door's handler, asked exactly as its route asks it (the caller's farm scope opened first: this host
        // cannot open a farm claim for a write route). P1 is refused with the plot's code; the same door on P2 works for
        // him, so the refusal is the plot's, never his authority's. The job card on P1, ready to pay: no money is written.
        var (settleP1, paidP1) = await AsFarmMemberAsync(FarmA, Mukadam, async sp =>
        {
            var result = await sp.GetRequiredService<IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>>()
                .HandleAsync(new SettleJobCardPayoutCommand(CardP1, 3434.34m, "INR", null, him, "fix1-rest-settle-p1"));
            return (Code(result), await sp.GetRequiredService<ShramSafalDbContext>().CostEntries.CountAsync(c => c.JobCardId == CardP1));
        });
        settleP1.Should().Be(Forbidden);
        paidP1.Should().Be(0, "no money is written for P1's card");
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<SettleJobCardPayoutCommand, SettleJobCardPayoutResult>>()
            .HandleAsync(new SettleJobCardPayoutCommand(CardP2, 1212.12m, "INR", null, him, "fix1-rest-settle-p2")))))
            .Should().BeNull("the same door on HIS plot works for him");

        // P1's warning: resolve and acknowledge refused; P2's resolves.
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<ResolveSignalCommand>>()
            .HandleAsync(new ResolveSignalCommand(SignalP1, him, AppRole.Mukadam, "पाहिलं, ठीक आहे"))))).Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<AcknowledgeSignalCommand>>()
            .HandleAsync(new AcknowledgeSignalCommand(SignalP1, him, AppRole.Mukadam))))).Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<ResolveSignalCommand>>()
            .HandleAsync(new ResolveSignalCommand(SignalP2, him, AppRole.Mukadam, "पाहिलं, ठीक आहे"))))).Should().BeNull();

        // A job card, a test, planned work and money on P1: refused; the same on P2: done.
        var line = new[] { new JobCardLineItemDto("spray", 2, 100, "INR", null) };
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CreateJobCardHandler>()
            .HandleAsync(new CreateJobCardCommand(new FarmId(FarmA), PlotA, CycleA, new DateOnly(2026, 11, 1), line, him, "fix1-card-p1")))))
            .Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CreateJobCardHandler>()
            .HandleAsync(new CreateJobCardCommand(new FarmId(FarmA), P2, CycleP2, new DateOnly(2026, 11, 1), line, him, "fix1-card-p2")))))
            .Should().BeNull();
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<RecordTestCollectedHandler>()
            .HandleAsync(new RecordTestCollectedCommand(TestRecord, him, AppRole.Mukadam))))).Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<RecordTestCollectedHandler>()
            .HandleAsync(new RecordTestCollectedCommand(TestP2, him, AppRole.Mukadam))))).Should().BeNull();
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<OverridePlannedActivityHandler>()
            .HandleAsync(new OverridePlannedActivityCommand(Planned, FarmA, new DateOnly(2026, 10, 5), null, null, "पावसामुळे पुढे", Mukadam, "fix1-plan-p1")))))
            .Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<OverridePlannedActivityHandler>()
            .HandleAsync(new OverridePlannedActivityCommand(PlannedP2, FarmA, new DateOnly(2026, 10, 5), null, null, "पावसामुळे पुढे", Mukadam, "fix1-plan-p2")))))
            .Should().BeNull();
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<AddCostEntryCommand, AddCostEntryResultDto>>()
            .HandleAsync(new AddCostEntryCommand(FarmA, PlotA, CycleA, "fertilizer", "खत", 4545.45m, "INR", new DateOnly(2026, 10, 30), Mukadam)))))
            .Should().Be(Forbidden);
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<AddCostEntryCommand, AddCostEntryResultDto>>()
            .HandleAsync(new AddCostEntryCommand(FarmA, P2, CycleP2, "fertilizer", "खत", 5656.56m, "INR", new DateOnly(2026, 10, 30), Mukadam)))))
            .Should().BeNull();

        // Sync — the same refusals through the real push path; nothing of them is written.
        var settleSync = await PushAsync(Mukadam, "jobcard.settle", "fix1-settle-p1", new Dictionary<string, object?>
        {
            ["jobCardId"] = CardP1,
            ["actualPayoutAmount"] = 3434.34m,
            ["actualPayoutCurrencyCode"] = "INR",
        });
        settleSync.ErrorCode.Should().Be(Forbidden);
        (await CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE job_card_id = @id", CardP1)).Should().Be(0, "no money is written for P1's card");
        (await ScalarTextAsync("SELECT status FROM ssf.job_cards WHERE id = @id", CardP1)).Should().Be("VerifiedForPayout");
        var resolveSync = await PushAsync(Mukadam, "compliance.resolve", "fix1-resolve-p1", new Dictionary<string, object?>
        {
            ["signalId"] = SignalP1,
            ["note"] = "पाहिलं, ठीक आहे",
        });
        resolveSync.ErrorCode.Should().Be(Forbidden, "the sync payload names only the warning; its plot is asked in the handler");
        (await CountAsync("SELECT count(*) FROM ssf.compliance_signals WHERE \"Id\" = @id AND (resolved_at_utc IS NOT NULL OR acknowledged_at_utc IS NOT NULL)", SignalP1))
            .Should().Be(0, "P1's warning is untouched");

        // A saved record on P1 that he can name by its id: no task line, no revision, no move — even with the हजेरी grant that
        // lets him change other people's records on his plots (the control: a task line on the owner's P2 record). These doors
        // were already closed by MU-4's one-record gate (the push's record gate; the REST task route's authorizer); checked
        // here so the review's H1 list is answered for every write, not only the ones this fix pass gated.
        var ownerP2Log = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-owner-p2-log", new Dictionary<string, object?>
        {
            ["dailyLogId"] = ownerP2Log,
            ["farmId"] = FarmA,
            ["plotId"] = P2,
            ["cropCycleId"] = CycleP2,
            ["operatorUserId"] = Owner,
            ["logDate"] = WorkDay,
            ["content"] = Content("प्लॉट-दोन-काम"),
        });
        Dictionary<string, object?> TaskOn(Guid log) => new()
        {
            ["logTaskId"] = Guid.NewGuid(),
            ["dailyLogId"] = log,
            ["activityType"] = "spray",
            ["occurredAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        var tasksBefore = await CountAsync("SELECT count(*) FROM ssf.log_tasks WHERE daily_log_id = @id", OwnerLog);
        // REST (POST /logs/{id}/tasks, its pipeline as the route asks it): the one-record gate in its authorizer.
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<AddLogTaskCommand, DailyLogDto>>()
            .HandleAsync(new AddLogTaskCommand(OwnerLog, "spray", null, DateTime.UtcNow, Guid.NewGuid(), Mukadam)))))
            .Should().Be("ShramSafal.RecordAudience.Forbidden", "a task line on a record that stands only on P1");
        (await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<IHandler<AddLogTaskCommand, DailyLogDto>>()
            .HandleAsync(new AddLogTaskCommand(ownerP2Log, "spray", null, DateTime.UtcNow, Guid.NewGuid(), Mukadam)))))
            .Should().BeNull("on his plot, his grant works");
        // Sync: refused before any handler runs (MU-4's push-level record gate), with the plot rule's code.
        (await PushAsync(Mukadam, "add_log_task", "fix1-task-p1", TaskOn(OwnerLog))).ErrorCode.Should().Be(Forbidden);
        (await PushAsync(Mukadam, "revise_log_content", "fix1-revise-p1", new Dictionary<string, object?>
        {
            ["dailyLogId"] = OwnerLog,
            ["baseVersion"] = 1,
            ["content"] = Content("बदललेले-काम"),
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        })).ErrorCode.Should().Be(Forbidden);
        (await PushAsync(Mukadam, "move_daily_log", "fix1-move-p1", new Dictionary<string, object?>
        {
            ["dailyLogId"] = OwnerLog,
            ["baseVersion"] = 1,
            ["newPlotIds"] = new[] { P2 },
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        })).ErrorCode.Should().Be(Forbidden, "a record only on P1 is not his to pull onto his plots");
        (await ScalarTextAsync("SELECT plot_ids::text FROM ssf.daily_logs WHERE \"Id\" = @id", OwnerLog)).Should().Be($"{{{PlotA}}}");
        (await CountAsync("SELECT count(*) FROM ssf.log_tasks WHERE daily_log_id = @id", OwnerLog)).Should().Be(tasksBefore, "no task line was added to P1's record");
        (await PushAsync(Mukadam, "add_log_task", "fix1-task-p2", TaskOn(ownerP2Log))).Status.Should().Be("applied", "on his plot, his grant works");

        // M6 — the refused sync writes are kept whole for the owner (the L6 mark), as every authority refusal is; the phone
        // parks them visibly (the code's last segment is FORBIDDEN).
        await using var db = NewSuperuserContext();
        var kept = db.AuditEvents.Where(a => a.Action == "WorkKeptForOwner" && a.EntityType == "RefusedSyncMutation").ToList();
        kept.Select(a => a.ActorUserId.Value).Should().OnlyContain(id => id == Mukadam);
        kept.Should().Contain(a => a.Payload.Contains(SignalP1.ToString()), "the warning he could not resolve is kept for the owner");
        kept.Should().Contain(a => a.Payload.Contains(CardP1.ToString()), "and the payout he could not make");
    }

    // ── H2 + M1 + item 4 ─────────────────────────────────────────────────────────────────

    [Fact]
    public async Task H2_M1_labour_page_own_work_reads_his_own_row_and_chosen_plots_money_follows_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();

        // H2 — a मुकादम label on स्वतःचं काम who sees money and wages: the own-row view, nobody else's records or wages.
        await SetAuthoritiesAsync(FarmA, OwnWorker, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetPlotScopeAsync(OwnWorker, "OwnWork");
        var (ownStatus, own) = await GetAsync(OwnWorker, $"/shramsafal/farms/{FarmA}/labour");
        ownStatus.Should().Be(HttpStatusCode.OK, own);
        JsonDocument.Parse(own).RootElement.GetProperty("view").GetString().Should().Be("own", "own work is own work, whatever the label");
        foreach (var other in new[] { OwnerLog.ToString(), MukadamLog.ToString(), WorkerLog.ToString(), "432.17", "3457.36", CrewName })
        {
            own.Should().NotContain(other, "nobody else's record, crew or wage reaches an own-work seat");
        }

        // M1 — the owner pays P1's card and P2's card; Ramesh on {P2, P4} with money and wages counts only P2's.
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SettleAsOwnerAsync(CardP1, 4141.41m);
        await SettleAsOwnerAsync(CardP2, 1212.12m);

        // Item 4 — a crew's work words on P1, written by a कामगार (so they wait in the review inbox), today (the page's window).
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(5.5)).ToString("yyyy-MM-dd");
        var crewLog = Guid.NewGuid();
        var payload = LogPayload(crewLog, Worker2, Guid.NewGuid(), 4, 300m, null, [], null);
        payload["logDate"] = today;
        ((Dictionary<string, object?>)((object[])payload["labour"]!)[0])["task"] = CrewWordP1;
        await PushAppliedAsync(Worker2, "create_daily_log", "fix1-crew-p1", payload);

        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        var (ownerStatus, ownerPage) = await GetAsync(Owner, $"/shramsafal/farms/{FarmA}/labour");
        ownerStatus.Should().Be(HttpStatusCode.OK, ownerPage);
        ownerPage.Should().Contain("5353.53", "the owner's दिलं counts both payouts (the control)");
        ownerPage.Should().Contain(CrewWordP1, "the owner's review of a crew's work shows its words (the control)");

        var (mStatus, mPage) = await GetAsync(Mukadam, $"/shramsafal/farms/{FarmA}/labour");
        mStatus.Should().Be(HttpStatusCode.OK, mPage);
        mPage.Should().Contain("1212.12", "his plots' payout");
        mPage.Should().NotContain("5353.53", "never the farm's total").And.NotContain("4141.41", "nor P1's payout");
        mPage.Should().NotContain(CrewWordP1, "a crew's work words on P1 never reach him (item 4)");
    }

    // ── M2 + M3 ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M2_M3_a_moved_record_is_withdrawn_or_readmitted_and_a_narrowed_move_keeps_the_plots_he_cannot_see()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();

        // Before any choice: his own record on P1 + P2.
        var mukMulti = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "create_daily_log", "fix1-muk-multi", new Dictionary<string, object?>
        {
            ["dailyLogId"] = mukMulti,
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA, P2 },
            ["operatorUserId"] = Mukadam,
            ["logDate"] = WorkDay,
            ["content"] = Content("दोन-प्लॉट-फवारणी"),
        });
        var onP2 = Guid.NewGuid();
        var onP1 = Guid.NewGuid();
        var wholeFarm = Guid.NewGuid();
        var photoP1 = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-on-p2", PlotLog(onP2, P2, CycleP2));
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-on-p1", PlotLog(onP1, PlotA, CycleA));
        await PushAppliedAsync(Owner, "create_daily_log", "fix1-whole", new Dictionary<string, object?>
        {
            ["dailyLogId"] = wholeFarm,
            ["farmId"] = FarmA,
            ["scope"] = "Farm",
            ["operatorUserId"] = Owner,
            ["logDate"] = WorkDay,
            ["content"] = Content("संपूर्ण-शेत-काम"),
        });
        await PushAppliedAsync(Owner, "create_attachment", "fix1-photo-p1", new Dictionary<string, object?>
        {
            ["attachmentId"] = photoP1,
            ["farmId"] = FarmA,
            ["linkedEntityId"] = onP1,
            ["linkedEntityType"] = "DailyLog",
            ["fileName"] = "p1.jpg",
            ["mimeType"] = "image/jpeg",
        });

        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        await Task.Delay(1150);
        var (_, first) = await PullAsync(Mukadam);
        IdsOf(first, "dailyLogs").Should().Contain([onP2, mukMulti]).And.NotContain(onP1).And.NotContain(wholeFarm);
        var cursor = first.GetProperty("nextCursorUtc").GetDateTime();

        await NextWholeSecondAsync();
        await MoveAsync(Owner, "fix1-move-p2-p1", onP2, PlotA);
        await MoveAsync(Owner, "fix1-move-p1-p2", onP1, P2);
        await MoveAsync(Owner, "fix1-move-whole-p1", wholeFarm, PlotA);
        await Task.Delay(1150);

        var (body, after) = await PullAsync(Mukadam, cursor);
        var withdrawn = ArrayOf(after, "withdrawnRecords").Select(w => (w.GetProperty("kind").GetString(), w.GetProperty("id").GetGuid())).ToList();
        withdrawn.Should().Contain(("DailyLog", onP2), "a record moved off his plots leaves his phone");
        withdrawn.Select(w => w.Item2).Should().NotContain(wholeFarm, "a move between places he never covered is never hinted at");
        IdsOf(after, "dailyLogs").Should().Contain(onP1, "a record moved onto his plots arrives").And.NotContain(onP2);
        IdsOf(after, "attachments").Should().Contain(photoP1, "with its photo, which did not change itself");
        body.Should().NotContain(wholeFarm.ToString());

        // M3 — his move from his narrowed copy ({P2}) to P4 changes only his part: P1 stays.
        var moved = await PushAsync(Mukadam, "move_daily_log", "fix1-muk-move", new Dictionary<string, object?>
        {
            ["dailyLogId"] = mukMulti,
            ["baseVersion"] = 1,
            ["newPlotIds"] = new[] { P4 },
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        moved.Status.Should().Be("applied", moved.ErrorCode);
        var (_, ownerView) = await PullAsync(Owner);
        ArrayOf(ownerView, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == mukMulti)
            .GetProperty("plotIds").EnumerateArray().Select(p => p.GetGuid())
            .Should().BeEquivalentTo([PlotA, P4], "the plot he cannot see is kept as stored");
        var whole = await PushAsync(Mukadam, "move_daily_log", "fix1-muk-whole", new Dictionary<string, object?>
        {
            ["dailyLogId"] = mukMulti,
            ["baseVersion"] = 2,
            ["wholeFarm"] = true,
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        whole.ErrorCode.Should().Be(Forbidden, "a change that cannot touch his part alone is refused visibly");
    }

    // ── M4 + M5 + L3 ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M4_M5_L3_his_totals_and_left_out_count_are_his_plots_and_his_own_money_always_reaches_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney);

        // M5 — money he submitted on P1 before he was narrowed, and the सहमालक's own money (he does not see money).
        var mukP1 = Guid.NewGuid();
        await PushAppliedAsync(Mukadam, "add_cost_entry", "fix1-muk-p1", CostPayload(mukP1, FarmA, PlotA, CycleA, 1818.18m));
        var coOwn = Guid.NewGuid();
        await PushAppliedAsync(CoOwner, "add_cost_entry", "fix1-co-own", CostPayload(coOwn, FarmA, P2, CycleP2, 2727.27m));

        // M4 — a private P1 record and a private P2 record (kept from him by their audience), on different days.
        var privP1 = Guid.NewGuid();
        var privP2 = Guid.NewGuid();
        var p1Payload = CostPayload(privP1, FarmA, PlotA, CycleA, 3131.31m);
        p1Payload["entryDate"] = "2026-10-28";
        var p2Payload = CostPayload(privP2, FarmA, P2, CycleP2, 2121.21m);
        p2Payload["entryDate"] = "2026-10-29";
        await PushAppliedAsync(Owner, "add_cost_entry", "fix1-priv-p1", p1Payload);
        await PushAppliedAsync(Owner, "add_cost_entry", "fix1-priv-p2", p2Payload);
        foreach (var (id, key) in new[] { (privP1, "a"), (privP2, "b") })
        {
            await PushAppliedAsync(Owner, "set_record_audience", $"fix1-priv-{key}", new Dictionary<string, object?>
            {
                ["recordKind"] = "CostEntry",
                ["recordId"] = id,
                ["audience"] = "Selected",
                ["selectedUserIds"] = new[] { CoOwner },
                ["changedAtUtc"] = DateTime.UtcNow.ToString("O"),
            });
        }

        // L3 — P2's own money and its share of a bill split across P1 / P2.
        var costP2 = Guid.NewGuid();
        var split = Guid.NewGuid();
        await PushAppliedAsync(Owner, "add_cost_entry", "fix1-cost-p2", CostPayload(costP2, FarmA, P2, CycleP2, 2222.41m));
        var splitPayload = CostPayload(split, FarmA, P2, CycleP2, 6000.84m);
        splitPayload.Remove("plotId");
        splitPayload.Remove("cropCycleId");
        await PushAppliedAsync(Owner, "add_cost_entry", "fix1-split", splitPayload);
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id, created_at_utc, modified_at_utc)
            VALUES (@ledger, @farm, @split, DATE '2026-10-30', 'equal', @owner, NOW(), NOW());
            INSERT INTO ssf.day_ledger_allocations (id, day_ledger_id, plot_id, allocated_amount, currency_code, allocated_at_utc)
            VALUES (gen_random_uuid(), @ledger, @p1, 3500.51, 'INR', NOW()),
                   (gen_random_uuid(), @ledger, @p2, 2500.33, 'INR', NOW());
            """, ("ledger", Guid.NewGuid()), ("farm", FarmA), ("split", split), ("owner", Owner), ("p1", PlotA), ("p2", P2));

        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);

        var (_, pull) = await PullAsync(Mukadam);
        IdsOf(pull, "costEntries").Should().Contain(mukP1, "his own submission reaches him, whatever its plot (D-28)");
        var withheld = ScopeOf(pull).GetProperty("withheldRecordDays").EnumerateArray()
            .Where(d => d.GetProperty("kind").GetString() == "money").Select(d => d.GetProperty("date").GetString()).ToList();
        withheld.Should().Equal(["2026-10-29"], "only P2's private money is hinted at; P1's is never counted (M4)");

        var (_, coPull) = await PullAsync(CoOwner);
        IdsOf(coPull, "costEntries").Should().Contain(coOwn, "his own submission reaches him without see money (D-28)")
            .And.NotContain(costP2, "and nothing else of the farm's money");

        var (summaryStatus, summary) = await GetAsync(Mukadam, "/shramsafal/finance/summary?groupBy=plot");
        summaryStatus.Should().Be(HttpStatusCode.OK, summary);
        var root = JsonDocument.Parse(summary).RootElement;
        root.GetProperty("recordsNotCounted").GetInt32().Should().Be(1, "P2's private money only (M4)");
        var (plotStatus, plot) = await GetAsync(Mukadam, $"/shramsafal/finance/plot-summary?plotId={P2}");
        plotStatus.Should().Be(HttpStatusCode.OK, plot);
        var p2Total = JsonDocument.Parse(plot).RootElement.GetProperty("totalCosts").GetDecimal();
        var p2Group = root.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("groupKey").GetString() == P2.ToString());
        p2Group.GetProperty("totalAmount").GetDecimal().Should().Be(p2Total, "one P2 total on both summaries, the split share counted in both (L3)");
        p2Total.Should().Be(2222.41m + 2727.27m + 2500.33m);
    }

    // ── M7 + M9 + L1 ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M7_M9_L1_what_is_in_force_is_said_the_audit_stream_and_my_cards_follow_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.EditFarmSetup, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetAuthoritiesAsync(FarmA, Worker, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);

        // M7 — the owner's card.
        var (rosterStatus, roster) = await GetAsync(Owner, $"/shramsafal/farms/{FarmA}/labour-permissions");
        rosterStatus.Should().Be(HttpStatusCode.OK, roster);
        var rows = JsonDocument.Parse(roster).RootElement.EnumerateArray().ToList();
        JsonElement Row(Guid who) => rows.Single(r => r.GetProperty("userId").GetGuid() == who);
        Names(Row(Mukadam), "authoritiesNotInForce").Should().Equal(["EditFarmSetup", "ManageReminders"], "farm setup needs every plot; lane REM-1: so does changing who sees reminders");
        Names(Row(Mukadam), "authorities").Should().Contain("EditFarmSetup", "still stored: it comes back with every plot");
        Row(Worker).GetProperty("effectivePlotScope").GetString().Should().Be("OwnWork", "a कामगार reads his own work");
        Names(Row(Worker), "plotScopeChoices").Should().Equal(["OwnWork", "ChosenPlots"], "every plot would read as his own work");
        // lane MU-1 (MU-2 review N-3): review money needs see money, so it does nothing on his own-work seat either.
        Names(Row(Worker), "authoritiesNotInForce").Should().BeEquivalentTo(["SeeMoney", "SeeWages", "ReviewMoney", "SeeCompare", "ManageReminders"]); // lane CMP-D1 / REM-1: a Worker seat never holds them
        Names(Row(CoOwner), "authoritiesNotInForce").Should().BeEmpty();
        Row(CoOwner).GetProperty("effectivePlotScope").GetString().Should().Be("AllPlots");

        // M7 — /me/context stops claiming it (his phone offers no add-plot or boundary door); every plot keeps it.
        (await MeAuthoritiesAsync(Mukadam)).Should().Contain("SeeMoney").And.NotContain("EditFarmSetup");
        (await MeAuthoritiesAsync(CoOwner)).Should().Contain("EditFarmSetup", "a seat on every plot holds it (the control)");

        // M9 — the farm audit stream is the farm's, not a chosen-plots seat's.
        (await GetAsync(Mukadam, $"/shramsafal/audit?farmId={FarmA}")).Status.Should().Be(HttpStatusCode.Forbidden);
        (await GetAsync(Owner, $"/shramsafal/audit?farmId={FarmA}")).Status.Should().Be(HttpStatusCode.OK);

        // L1 — "my cards" matches the pull: his card on P1 is not his to read on {P2, P4}.
        var (cardsStatus, cards) = await GetAsync(Mukadam, $"/shramsafal/workers/{Mukadam}/job-cards");
        cardsStatus.Should().Be(HttpStatusCode.OK, cards);
        var cardIds = JsonDocument.Parse(cards).RootElement.EnumerateArray().Select(c => c.GetProperty("id").GetGuid()).ToList();
        cardIds.Should().Contain(CardMukP2).And.NotContain(CardMukP1);
        var (_, pull) = await PullAsync(Mukadam);
        IdsOf(pull, "jobCards").Should().Contain(CardMukP2).And.NotContain(CardMukP1);
    }

    // ── Seed ─────────────────────────────────────────────────────────────────────────────

    private async Task SeedAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, 'प्लॉट-दोन', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, 'प्लॉट-चार', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleP2, @farm, @p2, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                   (@cycleP4, @farm, @p4, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@own, '9300000188', 'स्वतःचे-काम-दत्ता', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @own, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            INSERT INTO ssf.compliance_signals ("Id", farm_id, plot_id, crop_cycle_id, rule_code, severity, suggested_action, title_en, title_mr,
                                                description_en, description_mr, payload_json, first_seen_at_utc, last_seen_at_utc)
            VALUES (@signalP1, @farm, @p1, @cycleA, 'fix1.rule.p1', 'NeedsAttention', 'OpenPlot', 'P1 warning', 'पहिला इशारा', 'd', 'd', '{}', NOW(), NOW()),
                   (@signalP2, @farm, @p2, @cycleP2, 'fix1.rule.p2', 'NeedsAttention', 'OpenPlot', 'P2 warning', 'दुसरा इशारा', 'd', 'd', '{}', NOW(), NOW());
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, assigned_worker_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, started_at_utc, completed_at_utc, linked_daily_log_id, line_items)
            VALUES (@cardP1, @farm, @p1, @cycleA, @owner, @worker, DATE '2026-10-30', 'VerifiedForPayout', NOW(), NOW(), NOW(), NOW(), @workerLog,
                    '[{"activityType":"spray","expectedHours":2,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb),
                   (@cardP2, @farm, @p2, @cycleP2, @owner, @worker, DATE '2026-10-30', 'VerifiedForPayout', NOW(), NOW(), NOW(), NOW(), @workerLog,
                    '[{"activityType":"spray","expectedHours":2,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb),
                   (@cardMukP1, @farm, @p1, @cycleA, @owner, @mukadam, DATE '2026-10-30', 'Assigned', NOW(), NOW(), NULL, NULL, NULL,
                    '[{"activityType":"weeding","expectedHours":3,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb),
                   (@cardMukP2, @farm, @p2, @cycleP2, @owner, @mukadam, DATE '2026-10-30', 'Assigned', NOW(), NOW(), NULL, NULL, NULL,
                    '[{"activityType":"weeding","expectedHours":3,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
            INSERT INTO ssf.test_instances (id, test_protocol_id, protocol_kind, crop_cycle_id, farm_id, plot_id, stage_name, planned_due_date, created_at_utc, modified_at_utc, status)
            VALUES (@testP2, @protocol, 0, @cycleP2, @farm, @p2, 'Vegetative', DATE '2026-10-01', NOW(), NOW(), 0);
            INSERT INTO ssf.planned_activities ("Id", crop_cycle_id, activity_name, stage, planned_date, created_at_utc, modified_at_utc)
            VALUES (@plannedP2, @cycleP2, 'छाटणी', 'Vegetative', DATE '2026-10-01', NOW(), NOW());
            """,
            ("p2", P2), ("p4", P4), ("farm", FarmA), ("cycleP2", CycleP2), ("cycleP4", CycleP4), ("own", OwnWorker), ("account", AccountA),
            ("signalP1", SignalP1), ("signalP2", SignalP2), ("p1", PlotA), ("cycleA", CycleA), ("cardP1", CardP1), ("cardP2", CardP2),
            ("cardMukP1", CardMukP1), ("cardMukP2", CardMukP2), ("owner", Owner), ("worker", Worker), ("mukadam", Mukadam),
            ("workerLog", WorkerLog), ("testP2", TestP2), ("protocol", Protocol), ("plannedP2", PlannedP2));
    }

    private async Task SetPlotScopeAsync(Guid person, string scope, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = scope, plotIds = plots.Length == 0 ? null : plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    private async Task MoveAsync(Guid actor, string requestId, Guid log, Guid plot) =>
        await PushAppliedAsync(actor, "move_daily_log", requestId, new Dictionary<string, object?>
        {
            ["dailyLogId"] = log,
            ["baseVersion"] = 1,
            ["newPlotIds"] = new[] { plot },
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });

    /// <summary>The owner pays a card through the real push path (kept, as the phone's payout is).</summary>
    private async Task SettleAsOwnerAsync(Guid card, decimal amount)
    {
        var pushed = await PushAsync(Owner, "jobcard.settle", $"fix1-owner-settle-{card:N}", new Dictionary<string, object?>
        {
            ["jobCardId"] = card,
            ["actualPayoutAmount"] = amount,
            ["actualPayoutCurrencyCode"] = "INR",
        });
        pushed.Status.Should().Be("applied", pushed.ErrorCode);
    }

    private static string? Code(AgriSync.BuildingBlocks.Results.Result result) => result.IsSuccess ? null : result.Error.Code;

    private static string? Code<T>(AgriSync.BuildingBlocks.Results.Result<T> result) => result.IsSuccess ? null : result.Error.Code;

    // ── Payloads ─────────────────────────────────────────────────────────────────────────

    private static Dictionary<string, object?> PlotLog(Guid id, Guid plot, Guid cycle) => new()
    {
        ["dailyLogId"] = id,
        ["farmId"] = FarmA,
        ["plotId"] = plot,
        ["cropCycleId"] = cycle,
        ["operatorUserId"] = Owner,
        ["logDate"] = WorkDay,
        ["content"] = Content("प्लॉटचे-काम"),
    };

    /// <summary>What Sathi understood for a record (a move needs it: the record's details are held by the server).</summary>
    private static object Content(string product) =>
        new { schema = 1, inputs = new object[] { new { id = "in-1", productName = product, quantity = 1, unit = "l" } } };

    // ── Reads ────────────────────────────────────────────────────────────────────────────


    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task<long> CountAsync(string sql, Guid id)
    {
        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(sql, db);
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<string?> ScalarTextAsync(string sql, Guid id)
    {
        await using var db = new Npgsql.NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = new Npgsql.NpgsqlCommand(sql, db);
        cmd.Parameters.AddWithValue("id", id);
        return (await cmd.ExecuteScalarAsync())?.ToString();
    }

    /// <summary>/me/context's authorities on farm A: the REAL reader over the app-role connection (RLS on).</summary>
    private async Task<IReadOnlyList<string>> MeAuthoritiesAsync(Guid who)
    {
        await using var ssf = new ShramSafalDbContext(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(AppConn).Options);
        // The accounts side (subscriptions) is not what is proved here; the farm side runs as agrisync_app with RLS on.
        await using var accounts = new AccountsDbContext(new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(SuperuserConn).Options);
        var farms = await new FarmMembershipSnapshotReader(ssf, accounts, new UtcClock()).GetForUserAsync(new UserId(who));
        return farms.Single(f => f.FarmId == new FarmId(FarmA)).Authorities.Select(a => a.Name).ToList();
    }

    private static List<string> Names(JsonElement row, string property) =>
        row.TryGetProperty(property, out var list) && list.ValueKind == JsonValueKind.Array
            ? list.EnumerateArray().Select(e => e.ValueKind == JsonValueKind.String ? e.GetString()! : e.GetProperty("name").GetString()!).ToList()
            : throw new InvalidOperationException($"the row carries no '{property}' list");

    private static JsonElement ScopeOf(JsonElement root) =>
        ArrayOf(root, "accessScopes").Single(s => s.GetProperty("farmId").GetGuid() == FarmA);

    private static async Task NextWholeSecondAsync()
    {
        var now = DateTime.UtcNow;
        await Task.Delay(TimeSpan.FromMilliseconds(1000 - now.Millisecond + 20));
    }

    private sealed class UtcClock : IClock
    {
        public DateTime UtcNow => DateTime.UtcNow;
    }
}
