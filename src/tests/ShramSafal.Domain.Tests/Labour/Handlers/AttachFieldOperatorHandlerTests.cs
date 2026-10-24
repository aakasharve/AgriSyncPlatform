using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// <see cref="AttachFieldOperatorHandler"/>. THE point of this file: RLS
/// visibility is NOT a cross-farm defence for this handler, so every "wrong
/// farm" scenario here simulates the row being LOADABLE (the fake repo
/// happily returns it, exactly like a permissive
/// <c>p_user_select_labour_assignments</c> / <c>p_user_select_field_operators</c>
/// policy would under a multi-farm login) while still belonging to a
/// DIFFERENT farm than the one established for the request. Every such case
/// must be rejected with Forbidden and ZERO writes — never NotFound, and
/// never a successful attach.
/// </summary>
public sealed class AttachFieldOperatorHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmBGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CallerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static AttachFieldOperatorHandler BuildHandler(FakeRepo repo) =>
        new(repo, new SequentialIdGenerator(), new FixedClock(Now));

    private static DailyLog MakeLog(Guid id, Guid farmGuid, DateOnly logDate) =>
        DailyLog.Create(
            id, new FarmId(farmGuid), Guid.NewGuid(), Guid.NewGuid(),
            new UserId(CallerGuid), logDate, null, (LocationSnapshot?)null, Now);

    private static LabourAssignment MakeAssignment(Guid id, Guid dailyLogId) =>
        LabourAssignment.Create(
            id, dailyLogId, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: 8, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null,
            linkedActivityId: null, createdAtUtc: Now, time: LabourTime.ServerAssumed());

    private static FieldOperator MakeOperator(Guid id, Guid farmGuid, string displayName = "बाळू") =>
        FieldOperator.Create(id, displayName, null, new FarmId(farmGuid), new UserId(CallerGuid), Now);

    [Fact]
    public async Task Nonexistent_assignment_returns_Forbidden_not_NotFound_with_zero_writes()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid);
        repo.SeedOperator(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, Guid.NewGuid() /* no such assignment */, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.WorkRowInsertAttempts.Should().Be(0);
    }

    [Fact]
    public async Task Assignment_whose_parent_log_belongs_to_a_different_farm_is_Forbidden_with_zero_writes()
    {
        // Simulates the exact A11 gap: the assignment IS loadable (permissive
        // RLS would let a multi-farm caller read it), but its parent log's
        // FarmId is FarmB while the request established FarmA.
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var log = MakeLog(Guid.NewGuid(), FarmBGuid, new DateOnly(2026, 8, 10));
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        repo.SeedOperator(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, assignment.Id, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.WorkRowInsertAttempts.Should().Be(0);
    }

    [Fact]
    public async Task Nonexistent_field_operator_returns_Forbidden_not_NotFound_with_zero_writes()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var log = MakeLog(Guid.NewGuid(), FarmAGuid, new DateOnly(2026, 8, 10));
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), Guid.NewGuid() /* no such operator */, assignment.Id, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.WorkRowInsertAttempts.Should().Be(0);
    }

    [Fact]
    public async Task Field_operator_originated_on_a_different_farm_is_Forbidden_with_zero_writes()
    {
        // Same A11 gap on the operator side: p_user_select_field_operators
        // makes the row loadable, but OriginatingFarmId is FarmB.
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var log = MakeLog(Guid.NewGuid(), FarmAGuid, new DateOnly(2026, 8, 10));
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        var op = MakeOperator(Guid.NewGuid(), FarmBGuid);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        repo.SeedOperator(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, assignment.Id, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.WorkRowInsertAttempts.Should().Be(0);
    }

    [Fact]
    public async Task Both_sides_on_the_same_farm_succeeds_and_snapshots_display_name_and_log_date()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var logDate = new DateOnly(2026, 8, 10);
        var log = MakeLog(Guid.NewGuid(), FarmAGuid, logDate);
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid, "बाळू");
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        repo.SeedOperator(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, assignment.Id, new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyAttached.Should().BeFalse();
        repo.WorkRowInsertAttempts.Should().Be(1);
        repo.InsertedRows.Should().ContainSingle();
        var row = repo.InsertedRows[0];
        row.FieldOperatorId.Should().Be(op.Id);
        row.LabourAssignmentId.Should().Be(assignment.Id);
        row.DisplayNameAtAttach.Should().Be("बाळू");
        row.WorkDate.Should().Be(logDate);
        row.FarmId.Should().Be(new FarmId(FarmAGuid));
    }

    [Fact]
    public async Task Retried_attach_is_idempotent_success_not_an_error()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var log = MakeLog(Guid.NewGuid(), FarmAGuid, new DateOnly(2026, 8, 10));
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        repo.SeedOperator(op);
        repo.NextTryAddReturnsFalse = true; // simulate: this pair already exists
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, assignment.Id, new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue("false from TryAdd is a success outcome, not an error (11.5)");
        result.Value!.AlreadyAttached.Should().BeTrue();
        result.Value!.FieldOperatorId.Should().Be(op.Id);
        result.Value!.LabourAssignmentId.Should().Be(assignment.Id);
    }

    /// <summary>
    /// Fix round 1 — the handler must be self-sufficient about the CALLER,
    /// not just the rows. Both referenced rows are perfectly valid and on
    /// the SAME farm as the command (they would pass every other check in
    /// this file); the only thing missing is that the caller has no
    /// membership on that farm at all. Constructs the handler DIRECTLY
    /// (never through the endpoint) — bypassing ICallerFarmTenantScope is
    /// exactly the scenario under test, e.g. a future sync-dispatched path
    /// that is skip-listed from the tenant middleware.
    /// </summary>
    [Fact]
    public async Task Caller_with_no_membership_on_the_farm_is_Forbidden_with_zero_writes()
    {
        var repo = new FakeRepo(); // deliberately: no SetRole call
        var log = MakeLog(Guid.NewGuid(), FarmAGuid, new DateOnly(2026, 8, 10));
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        repo.SeedOperator(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new AttachFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, assignment.Id, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.WorkRowInsertAttempts.Should().Be(0);
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<Guid, LabourAssignment> _assignments = new();
        private readonly Dictionary<Guid, FieldOperator> _operators = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _labourGrants = [];

        public List<FieldOperatorWorkRow> InsertedRows { get; } = [];
        public int WorkRowInsertAttempts { get; private set; }
        public bool NextTryAddReturnsFalse { get; set; }

        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SeedAssignment(LabourAssignment a) => _assignments[a.Id] = a;
        public void SeedOperator(FieldOperator o) => _operators[o.Id] = o;
        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void GrantLabour(Guid farmId, Guid userId) => _labourGrants.Add((farmId, userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
            => Task.FromResult(_labourGrants.Contains((farmId, userId)));

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_assignments.TryGetValue(id, out var a) ? a : null);

        public override Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_operators.TryGetValue(id, out var o) ? o : null);

        public override Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        {
            WorkRowInsertAttempts++;
            if (NextTryAddReturnsFalse)
            {
                return Task.FromResult(false);
            }

            InsertedRows.Add(r);
            return Task.FromResult(true);
        }
    }
}
