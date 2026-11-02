// spec: plr-d10 lane MU-4 fix pass 2 (FIX-2.md; review REQUEST_CHANGES 44/50) — each finding proved on a real Postgres as
// agrisync_app (E3 first), through the real host, routes, handlers and push path:
//   N1  an own-records seat (a मुकादम label on स्वतःचं काम, and the कामगार label) reads nothing of another worker by REST:
//       his cards, his profile (counts and pay), his reputation, the crew roster, another person's record's state, a
//       question about another person's record; his own stay his;
//   M1  the हजेरी page tells a seat on chosen plots that its money is his plots' (scopedToPlots);
//   N2  a crop season named beside a plot is asked too (cost, job card, schedule-from-plan), and schedule-from-plan asks
//       farm membership first; N4 a plot refusal on REST carries its code; N5 a revise of a record spanning his plots and
//       others keeps the record's amounts by the server's own rule;
//   item 7  every gated door the review proved by reading only is asked here, at least one per family.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Application;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Dfes.GetRecentQuestionEvents;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
using ShramSafal.Application.UseCases.Tests.WaiveTestInstance;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Application.UseCases.Work.CancelJobCard;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Application.UseCases.Work.GetWorkerReputation;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Domain.Farms;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class PlotScopeFixPass2RealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid P2 = Guid.Parse("3d060000-0000-4000-8000-0000000000c2");
    private static readonly Guid P4 = Guid.Parse("3d060000-0000-4000-8000-0000000000c4");
    private static readonly Guid CycleP2 = Guid.Parse("3d060000-0000-4000-8000-0000000000d2");
    private static readonly Guid OwnWorker = Guid.Parse("3d060000-0000-4000-8000-000000000018");
    private static readonly Guid WorkerCard = Guid.Parse("3d060000-0000-4000-8000-000000000101");
    private static readonly Guid OwnWorkerCard = Guid.Parse("3d060000-0000-4000-8000-000000000102");
    private static readonly Guid MukadamCardP1 = Guid.Parse("3d060000-0000-4000-8000-000000000103");

    private const string Forbidden = "ShramSafal.PlotScope.Forbidden";

    // ── N1: one fact per door, so each rule is proved red on its own ────────────────────────

    /// <summary>The own-records seats (a मुकादम label on स्वतःचं काम, the कामगार label) and a seat that reads the farm's records.</summary>
    private async Task SeedReadersAsync()
    {
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, OwnWorker, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetPlotScopeAsync(OwnWorker, "OwnWork");
        await SetAuthoritiesAsync(FarmA, Worker2, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
    }

    [Fact]
    public async Task N1_cards_an_own_records_seat_reads_only_the_cards_assigned_to_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        foreach (var reader in new[] { OwnWorker, Worker2 })
        {
            // The worker page names its farm (the new phone does): the farm's scope is opened, as the route does.
            var (status, cards) = await GetAsync(reader, $"/shramsafal/workers/{Worker}/job-cards?farmId={FarmA}");
            status.Should().Be(HttpStatusCode.OK, cards);
            IdsIn(cards).Should().BeEmpty($"{reader} reads only the cards assigned to him, never another worker's");
        }

        var (ownStatus, own) = await GetAsync(OwnWorker, $"/shramsafal/workers/{OwnWorker}/job-cards?farmId={FarmA}");
        ownStatus.Should().Be(HttpStatusCode.OK, own);
        IdsIn(own).Should().Equal([OwnWorkerCard], "his own card stays his");
        IdsIn((await GetAsync(Owner, $"/shramsafal/workers/{Worker}/job-cards?farmId={FarmA}")).Body).Should().Contain(WorkerCard, "the control");
    }

    [Fact]
    public async Task N1_profile_another_workers_counts_and_pay_are_refused_as_a_withheld_profile_is()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        foreach (var reader in new[] { OwnWorker, Worker2 })
        {
            (await GetAsync(reader, $"/shramsafal/workers/{Worker}/profile?farmId={FarmA}")).Status
                .Should().Be(HttpStatusCode.Forbidden, $"{reader}: no other worker's counts or pay");
        }

        (await GetAsync(OwnWorker, $"/shramsafal/workers/{OwnWorker}/profile?farmId={FarmA}")).Status.Should().Be(HttpStatusCode.OK, "his own");
        var (mStatus, mProfile) = await GetAsync(Mukadam, $"/shramsafal/workers/{Worker}/profile?farmId={FarmA}");
        mStatus.Should().Be(HttpStatusCode.OK, mProfile);
        JsonDocument.Parse(mProfile).RootElement.GetProperty("earnedLast30d").ValueKind
            .Should().NotBe(JsonValueKind.Null, "a seat that reads the farm's records and sees wages (the control)");
    }

    [Fact]
    public async Task N1_reputation_the_farms_word_about_another_worker_is_not_an_own_records_seats()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        // The reputation route opens no tenant scope (it answers 500 to everyone in this host, before MU-4); its handler is
        // asked under his farm scope, as the profile and card routes open it.
        Task<string?> Ask(Guid reader) => AsFarmMemberAsync(FarmA, reader, async sp => Code(await sp.GetRequiredService<GetWorkerReputationHandler>()
            .HandleAsync(new GetWorkerReputationQuery(new UserId(Worker), new UserId(reader)))));
        (await Ask(OwnWorker)).Should().Be("ShramSafal.Forbidden");
        (await Ask(Worker2)).Should().Be("ShramSafal.Forbidden");
        (await Ask(Mukadam)).Should().BeNull("the control");
    }

    [Fact]
    public async Task N1_roster_the_crew_names_follow_the_own_row_view_as_the_labour_page_does()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        (await GetAsync(OwnWorker, $"/shramsafal/farms/{FarmA}/labour/field-operators")).Status.Should().NotBe(HttpStatusCode.OK);
        (await GetAsync(Mukadam, $"/shramsafal/farms/{FarmA}/labour/field-operators")).Status.Should().Be(HttpStatusCode.OK, "the control");
    }

    [Fact]
    public async Task N1_record_state_another_persons_record_is_not_his_his_own_is()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        var ownLog = Guid.NewGuid();
        await PushAppliedAsync(OwnWorker, "create_daily_log", "fix2-own-log", new Dictionary<string, object?>
        {
            ["dailyLogId"] = ownLog,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA,
            ["cropCycleId"] = CycleA,
            ["operatorUserId"] = OwnWorker,
            ["logDate"] = WorkDay,
        });
        // (the transitions route opens no tenant scope in this host, as fix pass 1 found; its rule is asked as the route asks it)
        async Task<bool> MayReadState(Guid reader, Guid logId) => await AsFarmMemberAsync(FarmA, reader, async sp =>
        {
            var repository = sp.GetRequiredService<ShramSafal.Application.Ports.IShramSafalRepository>();
            var log = await repository.GetDailyLogByIdAsync(logId);
            return await ShramSafal.Application.Services.OwnRecordsGate.MayReadRecordAsync(repository, log!, reader, DateTime.UtcNow);
        });
        (await MayReadState(OwnWorker, WorkerLog)).Should().BeFalse("another person's record's state is not his");
        (await MayReadState(OwnWorker, ownLog)).Should().BeTrue("his own record's is");
        (await MayReadState(Mukadam, WorkerLog)).Should().BeTrue("a seat that reads the farm's records (the control)");
    }

    [Fact]
    public async Task N1_questions_a_question_about_another_persons_record_never_names_it_to_him()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedReadersAsync();
        // Asked in one rolled-back transaction: the owner records it, then each reads.
        var (hisQuestions, ownersQuestions) = await AsFarmMemberAsync(FarmA, Owner, async sp =>
        {
            var recorded = await sp.GetRequiredService<RecordQuestionEventHandler>().HandleAsync(new RecordQuestionEventCommand(
                Owner, FarmA, PlotA, WorkerLog, "q.fix2.n1", "Grapes", null, null, "LogDate", "Log", "Choice", "Work", 1, 1, 0,
                "tap", "Safe", true, true, "b1", "e1", null, DateTime.UtcNow, null, null, "हो", null, null, null));
            recorded.IsSuccess.Should().BeTrue(recorded.IsFailure ? recorded.Error.Code : null);
            var reader = sp.GetRequiredService<GetRecentQuestionEventsHandler>();
            var his = await reader.HandleAsync(new GetRecentQuestionEventsQuery(OwnWorker, FarmA));
            var owners = await reader.HandleAsync(new GetRecentQuestionEventsQuery(Owner, FarmA));
            return (his.Value!.Select(q => q.dailyLogId).ToList(), owners.Value!.Select(q => q.dailyLogId).ToList());
        });
        ownersQuestions.Should().Contain(WorkerLog, "the control: the owner sees it");
        hisQuestions.Should().NotContain(WorkerLog);
    }

    // ── M1 label ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task M1_the_labour_page_tells_a_chosen_plots_seat_that_its_money_is_his_plots()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.SeeWages);
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);

        foreach (var (who, scoped) in new[] { (Mukadam, true), (Owner, false), (CoOwner, false) })
        {
            var (status, body) = await GetAsync(who, $"/shramsafal/farms/{FarmA}/labour");
            status.Should().Be(HttpStatusCode.OK, body);
            JsonDocument.Parse(body).RootElement.GetProperty("scopedToPlots").GetBoolean().Should().Be(scoped, $"{who}");
        }
    }

    // ── N2 / N4 / N5: one fact per rule ──────────────────────────────────────────────────

    /// <summary>Ramesh (the मुकादम) with हजेरी, money and money review, narrowed to {P2, P4}.</summary>
    private async Task SeedNarrowedAsync()
    {
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
    }

    private static object Schedule(Guid plot, Guid cycle) =>
        new { cropCycleId = cycle, farmId = FarmA, plotId = plot, cropType = "Grapes", stages = Array.Empty<object>() };

    [Fact]
    public async Task N2_money_naming_his_plot_with_P1s_season_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedNarrowedAsync();
        Task<string?> Add(Guid cycle, decimal amount) => AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp
            .GetRequiredService<IHandler<AddCostEntryCommand, AddCostEntryResultDto>>()
            .HandleAsync(new AddCostEntryCommand(FarmA, P2, cycle, "fertilizer", "खत", amount, "INR", new DateOnly(2026, 10, 30), Mukadam))));
        (await Add(CycleA, 3838.38m)).Should().Be(Forbidden, "P1's season beside his P2");
        (await Add(CycleP2, 3939.39m)).Should().BeNull("his plot with its own season (the control)");
    }

    [Fact]
    public async Task N2_a_task_naming_his_plot_with_P1s_season_is_refused()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedNarrowedAsync();
        Task<string?> Create(Guid cycle) => AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CreateJobCardHandler>()
            .HandleAsync(new CreateJobCardCommand(new FarmId(FarmA), P2, cycle, new DateOnly(2026, 11, 1),
                [new JobCardLineItemDto("spray", 2, 100, "INR", null)], new UserId(Mukadam), "fix2-card-season"))));
        (await Create(CycleA)).Should().Be(Forbidden);
        (await Create(CycleP2)).Should().BeNull("the control");
    }

    [Fact]
    public async Task N2_schedule_from_plan_asks_farm_membership_first()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedNarrowedAsync();
        (await PostAsync(OwnerB, "/shramsafal/test-instances/schedule-from-plan", Schedule(PlotA, CycleA))).Status
            .Should().Be(HttpStatusCode.Forbidden, "not a member of the farm (what plan generation asks before scheduling the same due dates)");
    }

    [Fact]
    public async Task N2_schedule_from_plan_asks_that_the_season_is_this_plots_on_this_farm()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedNarrowedAsync();
        (await PostAsync(Mukadam, "/shramsafal/test-instances/schedule-from-plan", Schedule(P2, CycleA))).Status
            .Should().Be(HttpStatusCode.BadRequest, "P1's season named beside his P2");
    }

    [Fact]
    public async Task N4_a_plot_refusal_on_REST_carries_its_code_and_the_owners_off_plot_assign_is_refused_by_the_plot_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedNarrowedAsync();
        var (status, body) = await PostAsync(Mukadam, "/shramsafal/test-instances/schedule-from-plan", Schedule(PlotA, CycleA));
        status.Should().Be(HttpStatusCode.Forbidden);
        body.Should().Contain(Forbidden, "the 403 names the plot rule, never a bare forbidden");
        (await AsFarmMemberAsync(FarmA, Owner, async sp => Code(await sp.GetRequiredService<AssignJobCardHandler>()
            .HandleAsync(new AssignJobCardCommand(JobCard, new UserId(Mukadam), new UserId(Owner), "fix2-assign-p1")))))
            .Should().Be(Forbidden, "the owner gives P1's task to someone whose plots do not include it");
    }

    [Fact]
    public async Task N5_a_revise_of_a_record_spanning_his_plots_and_others_keeps_the_amounts_by_the_servers_own_rule()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney);
        var spanning = Guid.NewGuid();
        await PushAppliedAsync(Owner, "create_daily_log", "fix2-spanning", new Dictionary<string, object?>
        {
            ["dailyLogId"] = spanning,
            ["farmId"] = FarmA,
            ["scope"] = "MultiPlot",
            ["plotIds"] = new[] { PlotA, P2 },
            ["operatorUserId"] = Owner,
            ["logDate"] = WorkDay,
            ["content"] = new
            {
                schema = 1,
                inputs = new object[]
                {
                    new
                    {
                        id = "in-1", productName = "दोन-प्लॉट-औषध", quantity = 1, unit = "l", cost = 1717.17m,
                        numbers = new { cost = new { certainty = "reported", spokenText = "खर्च सांगितला" } },
                    },
                },
            },
        });
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);

        // He revises his narrowed copy (P2 only, no amount); his phone does not say the amounts were withheld.
        var revised = await PushAsync(Mukadam, "revise_log_content", "fix2-revise-spanning", new Dictionary<string, object?>
        {
            ["dailyLogId"] = spanning,
            ["baseVersion"] = 1,
            ["content"] = new { schema = 1, inputs = new object[] { new { id = "in-1", productName = "बदललेले-औषध", quantity = 2, unit = "l" } } },
            ["amountsWithheld"] = false,
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        revised.Status.Should().Be("applied", revised.ErrorCode);
        var (_, owner) = await PullAsync(Owner);
        // The record's content (its task line's note keeps the amount in any case, so the CONTENT is what is asked).
        ArrayOf(owner, "dailyLogs").Single(l => l.GetProperty("id").GetGuid() == spanning)
            .GetProperty("content").GetProperty("document").GetRawText()
            .Should().Contain("बदललेले-औषध", "his change is applied").And.Contain("1717.17", "the record's amount is kept");
    }

    // ── Item 7: the doors proved by reading only ─────────────────────────────────────────

    [Fact]
    public async Task Item7_every_gated_door_refuses_P1_one_per_family()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedAsync();
        await SetAuthoritiesAsync(FarmA, Mukadam, FarmAuthority.TakeAttendance, FarmAuthority.SeeMoney, FarmAuthority.ReviewMoney,
            FarmAuthority.ConfirmRecords, FarmAuthority.LabRecords);
        var unplaced = Guid.NewGuid();
        var unplacedCost = CostPayload(unplaced, FarmA, P2, CycleP2, 4242.42m);
        unplacedCost.Remove("plotId");
        unplacedCost.Remove("cropCycleId");
        await PushAppliedAsync(Mukadam, "add_cost_entry", "fix2-own-unplaced", unplacedCost);
        await SetPlotScopeAsync(Mukadam, "ChosenPlots", P2, P4);
        var him = new UserId(Mukadam);

        var doors = new Dictionary<string, string?>
        {
            // job cards
            ["start"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<StartJobCardHandler>()
                .HandleAsync(new StartJobCardCommand(MukadamCardP1, him, "fix2-start")))),
            ["cancel"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CancelJobCardHandler>()
                .HandleAsync(new CancelJobCardCommand(JobCard, "चुकीचं", him, "fix2-cancel")))),
            // tests
            ["waive"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<WaiveTestInstanceHandler>()
                .HandleAsync(new WaiveTestInstanceCommand(TestRecord, "नको", him, AppRole.Mukadam)))),
            // planned work
            ["plan-add"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<AddLocalPlannedActivityHandler>()
                .HandleAsync(new AddLocalPlannedActivityCommand(Guid.NewGuid(), CycleA, FarmA, "खुरपणी", "Vegetative",
                    new DateOnly(2026, 11, 5), "गरज", Mukadam, "fix2-plan-add")))),
            ["plan-remove"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<RemovePlannedActivityHandler>()
                .HandleAsync(new RemovePlannedActivityCommand(Planned, FarmA, "नको", Mukadam, "fix2-plan-remove")))),
            ["plan-generate"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<GeneratePlanFromTemplateHandler>()
                .HandleAsync(new GeneratePlanFromTemplateCommand(Mukadam, CycleA, "नमुना", "Vegetative", new DateOnly(2026, 11, 1),
                    [new TemplateActivityInput("फवारणी", 1)])))),
            // schedules
            ["schedule-adopt"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<AdoptScheduleHandler>()
                .HandleAsync(new AdoptScheduleCommand(FarmA, PlotA, CycleA, Guid.NewGuid(), Mukadam)))),
            // seasons
            ["crop-cycle"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CreateCropCycleHandler>()
                .HandleAsync(new CreateCropCycleCommand(FarmA, PlotA, "Grapes", "Vegetative", new DateOnly(2027, 1, 1), null, Mukadam)))),
            // money
            ["allocate"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<AllocateGlobalExpenseHandler>()
                .HandleAsync(new AllocateGlobalExpenseCommand(unplaced, "custom",
                    [new AllocateGlobalExpenseAllocationCommand(PlotA, 2000m), new AllocateGlobalExpenseAllocationCommand(P2, 2242.42m)], Mukadam)))),
            // records (REST /logs)
            ["rest-logs"] = await AsFarmMemberAsync(FarmA, Mukadam, async sp => Code(await sp.GetRequiredService<CreateDailyLogHandler>()
                .HandleAsync(new CreateDailyLogCommand(FarmA, PlotA, CycleA, Mukadam, Mukadam, new DateOnly(2026, 10, 30), null, null, "fix2-rest-log")))),
        };
        // assign: the owner gives P1's task to him (the assignee's plots), asked in the N4 fact; here the caller's own plots.
        doors["assign"] = await AsFarmMemberAsync(FarmA, Owner, async sp => Code(await sp.GetRequiredService<AssignJobCardHandler>()
            .HandleAsync(new AssignJobCardCommand(JobCard, him, new UserId(Owner), "fix2-assign"))));

        foreach (var (door, code) in doors)
        {
            Output.WriteLine($"[door] {door} -> {code ?? "applied"}");
        }

        doors.Should().AllSatisfy(d => d.Value.Should().Be(Forbidden, $"the {d.Key} door names P1"));
    }

    // ── Seed ─────────────────────────────────────────────────────────────────────────────

    private async Task SeedAsync()
    {
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@p2, @farm, 'प्लॉट-दोन', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day'),
                   (@p4, @farm, 'प्लॉट-चार', 1.0, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day');
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@cycleP2, @farm, @p2, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
            INSERT INTO public.users ("Id", phone, display_name, password_hash, credential_created_at_utc, created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@own, '9300000288', 'स्वतःचे-काम-दत्ता', 'x', NOW(), NOW(), TRUE, 0, 'mr');
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, permissions, can_manage_labour_records)
            VALUES (gen_random_uuid(), @farm, @own, 'Mukadam', NOW() - INTERVAL '30 days', NOW(), @account, 3, NULL, FALSE);
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, assigned_worker_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, started_at_utc, completed_at_utc, linked_daily_log_id, line_items)
            VALUES (@workerCard, @farm, @p1, @cycleA, @owner, @worker, DATE '2026-10-30', 'PaidOut', NOW(), NOW(), NOW(), NOW(), @workerLog,
                    '[{"activityType":"spray","expectedHours":2,"rateAmount":555,"rateCurrencyCode":"INR","notes":null}]'::jsonb),
                   (@ownCard, @farm, @p1, @cycleA, @owner, @own, DATE '2026-10-30', 'Assigned', NOW(), NOW(), NULL, NULL, NULL,
                    '[{"activityType":"weeding","expectedHours":3,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb),
                   (@mukCardP1, @farm, @p1, @cycleA, @owner, @mukadam, DATE '2026-10-30', 'Assigned', NOW(), NOW(), NULL, NULL, NULL,
                    '[{"activityType":"weeding","expectedHours":3,"rateAmount":100,"rateCurrencyCode":"INR","notes":null}]'::jsonb);
            """,
            ("p2", P2), ("p4", P4), ("farm", FarmA), ("cycleP2", CycleP2), ("own", OwnWorker), ("account", AccountA),
            ("workerCard", WorkerCard), ("ownCard", OwnWorkerCard), ("mukCardP1", MukadamCardP1), ("p1", PlotA), ("cycleA", CycleA),
            ("owner", Owner), ("worker", Worker), ("mukadam", Mukadam), ("workerLog", WorkerLog));
    }

    private async Task SetPlotScopeAsync(Guid person, string scope, params Guid[] plots)
    {
        using var response = await SendAsync(HttpMethod.Put, $"/shramsafal/farms/{FarmA}/memberships/{person}/plot-scope", Owner,
            new { plotScope = scope, plotIds = plots.Length == 0 ? null : plots });
        var text = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, $"the primary account holder sets {person}'s plots: {text}");
    }

    private async Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url)
    {
        using var response = await SendAsync(HttpMethod.Get, url, user);
        return (response.StatusCode, await response.Content.ReadAsStringAsync());
    }

    private async Task<(HttpStatusCode Status, string Body)> PostAsync(Guid user, string url, object body)
    {
        using var response = await SendAsync(HttpMethod.Post, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[POST] {url} by {user} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private static IReadOnlyList<Guid> IdsIn(string jsonArray) =>
        JsonDocument.Parse(jsonArray).RootElement.EnumerateArray().Select(e => e.GetProperty("id").GetGuid()).ToList();

    private static string? Code(AgriSync.BuildingBlocks.Results.Result result) => result.IsSuccess ? null : result.Error.Code;

    private static string? Code<T>(AgriSync.BuildingBlocks.Results.Result<T> result) => result.IsSuccess ? null : result.Error.Code;
}
