// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-3 Tasks 1-2 (founder D-24d, D-30, D-1, P3, E4, D-26).
// "काम झालं" through the real log, plot by plot: who may say it, what a log must be, what each plot does, the task counting
// once, the owner's reopen, and the three words of ConfirmationState. The handlers run on an in-memory repository (no database);
// the same rules run again against real Postgres in PlannedWorkCompleteRealPostgresTests.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using Xunit;
using static ShramSafal.Domain.Tests.Planning.PlannedWorkTests;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedWorkCompleteTests
{
    private static readonly Guid Santosh = Guid.Parse("8c300000-0000-4000-8000-000000000021");
    private static readonly Guid OtherFarm = Guid.Parse("8c300000-0000-4000-8000-0000000000f2");
    private static readonly Guid ForeignPlot = Guid.Parse("8c300000-0000-4000-8000-0000000000b1");

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }

    /// <summary>One farm, an owner (Creator), two workers, the logs of the farm, a recording of what was audited.</summary>
    private sealed class Repo : Work.Handlers.StubShramSafalRepository, IShramSafalRepository
    {
        private readonly List<PlannedWork> tasks = [];
        private readonly Dictionary<Guid, DailyLog> logs = [];
        public List<AuditEvent> Audit { get; } = [];
        public int Saves { get; private set; }

        public Repo Hold(PlannedWork work)
        {
            tasks.Add(work);
            return this;
        }

        public DailyLog Log(Guid plot, Guid? farm = null, Guid? by = null, params Guid[] morePlots)
        {
            var id = Guid.NewGuid();
            var log = morePlots.Length == 0
                ? DailyLog.Create(id, new FarmId(farm ?? PlannedWorkTests.Farm), plot, Guid.NewGuid(), new UserId(by ?? Raju),
                    new DateOnly(2026, 11, 8), null, null, Now)
                : DailyLog.CreateForMultiPlot(id, new FarmId(farm ?? PlannedWorkTests.Farm), [plot, .. morePlots], new UserId(by ?? Raju),
                    new DateOnly(2026, 11, 8), null, null, Now);
            logs[id] = log;
            return log;
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audit.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(farmId != PlannedWorkTests.Farm
                ? null
                : userId == Creator
                    ? new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null)
                    : userId == Raju || userId == Santosh || userId == Stranger
                        ? new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false, null)
                        : null);

        public Task<PlannedWork?> GetPlannedWorkByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(tasks.FirstOrDefault(t => t.Id == id));

        public Task<bool> TrySavePlannedWorkChangeAsync(CancellationToken ct = default)
        {
            Saves++;
            return Task.FromResult(true);
        }

        public Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmByIdsAsync(FarmId farmId, IReadOnlyCollection<Guid> ids, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyList<DailyLog>>(logs.Values.Where(l => l.FarmId == farmId && ids.Contains(l.Id)).ToList());
    }

    private static PlannedWorkCaller By(Guid user) => new(user, "Worker", "req-1", "1.0.18", "device");

    private static CompletePlannedWorkHandler Handler(Repo repo, DateTime? now = null) =>
        new(repo, new FixedClock(now ?? Now.AddHours(2)));

    private static CompletePlannedWorkCommand Complete(
        PlannedWork task, Guid by, Guid[]? plots = null, Guid[]? logs = null, bool left = false, Guid? farm = null) =>
        new(task.Id, farm ?? PlannedWorkTests.Farm, plots ?? [], logs ?? [], left, By(by));

    /// <summary>Urea on ऊस 1 and ऊस 2, given to Raju by the owner and accepted.</summary>
    private static PlannedWork TwoPlotUrea(Repo repo)
    {
        var task = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB], assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(5));
        repo.Hold(task);
        return task;
    }

    // ── the rules of the step ────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Handed_out_work_without_a_log_is_refused_and_a_reminder_is_done_without_one()
    {
        var repo = new Repo();
        var handedOut = Make(Details(assignee: Raju));
        repo.Hold(handedOut);

        var refused = await Handler(repo).HandleAsync(Complete(handedOut, Raju, [PlotA]));
        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkLogInvalid.Code);
        refused.Error.Code.Should().EndWith(".InvalidCommand", "every phone in the field parks a code ending so (P10)");
        handedOut.Status.Should().NotBe(PlannedWorkStatus.Done);
        repo.Audit.Should().BeEmpty("a refusal writes no audit row");

        // D-1: "झाले" on his own reminder needs no log - whether it names no one or himself.
        var reminder = Make(Details(), by: Raju);
        var selfGiven = Make(Details(assignee: Raju), by: Raju);
        repo.Hold(reminder).Hold(selfGiven);
        foreach (var mine in new[] { reminder, selfGiven })
        {
            var done = await Handler(repo).HandleAsync(Complete(mine, Raju, [PlotA]));
            done.IsSuccess.Should().BeTrue();
            done.Value!.Status.Should().Be("Done");
            done.Value.ConfirmationState.Should().BeNull("no linked log is no word, not Waiting");
        }
    }

    [Fact]
    public async Task Urea_on_two_plots_done_on_the_first_leaves_the_second_pending_and_the_task_partly_done_counted_once()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var log = repo.Log(PlotA);

        var result = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [log.Id]));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Status.Should().Be("Accepted", "one plot of two is not the work done");
        result.Value.DoneAtUtc.Should().BeNull();
        result.Value.Plots.Single(p => p.PlotId == PlotA).Status.Should().Be("Done");
        result.Value.Plots.Single(p => p.PlotId == PlotB).Status.Should().Be("Pending");
        result.Value.Plots.Single(p => p.PlotId == PlotA).LinkedDailyLogIds.Should().Equal(log.Id);
        result.Value.Plots.Single(p => p.PlotId == PlotB).LinkedDailyLogIds.Should().BeEmpty();
        result.Value.LinkedDailyLogIds.Should().Equal(log.Id);
        result.Value.Plots.Should().HaveCount(2, "the task counts once, with a line per plot");

        // The second plot, later, closes the task.
        var second = repo.Log(PlotB);
        var closed = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotB], [second.Id]));
        closed.Value!.Status.Should().Be("Done");
        closed.Value.DoneByUserId.Should().Be(Raju);
        closed.Value.LinkedDailyLogIds.Should().BeEquivalentTo([log.Id, second.Id]);
    }

    [Fact]
    public async Task One_log_on_both_plots_serves_both_and_somethingLeft_keeps_the_task_pending_until_he_says_nothing_is_left()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var both = repo.Log(PlotA, morePlots: PlotB);

        var partly = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [both.Id], left: true));
        partly.Value!.Status.Should().Be("Accepted", "somethingLeft keeps it pending, never Done");
        partly.Value.Plots.Should().OnlyContain(p => p.Status == "Done");
        partly.Value.LinkedDailyLogIds.Should().Equal(both.Id);

        // He says nothing is left: the plots are already done, so this only closes the task (and links no log twice).
        var closed = await Handler(repo).HandleAsync(Complete(task, Raju, [], [both.Id], left: false));
        closed.Value!.Status.Should().Be("Done");
        closed.Value.LinkedDailyLogIds.Should().Equal(both.Id);
    }

    [Fact]
    public async Task A_task_with_no_plots_is_done_when_nothing_is_left()
    {
        var repo = new Repo();
        var task = Make(Details(PlannedWorkScope.Farm, assignee: Raju));
        repo.Hold(task);
        var log = repo.Log(PlotB);

        var partly = await Handler(repo).HandleAsync(Complete(task, Raju, [], [log.Id], left: true));
        partly.Value!.Status.Should().Be("Accepted");
        var done = await Handler(repo).HandleAsync(Complete(task, Raju, [], [log.Id], left: false));
        done.Value!.Status.Should().Be("Done");
    }

    [Fact]
    public async Task A_log_on_another_plot_or_another_farm_or_a_made_up_one_is_refused()
    {
        var repo = new Repo();
        var task = Make(Details(assignee: Raju)); // plot A
        repo.Hold(task);

        var elsewhere = repo.Log(PlotB);
        var wrongPlot = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [elsewhere.Id]));
        wrongPlot.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkLogInvalid.Code);

        var foreign = repo.Log(PlotA, farm: OtherFarm);
        var otherFarm = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [foreign.Id]));
        otherFarm.Error.Code.Should().Be(ShramSafalErrors.DailyLogNotFound.Code, "another farm's log answers like a made-up one (E4)");
        var madeUp = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [Guid.NewGuid()]));
        madeUp.Error.Code.Should().Be(otherFarm.Error.Code);

        task.Status.Should().NotBe(PlannedWorkStatus.Done);
        repo.Saves.Should().Be(0);
    }

    [Fact]
    public async Task A_plot_of_another_farm_with_this_farm_id_is_refused_like_an_unknown_plot()
    {
        var repo = new Repo();
        var task = Make(Details(assignee: Raju));
        repo.Hold(task);
        var log = repo.Log(PlotA);

        var foreign = await Handler(repo).HandleAsync(Complete(task, Raju, [ForeignPlot], [log.Id]));
        var unknown = await Handler(repo).HandleAsync(Complete(task, Raju, [Guid.NewGuid()], [log.Id]));
        foreign.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkPlotsInvalid.Code);
        unknown.Error.Should().Be(foreign.Error, "the two answers are identical (E4)");
        foreign.Error.Code.Should().EndWith(".InvalidCommand");

        // A task of another farm is not found, however it is asked.
        var wrongFarm = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [log.Id], farm: OtherFarm));
        wrongFarm.Error.Code.Should().Be(ShramSafalErrors.Forbidden.Code, "he holds no seat on that farm");
    }

    [Fact]
    public async Task Only_the_assignee_says_it_is_done_the_old_assignee_and_a_plan_work_holder_do_not_even_on_a_closed_task()
    {
        var repo = new Repo();
        var task = Make(Details(assignee: Raju));
        repo.Hold(task);
        var log = repo.Log(PlotA);

        // The owner, a stranger and the old assignee are all "not yours" - before any question about the state.
        foreach (var other in new[] { Creator, Stranger, Santosh })
        {
            var refused = await Handler(repo).HandleAsync(Complete(task, other, [PlotA], [log.Id]));
            refused.Error.Code.Should().Be(ShramSafalErrors.Forbidden.Code, $"{other} is not the assignee");
        }

        // Reassigned to Santosh: Raju, the OLD assignee, is Forbidden - and stays Forbidden once the task is Done.
        task.Edit(Details(assignee: Santosh), Now.AddMinutes(30));
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [log.Id]))).Error.Code.Should().Be(ShramSafalErrors.Forbidden.Code);
        (await Handler(repo).HandleAsync(Complete(task, Santosh, [PlotA], [log.Id]))).IsSuccess.Should().BeTrue();
        task.Status.Should().Be(PlannedWorkStatus.Done);
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [log.Id]))).Error.Code.Should().Be(ShramSafalErrors.Forbidden.Code);
        task.Cancel(Creator, null, Now.AddHours(3)).Should().Be(PlannedWorkStep.Closed, "a done task cannot be cancelled");
    }

    [Fact]
    public async Task A_second_complete_is_a_no_op_and_never_undoes_anything_and_a_cancelled_task_takes_none()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var log = repo.Log(PlotA, morePlots: PlotB);
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [log.Id]))).Value!.Status.Should().Be("Done");
        var stamp = task.DoneAtUtc;
        var saves = repo.Saves;

        var again = await Handler(repo, Now.AddHours(9)).HandleAsync(Complete(task, Raju, [PlotA], [log.Id], left: true));
        again.IsSuccess.Should().BeTrue();
        again.Value!.Status.Should().Be("Done", "a replay with somethingLeft never un-does a done task");
        task.DoneAtUtc.Should().Be(stamp);
        repo.Saves.Should().Be(saves, "nothing was saved");
        repo.Audit.Where(a => a.Action == "PlannedWorkCompleted").Should().ContainSingle();

        var cancelled = Make(Details(assignee: Raju));
        cancelled.Cancel(Creator, "पाऊस", Now.AddMinutes(1));
        repo.Hold(cancelled);
        (await Handler(repo).HandleAsync(Complete(cancelled, Raju, [PlotA], [repo.Log(PlotA).Id])))
            .Error.Code.Should().Be(ShramSafalErrors.PlannedWorkStateChanged.Code);
    }

    [Fact]
    public async Task Handed_out_work_needs_a_log_on_every_plot_named_and_a_log_may_not_be_one_he_cannot_see()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var onlyA = repo.Log(PlotA);

        // Both plots named, a log on one only: plot B would be marked done with nothing to show for it.
        var thin = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [onlyA.Id]));
        thin.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkLogInvalid.Code);

        // Plots named that are not the task's, or an empty list while plots are still pending.
        (await Handler(repo).HandleAsync(Complete(task, Raju, [], [onlyA.Id]))).Error.Code.Should().Be(ShramSafalErrors.PlannedWorkPlotsInvalid.Code);
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotA], [onlyA.Id]))).Error.Code.Should().Be(ShramSafalErrors.PlannedWorkPlotsInvalid.Code);
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [onlyA.Id, onlyA.Id]))).Error.Code.Should().Be(ShramSafalErrors.PlannedWorkInvalid.Code);
        task.LivePlots.Should().OnlyContain(p => p.Status == PlannedWorkPlotStatus.Pending);
    }

    [Fact]
    public async Task Completing_an_unaccepted_task_counts_as_accepting_it_and_the_audit_row_holds_exactly_the_four_fields()
    {
        var repo = new Repo();
        var task = Make(Details(assignee: Raju));
        repo.Hold(task);
        var log = repo.Log(PlotA);

        var result = await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [log.Id]));
        result.Value!.AcceptedAtUtc.Should().NotBeNull();
        result.Value.SeenAtUtc.Should().NotBeNull();

        var row = repo.Audit.Should().ContainSingle().Which;
        row.EntityType.Should().Be("PlannedWork");
        System.Text.Json.JsonDocument.Parse(row.Payload).RootElement.EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(["plannedWorkId", "farmId", "status", "step"]);
        row.Payload.Should().NotContain(log.Id.ToString()).And.NotContain(Raju.ToString()).And.NotContain("द्राक्षाला");
    }

    [Fact]
    public async Task The_complete_step_references_no_job_card_cost_attendance_or_labour_type()
    {
        // D-24a / P4, on the surface this lane adds: the two commands and the two handlers name no such type.
        var forbidden = new[] { "Attendance", "Labour", "Cost", "JobCard", "Wage", "Payment", "Finance", "Ledger" };
        var types = new[]
        {
            typeof(CompletePlannedWorkCommand), typeof(ReopenPlannedWorkCommand),
            typeof(CompletePlannedWorkHandler), typeof(ReopenPlannedWorkHandler),
        };
        foreach (var type in types)
        {
            var named = type.GetConstructors().SelectMany(c => c.GetParameters().Select(p => p.ParameterType))
                .Concat(type.GetProperties().Select(p => p.PropertyType))
                .Concat(type.GetMethods().SelectMany(m => m.GetParameters().Select(p => p.ParameterType)));
            foreach (var t in named)
            {
                forbidden.Any(w => $"{t.Namespace}.{t.Name}".Contains(w, StringComparison.Ordinal)).Should().BeFalse($"{t} is not for planned work");
            }
        }

        await Task.CompletedTask;
    }

    // ── the owner's reopen ───────────────────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Reopen_is_for_the_primary_owner_only_with_a_reason_and_goes_back_to_accepted()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var log = repo.Log(PlotA, morePlots: PlotB);
        await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [log.Id]));
        task.Status.Should().Be(PlannedWorkStatus.Done);
        var reopen = new ReopenPlannedWorkHandler(repo, new FixedClock(Now.AddHours(5)));

        // Not the owner: the assignee (who sees the task) and a worker are Forbidden / not found; the task stays Done.
        (await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "काम नीट नाही", By(Raju))))
            .Error.Code.Should().Be(ShramSafalErrors.Forbidden.Code);
        (await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "काम नीट नाही", By(Stranger))))
            .Error.Code.Should().Be(ShramSafalErrors.PlannedWorkNotFound.Code, "he cannot even see the task");
        task.Status.Should().Be(PlannedWorkStatus.Done);

        // The owner needs a reason.
        foreach (var bad in new string?[] { null, "", "   ", new string('x', 501) })
        {
            (await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, bad, By(Creator))))
                .Error.Code.Should().Be(ShramSafalErrors.PlannedWorkInvalid.Code);
        }

        task.Status.Should().Be(PlannedWorkStatus.Done);

        var ok = await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "  काम नीट नाही  ", By(Creator)));
        ok.IsSuccess.Should().BeTrue();
        ok.Value!.Status.Should().Be("Accepted");
        ok.Value.DoneAtUtc.Should().BeNull();
        ok.Value.DoneByUserId.Should().BeNull();
        ok.Value.Plots.Should().OnlyContain(p => p.Status == "Pending" && p.DoneAtUtc == null && p.LinkedDailyLogIds.Count == 0);
        ok.Value.LinkedDailyLogIds.Should().BeEmpty();
        ok.Value.ConfirmationState.Should().BeNull();

        // The history is the audit row: the four fields and the reason (and nothing else).
        var row = repo.Audit.Last();
        row.Action.Should().Be("PlannedWorkReopened");
        System.Text.Json.JsonDocument.Parse(row.Payload).RootElement.EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(["plannedWorkId", "farmId", "status", "step", "reason"]);
        System.Text.Json.JsonDocument.Parse(row.Payload).RootElement.GetProperty("reason").GetString().Should().Be("काम नीट नाही", "trimmed, in his words");

        // Done again, by the assignee, is possible; a reopen of a task that is not Done has nothing to reopen.
        (await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "पुन्हा", By(Creator))))
            .Error.Code.Should().Be(ShramSafalErrors.PlannedWorkStateChanged.Code);
        (await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [log.Id]))).Value!.Status.Should().Be("Done");
    }

    [Fact]
    public async Task Reopen_by_a_seat_that_cannot_see_the_task_answers_exactly_like_a_made_up_id_and_one_that_sees_it_is_Forbidden_L008()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var log = repo.Log(PlotA, morePlots: PlotB);
        await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA, PlotB], [log.Id]));
        var reopen = new ReopenPlannedWorkHandler(repo, new FixedClock(Now.AddHours(5)));

        var hidden = await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "x", By(Stranger)));
        var madeUp = await reopen.HandleAsync(new ReopenPlannedWorkCommand(Guid.NewGuid(), PlannedWorkTests.Farm, "x", By(Stranger)));
        hidden.Error.Should().Be(madeUp.Error, "no id leak");
        hidden.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkNotFound.Code);
        (await reopen.HandleAsync(new ReopenPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "x", By(Raju)))).Error.Code
            .Should().Be(ShramSafalErrors.Forbidden.Code);
        task.Status.Should().Be(PlannedWorkStatus.Done);
    }

    // ── the three words of ConfirmationState ─────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData("Verified,Verified", "Confirmed")]
    [InlineData("Verified", "Confirmed")]
    [InlineData("Verified,Draft", "Waiting")]
    [InlineData("Confirmed", "Waiting")]
    [InlineData("Draft", "Waiting")]
    [InlineData("CorrectionPending", "Waiting")]
    [InlineData("Verified,Disputed", "Disputed")]
    [InlineData("Disputed,Draft", "Disputed")]
    [InlineData("Missing", "Waiting")]
    [InlineData("", null)]
    public void The_word_is_read_from_all_the_linked_logs(string standings, string? expected)
    {
        var ids = standings.Split(',', StringSplitOptions.RemoveEmptyEntries).Select(_ => Guid.NewGuid()).ToList();
        var parsed = standings.Split(',', StringSplitOptions.RemoveEmptyEntries)
            .Select(s => s == "Missing" ? (VerificationStatus?)null : Enum.Parse<VerificationStatus>(s))
            .ToList();
        var by = ids.Zip(parsed).ToDictionary(x => x.First, x => x.Second);

        PlannedWorkConfirmation.Of(ids, id => by[id]).Should().Be(expected);
    }

    [Fact]
    public async Task The_dto_carries_the_word_for_the_task_and_for_each_plot_from_its_own_logs_and_a_dispute_does_not_reopen()
    {
        var repo = new Repo();
        var task = TwoPlotUrea(repo);
        var logA = repo.Log(PlotA);
        var logB = repo.Log(PlotB);
        await Handler(repo).HandleAsync(Complete(task, Raju, [PlotA], [logA.Id]));
        await Handler(repo).HandleAsync(Complete(task, Raju, [PlotB], [logB.Id]));
        task.Status.Should().Be(PlannedWorkStatus.Done);

        var standing = new Dictionary<Guid, VerificationStatus?>
        {
            [logA.Id] = VerificationStatus.Verified,
            [logB.Id] = VerificationStatus.Disputed,
        };
        var dto = PlannedWorkDto.From(task, task.LivePlots.Select(p => p.PlotId).ToList(), id => standing[id]);
        dto.ConfirmationState.Should().Be("Disputed", "any doubt is shown");
        dto.Plots.Single(p => p.PlotId == PlotA).ConfirmationState.Should().Be("Confirmed");
        dto.Plots.Single(p => p.PlotId == PlotB).ConfirmationState.Should().Be("Disputed");
        dto.Status.Should().Be("Done", "a शंका shows Disputed and does not reopen");

        // A minor correction (CorrectionPending) is Waiting and does not reopen either.
        standing[logB.Id] = VerificationStatus.CorrectionPending;
        PlannedWorkDto.From(task, task.LivePlots.Select(p => p.PlotId).ToList(), id => standing[id])
            .ConfirmationState.Should().Be("Waiting");
        task.Status.Should().Be(PlannedWorkStatus.Done);
    }

    [Fact]
    public void A_linked_logs_change_moves_the_task_past_the_cursor_and_changes_nothing_else()
    {
        var task = Make(Details(assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(1));
        var before = task.ModifiedAtUtc;
        var status = task.Status;
        var accepted = task.AcceptedAtUtc;

        task.NoteLinkedLogChanged(Now.AddMinutes(2));

        task.ModifiedAtUtc.Should().BeAfter(before);
        task.Status.Should().Be(status);
        task.AcceptedAtUtc.Should().Be(accepted);
        task.DoneAtUtc.Should().BeNull();
    }

    [Fact]
    public void The_domain_step_is_replay_safe_names_only_its_own_assignee_and_refuses_a_foreign_plot()
    {
        var task = Make(Details(PlannedWorkScope.MultiPlot, [PlotA, PlotB], assignee: Raju));
        task.Accept(Raju, Now.AddMinutes(1));
        task.Complete(
            Raju, [PlotA], new Dictionary<Guid, IReadOnlyList<Guid>> { [PlotA] = [Guid.NewGuid()] }, [], somethingLeft: false, Now.AddMinutes(2))
            .Should().Be(PlannedWorkStep.Applied);

        task.Complete(Raju, [PlotA], new Dictionary<Guid, IReadOnlyList<Guid>>(), [], false, Now.AddMinutes(3))
            .Should().Be(PlannedWorkStep.AlreadyDone, "plot A is already done: nothing to change");
        task.Complete(Stranger, [PlotB], new Dictionary<Guid, IReadOnlyList<Guid>>(), [], false, Now.AddMinutes(3))
            .Should().Be(PlannedWorkStep.NotAssignee);
        FluentActions.Invoking(() => task.Complete(Raju, [ForeignPlot], new Dictionary<Guid, IReadOnlyList<Guid>>(), [], false, Now.AddMinutes(3)))
            .Should().Throw<ArgumentException>();
    }
}
