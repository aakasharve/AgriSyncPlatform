using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.RecordAttendanceMark;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

public sealed class RecordAttendanceMarkHandlerTests
{
    private static readonly DateTime Now = new(2026, 9, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherFarm = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid Caller = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid Ganesh = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly DateOnly Day = new(2026, 9, 2);

    private static RecordAttendanceMarkCommand Cmd(
        DayMark day = DayMark.Full, NightMark night = NightMark.Unmarked,
        decimal? hours = null, decimal? extra = null, Guid? resolved = null) =>
        new(Guid.NewGuid(), Farm, Ganesh, Day, day, night, hours, extra, resolved, Caller);

    private static RecordAttendanceMarkHandler Build(FakeRepo repo) =>
        new(repo, new SequentialIdGenerator(), new FixedClock(Now));

    private static FakeRepo Repo(AppRole? role = AppRole.PrimaryOwner)
    {
        var repo = new FakeRepo();
        if (role is { } r) repo.SetRole(Farm, Caller, r);
        repo.SeedOperator(FieldOperator.Create(Ganesh, "गणेश", null, new FarmId(Farm), new UserId(Caller), Now));
        return repo;
    }

    [Fact]
    public async Task No_authority_is_Forbidden_and_stages_nothing()
    {
        var repo = Repo(role: null);
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.AddedMarks.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task A_subject_from_another_farm_is_Forbidden_never_NotFound()
    {
        var repo = Repo();
        repo.SeedOperator(FieldOperator.Create(Guid.NewGuid(), "परका", null, new FarmId(OtherFarm), new UserId(Caller), Now));
        var foreign = Cmd() with { FieldOperatorId = repo.LastSeededOperatorId };
        var result = await Build(repo).HandleAsync(foreign);
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
    }

    [Fact]
    public async Task A_command_stating_nothing_is_InvalidCommand_before_the_domain_throws()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Unmarked, night: NightMark.Unmarked));
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
    }

    [Fact]
    public async Task First_ruling_is_Recorded_with_ONE_SaveChanges_and_no_correction()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsSuccess.Should().BeTrue();
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        repo.AddedMarks.Should().ContainSingle(m => m.Day == DayMark.Full);
        repo.AddedCorrections.Should().BeEmpty();
        repo.SaveCalls.Should().Be(1);
    }

    [Fact]
    public async Task Stated_hours_persist_as_stated_with_Explicit_basis_and_no_day_fraction()
    {
        var repo = Repo();
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Unmarked, night: NightMark.Worked, hours: 3m));
        result.IsSuccess.Should().BeTrue();
        var mark = repo.AddedMarks.Single();
        mark.Night.Should().Be(NightMark.Worked);
        mark.HoursWorked.Should().Be(3m);                       // stated, never converted
        mark.HoursBasis.Should().Be(LabourTimeBasis.Explicit);  // provenance from the path
        mark.Day.Should().Be(DayMark.Unmarked);                 // silence stays silence
    }

    [Fact]
    public async Task Two_disagreeing_engagement_facts_return_Contradicted_and_stage_nothing()
    {
        var repo = Repo();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(Guid.NewGuid(), "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "फवारणी", LabourShift.Half));
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsSuccess.Should().BeTrue();                     // an outcome, not an error
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Contradicted);
        result.Value!.Contradiction!.Candidates.Should().HaveCount(2);
        result.Value!.Contradiction!.DisplayNameAtAttach.Should().Be("गणेश");
        repo.AddedMarks.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task Two_CONSISTENT_facts_ask_nothing()
    {
        var repo = Repo();
        var a = Guid.NewGuid();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(a, "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "खत", LabourShift.Full));
        var result = await Build(repo).HandleAsync(Cmd());
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
    }

    /// <summary>
    /// B003 (3.3 review, carried to 3.5): the server-side twin of the
    /// contradiction check must never map a shift value it does not know onto
    /// a blank candidate — a fact carrying an out-of-vocabulary shift is a
    /// broken producer, and quietly demoting it to "claims nothing" would
    /// either invent a contradiction candidate that asserts nothing or let a
    /// real disagreement hide behind it. Refuse loudly: InvalidCommand,
    /// nothing staged — never a silent pass.
    /// </summary>
    [Fact]
    public async Task An_unknown_shift_value_in_the_facts_is_InvalidCommand_never_a_silent_pass()
    {
        var repo = Repo();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(Guid.NewGuid(), "छाटणी", (LabourShift)99),
            new AttendanceEngagementFact(Guid.NewGuid(), "फवारणी", LabourShift.Half));
        var result = await Build(repo).HandleAsync(Cmd());
        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
        repo.AddedMarks.Should().BeEmpty();
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task The_answer_reinvokes_with_resolvedLabourAssignmentId_and_records()
    {
        var repo = Repo();
        var sided = Guid.NewGuid();
        repo.SeedFacts(Ganesh, Day,
            new AttendanceEngagementFact(sided, "छाटणी", LabourShift.Full),
            new AttendanceEngagementFact(Guid.NewGuid(), "फवारणी", LabourShift.Half));
        var result = await Build(repo).HandleAsync(Cmd(resolved: sided));
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        repo.AddedMarks.Should().ContainSingle();
    }

    [Fact]
    public async Task An_identical_repeat_is_Recorded_idempotently_without_amending()
    {
        var repo = Repo();
        var existing = AttendanceMark.Create(Guid.NewGuid(), new FarmId(Farm), Ganesh, Day,
            DayMark.Full, NightMark.Unmarked, new UserId(Caller), Now);
        repo.SeedMark(existing);
        var result = await Build(repo).HandleAsync(Cmd());
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        result.Value!.AttendanceMarkId.Should().Be(existing.Id);
        repo.AddedMarks.Should().BeEmpty();
        repo.AddedCorrections.Should().BeEmpty();
    }

    [Fact]
    public async Task A_changed_ruling_amends_and_the_correction_rows_ride_the_same_commit()
    {
        var repo = Repo();
        var existing = AttendanceMark.Create(Guid.NewGuid(), new FarmId(Farm), Ganesh, Day,
            DayMark.Full, NightMark.Unmarked, new UserId(Caller), Now);
        repo.SeedMark(existing);
        var result = await Build(repo).HandleAsync(Cmd(day: DayMark.Half));
        result.Value!.Outcome.Should().Be(AttendanceDayOutcome.Recorded);
        existing.Day.Should().Be(DayMark.Half);
        repo.AddedCorrections.Should().ContainSingle(c =>
            c.ChangedField == AttendanceMarkCorrection.DayField
            && c.OriginalValue == "Full" && c.NewValue == "Half");
        repo.SaveCalls.Should().Be(1);
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
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly Dictionary<Guid, FieldOperator> _operators = new();
        private readonly Dictionary<(Guid fieldOperatorId, DateOnly workDate), List<AttendanceEngagementFact>> _facts = new();
        private readonly Dictionary<(Guid farmId, Guid fieldOperatorId, DateOnly workDate), AttendanceMark> _marks = new();

        public List<AttendanceMark> AddedMarks { get; } = [];
        public List<AttendanceMarkCorrection> AddedCorrections { get; } = [];
        public int SaveCalls { get; private set; }
        public Guid LastSeededOperatorId { get; private set; }

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public void SeedOperator(FieldOperator o)
        {
            _operators[o.Id] = o;
            LastSeededOperatorId = o.Id;
        }

        public void SeedFacts(Guid fieldOperatorId, DateOnly workDate, params AttendanceEngagementFact[] facts) =>
            _facts[(fieldOperatorId, workDate)] = [.. facts];

        public void SeedMark(AttendanceMark mark) =>
            _marks[((Guid)mark.FarmId, mark.FieldOperatorId, mark.WorkDate)] = mark;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default)
            => Task.FromResult(false);

        public override Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_operators.TryGetValue(id, out var o) ? o : null);

        // Default [] IN THE FAKE ONLY — the port default throws, because
        // "no contradiction found" is a positive claim.
        public override Task<IReadOnlyList<AttendanceEngagementFact>> GetAttendanceEngagementFactsAsync(
            FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<AttendanceEngagementFact>>(
                _facts.TryGetValue((fieldOperatorId, workDate), out var facts) ? facts : []);

        public override Task<AttendanceMark?> GetAttendanceMarkAsync(
            FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
            => Task.FromResult(
                _marks.TryGetValue(((Guid)farmId, fieldOperatorId, workDate), out var mark) ? mark : null);

        public override Task AddAttendanceMarkAsync(AttendanceMark mark, CancellationToken ct = default)
        {
            AddedMarks.Add(mark);
            return Task.CompletedTask;
        }

        public override Task AddAttendanceMarkCorrectionAsync(AttendanceMarkCorrection correction, CancellationToken ct = default)
        {
            AddedCorrections.Add(correction);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }
}
