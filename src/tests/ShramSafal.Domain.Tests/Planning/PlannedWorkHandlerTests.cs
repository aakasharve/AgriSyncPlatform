// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 Task 3 (founder D-24c; P10).
// The doors on an in-memory repository: a step that LOSES a race (the repository's save says another change to the same task was
// saved first) is "this work was changed first" and keeps nothing; a step that wins answers the task; and a repeat of the
// assignee's answer, a stranger's answer and an unknown task answer as the push contract says.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Planning.PlannedWork;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Planning;
using Xunit;
using static ShramSafal.Domain.Tests.Planning.PlannedWorkTests;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedWorkHandlerTests
{
    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }

    /// <summary>One task, three seats, a save that can lose a race.</summary>
    private sealed class Repo(PlannedWork? held, bool saveWins) : Work.Handlers.StubShramSafalRepository, IShramSafalRepository
    {
        public int Audited { get; private set; }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            Audited++;
            return Task.CompletedTask;
        }

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(farmId != PlannedWorkTests.Farm
                ? null
                : userId == Creator
                    ? new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null)
                    : userId == Raju || userId == Stranger
                        ? new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false, null)
                        : null);

        public Task<PlannedWork?> GetPlannedWorkByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(held is not null && held.Id == id ? held : null);

        public Task<bool> TrySavePlannedWorkChangeAsync(CancellationToken ct = default) => Task.FromResult(saveWins);
    }

    private static PlannedWorkCaller By(Guid user) => new(user, "Worker", "req-1", "1.0.18", "device");

    [Fact]
    public async Task An_accept_that_loses_the_race_is_changed_first_and_a_win_answers_the_task()
    {
        var task = Make(Details(assignee: Raju));
        var lost = await new AnswerPlannedWorkHandler(new Repo(task, saveWins: false), new FixedClock(Now.AddMinutes(1)))
            .AcceptAsync(new AnswerPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, By(Raju)));
        lost.IsFailure.Should().BeTrue();
        lost.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkStateChanged.Code);
        lost.Error.Code.Should().EndWith(".InvalidCommand", "every phone in the field parks a code ending so (P10)");

        var again = Make(Details(assignee: Raju));
        var won = await new AnswerPlannedWorkHandler(new Repo(again, saveWins: true), new FixedClock(Now.AddMinutes(1)))
            .AcceptAsync(new AnswerPlannedWorkCommand(again.Id, PlannedWorkTests.Farm, By(Raju)));
        won.IsSuccess.Should().BeTrue();
        won.Value!.Status.Should().Be("Accepted");
    }

    [Fact]
    public async Task A_cancel_that_loses_the_race_keeps_nothing_and_says_so()
    {
        var task = Make(Details(assignee: Raju));
        var result = await new CancelPlannedWorkHandler(new Repo(task, saveWins: false), new FixedClock(Now.AddMinutes(1)))
            .HandleAsync(new CancelPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, "पाऊस", By(Creator)));
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be(ShramSafalErrors.PlannedWorkStateChanged.Code);
    }

    [Fact]
    public async Task A_stranger_a_missing_task_and_another_farm_answer_as_the_push_contract_says()
    {
        var task = Make(Details(assignee: Raju));
        var repo = new Repo(task, saveWins: true);
        var handler = new AnswerPlannedWorkHandler(repo, new FixedClock(Now));

        (await handler.AcceptAsync(new AnswerPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, By(Stranger)))).Error.Code
            .Should().Be(ShramSafalErrors.Forbidden.Code, "not the assignee");
        (await handler.AcceptAsync(new AnswerPlannedWorkCommand(Guid.NewGuid(), PlannedWorkTests.Farm, By(Raju)))).Error.Code
            .Should().Be(ShramSafalErrors.PlannedWorkNotFound.Code, "a made-up id");
        (await handler.AcceptAsync(new AnswerPlannedWorkCommand(task.Id, Guid.NewGuid(), By(Raju)))).Error.Code
            .Should().Be(ShramSafalErrors.Forbidden.Code, "a farm he holds no seat on");
        repo.Audited.Should().Be(0, "a refusal writes no audit row");

        // The second accept by the assignee is the same task, changed nothing, audited once in total.
        (await handler.AcceptAsync(new AnswerPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, By(Raju)))).IsSuccess.Should().BeTrue();
        (await handler.AcceptAsync(new AnswerPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, By(Raju)))).IsSuccess.Should().BeTrue();
        repo.Audited.Should().Be(1);
    }

    [Fact]
    public async Task The_headcount_words_are_kept_as_said_and_the_audit_row_holds_no_words()
    {
        var task = Make(Details(assignee: Raju, crew: "मुकादम आणि ५ बायका", headcount: 6));
        task.ExpectedHeadcount.Should().Be(6);
        var audit = new List<AuditEvent>();
        var repo = new CapturingRepo(task, audit);
        var result = await new AnswerPlannedWorkHandler(repo, new FixedClock(Now.AddMinutes(1)))
            .SeenAsync(new AnswerPlannedWorkCommand(task.Id, PlannedWorkTests.Farm, By(Raju)));
        result.IsSuccess.Should().BeTrue();

        var row = audit.Should().ContainSingle().Which;
        row.EntityType.Should().Be("PlannedWork");
        row.Payload.Should().NotContain("मुकादम").And.NotContain("द्राक्षाला").And.NotContain(Raju.ToString());
        System.Text.Json.JsonDocument.Parse(row.Payload).RootElement.EnumerateObject().Select(p => p.Name)
            .Should().BeEquivalentTo(["plannedWorkId", "farmId", "status", "step"]);
    }

    private sealed class CapturingRepo(PlannedWork held, List<AuditEvent> audit) : Work.Handlers.StubShramSafalRepository, IShramSafalRepository
    {
        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            audit.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task<FarmAccess?> GetFarmAccessForUserAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult<FarmAccess?>(new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false, null));

        public Task<PlannedWork?> GetPlannedWorkByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult<PlannedWork?>(held.Id == id ? held : null);
    }
}
