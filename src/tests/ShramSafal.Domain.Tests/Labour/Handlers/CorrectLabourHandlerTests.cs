using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Location;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12b) —
/// <see cref="CorrectLabourHandler"/>.
///
/// <para>Two things this file exists to pin, which no integration test can pin
/// as cheaply: (1) the AUTHORIZATION predicate is exactly
/// PrimaryOwner/SecondaryOwner/Mukadam — a farm Worker must not rewrite labour
/// truth, and the Mukadam (the person actually doing field verification) must
/// NOT be locked out the way <c>IsUserOwnerOfFarmAsync</c> would; and (2) every
/// rejection stages ZERO writes, which cannot rely on a rollback because
/// <c>TenantTransactionMiddleware</c> COMMITS whenever the pipeline returns
/// without throwing — a 403 body is not an exception.</para>
/// </summary>
public sealed class CorrectLabourHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmBGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CallerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static CorrectLabourHandler BuildHandler(FakeRepo repo, FakeMutationStore store) =>
        new(repo, store, new GuidIds(), new FixedClock(Now), NullLogger<CorrectLabourHandler>.Instance);

    private static DailyLog MakeLog(Guid id, Guid farmGuid) =>
        DailyLog.Create(
            id, new FarmId(farmGuid), Guid.NewGuid(), Guid.NewGuid(),
            new UserId(CallerGuid), new DateOnly(2026, 8, 10), null, (LocationSnapshot?)null, Now);

    private static LabourAssignment MakeAssignment(Guid id, Guid dailyLogId, int? workerCount = 8) =>
        LabourAssignment.Create(
            id, dailyLogId, LabourEngagementType.Hired,
            maleCount: null, femaleCount: null, workerCount: workerCount, wagePerPerson: null,
            contractUnit: null, contractQuantity: null, totalCost: null,
            linkedActivityId: null, createdAtUtc: Now, time: LabourTime.ServerAssumed());

    private static CorrectLabourCommand Command(
        Guid assignmentId,
        Guid farmGuid = default,
        LabourQuantityCorrection? quantity = null,
        decimal? durationHours = null,
        IReadOnlyList<Guid>? adds = null,
        IReadOnlyList<Guid>? removals = null,
        string clientRequestId = "req-1") =>
        new(
            new FarmId(farmGuid == default ? FarmAGuid : farmGuid),
            assignmentId,
            new UserId(CallerGuid),
            "device-1",
            clientRequestId,
            "मोजून पाहिलं",
            quantity,
            durationHours,
            adds,
            removals);

    private static (FakeRepo Repo, FakeMutationStore Store, LabourAssignment Assignment) Scenario(
        AppRole role = AppRole.Mukadam, Guid farmGuid = default, int? workerCount = 8)
    {
        var farm = farmGuid == default ? FarmAGuid : farmGuid;
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, role);
        var log = MakeLog(Guid.NewGuid(), farm);
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id, workerCount);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);
        return (repo, new FakeMutationStore(), assignment);
    }

    // ── Authorization ────────────────────────────────────────────────────────

    [Theory]
    [InlineData(AppRole.PrimaryOwner)]
    [InlineData(AppRole.SecondaryOwner)]
    [InlineData(AppRole.Mukadam)]
    public async Task Owners_and_the_Mukadam_may_correct(AppRole role)
    {
        var (repo, store, assignment) = Scenario(role);

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsSuccess.Should().BeTrue(
            "the Mukadam is exactly the person doing field verification — IsUserOwnerOfFarmAsync "
            + "would have locked them out");
        assignment.WorkerCount.Should().Be(6);
    }

    [Theory]
    [InlineData(AppRole.Worker)]
    [InlineData(AppRole.Agronomist)]
    [InlineData(AppRole.Consultant)]
    [InlineData(AppRole.FieldScout)]
    public async Task Everyone_else_is_Forbidden_with_zero_mutation(AppRole role)
    {
        var (repo, store, assignment) = Scenario(role);

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        assignment.WorkerCount.Should().Be(8, "a rejected correction must not touch the record");
        repo.Corrections.Should().BeEmpty();
        store.Stored.Should().BeEmpty("not even the idempotency row may be written");
    }

    [Fact]
    public async Task Caller_with_no_membership_at_all_is_Forbidden()
    {
        var repo = new FakeRepo(); // deliberately: no SetRole
        var log = MakeLog(Guid.NewGuid(), FarmAGuid);
        var assignment = MakeAssignment(Guid.NewGuid(), log.Id);
        repo.SeedLog(log);
        repo.SeedAssignment(assignment);

        var result = await BuildHandler(repo, new FakeMutationStore()).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
    }

    /// <summary>
    /// Cross-farm: the engagement is LOADABLE (a permissive, OR-ed
    /// <c>p_user_select_labour_assignments</c> policy makes that real under a
    /// multi-farm login) but its parent log belongs to Farm B. Forbidden, never
    /// NotFound — a distinct "not found" would let a forged id probe existence.
    /// </summary>
    [Fact]
    public async Task Correcting_another_farms_engagement_is_Forbidden_with_zero_mutation()
    {
        var (repo, store, assignment) = Scenario(farmGuid: FarmBGuid);

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        result.Error.Code.Should().NotContain("NotFound");
        assignment.WorkerCount.Should().Be(8);
        repo.Corrections.Should().BeEmpty();
    }

    // ── Quantity (12b.2) ─────────────────────────────────────────────────────

    [Fact]
    public async Task Count_correction_writes_one_history_row_per_changed_field()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsSuccess.Should().BeTrue();
        assignment.WorkerCount.Should().Be(6);

        repo.Corrections.Should().ContainSingle();
        var row = repo.Corrections[0];
        row.ChangedField.Should().Be("WorkerCount");
        row.OriginalValue.Should().Be("8");
        row.NewValue.Should().Be("6");
        row.CorrectedByUserId.Should().Be(new UserId(CallerGuid));
        row.CorrectedAtUtc.Should().Be(Now);
    }

    /// <summary>
    /// Fix round 1 — a <c>quantity</c> section whose three values are ALL absent
    /// says nothing about the headcount, and must therefore change nothing.
    ///
    /// <para>Without the fold-away in step 1 this reached
    /// <c>CorrectHeadcount(null, null, null)</c>, which NULLed a
    /// <c>worker_count</c> holding a real number and appended a history row
    /// reading <c>8 -> null</c>. That is a fail-open on the canonical record:
    /// "we were not told" written over "8 people worked", with no backfill job
    /// anywhere in this system to undo it.</para>
    ///
    /// <para>Asserted at the HANDLER because that is where the invariant now
    /// lives. It is deliberately NOT a client-side fix: a bare HTTP caller is
    /// not bound by the client, exactly as with <c>durationHours: 0</c>.</para>
    /// </summary>
    [Fact]
    public async Task An_all_null_quantity_section_leaves_a_known_headcount_alone_and_writes_no_row()
    {
        var (repo, store, assignment) = Scenario();

        // Sent ALONGSIDE a real duration correction, so the request is not
        // rejected wholesale by the corrects-nothing guard — this isolates the
        // quantity section's own behaviour.
        var result = await BuildHandler(repo, store).HandleAsync(Command(
            assignment.Id,
            quantity: new LabourQuantityCorrection(null, null, null),
            durationHours: 4m));

        result.IsSuccess.Should().BeTrue();
        assignment.WorkerCount.Should().Be(8,
            "an all-absent quantity section states nothing — it must never NULL a known headcount");
        assignment.DurationHours.Should().Be(4m, "the duration alongside it still applies");

        repo.Corrections.Should().ContainSingle("only the duration changed");
        repo.Corrections[0].ChangedField.Should().Be("DurationHours");
        repo.Corrections.Should().NotContain(c => c.ChangedField == "WorkerCount");
    }

    /// <summary>
    /// A request carrying ONLY an all-absent quantity section corrects nothing at
    /// all, so it is rejected there — not silently accepted as a no-op success.
    /// </summary>
    [Fact]
    public async Task A_request_carrying_only_an_all_null_quantity_section_is_rejected()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(Command(
            assignment.Id, quantity: new LabourQuantityCorrection(null, null, null)));

        result.IsFailure.Should().BeTrue();
        assignment.WorkerCount.Should().Be(8);
        repo.Corrections.Should().BeEmpty();
        store.Stored.Should().BeEmpty();
    }

    [Fact]
    public async Task Restating_the_value_the_record_already_holds_is_not_a_correction()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(8, null, null)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.CorrectionsRecorded.Should().Be(0);
        repo.Corrections.Should().BeEmpty("nothing moved, so there is nothing to explain");
    }

    // ── Duration (12b.3) ─────────────────────────────────────────────────────

    [Fact]
    public async Task Stated_hours_become_Explicit_and_carry_their_basis_in_the_history_row()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, durationHours: 4m));

        result.IsSuccess.Should().BeTrue();
        assignment.DurationHours.Should().Be(4m);
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Explicit);

        repo.Corrections.Should().ContainSingle();
        repo.Corrections[0].ChangedField.Should().Be("DurationHours");
        repo.Corrections[0].OriginalValue.Should().Be("8|Assumed");
        repo.Corrections[0].NewValue.Should().Be("4|Explicit");
    }

    [Fact]
    public async Task Silence_about_hours_writes_no_row_and_leaves_Assumed_alone()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        result.IsSuccess.Should().BeTrue();
        assignment.DurationHours.Should().Be(8m, "the reviewer said nothing about hours");
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Assumed,
            "silence must never be re-labelled as a measurement");
        repo.Corrections.Should().OnlyContain(c => c.ChangedField == "WorkerCount");
    }

    [Fact]
    public async Task A_non_positive_stated_duration_is_rejected_rather_than_guessed_at()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, durationHours: 0m));

        result.IsFailure.Should().BeTrue();
        assignment.DurationHours.Should().Be(8m);
        assignment.TimeBasis.Should().Be(LabourTimeBasis.Assumed);
        repo.Corrections.Should().BeEmpty();
    }

    // ── Attribution (12b.4) ──────────────────────────────────────────────────

    [Fact]
    public async Task Attribution_swap_is_auditable_and_never_changes_the_headcount()
    {
        var (repo, store, assignment) = Scenario();
        var balu = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var ganesh = Guid.Parse("22222222-2222-2222-2222-222222222222");
        repo.SeedOperator(FieldOperator.Create(balu, "बाळू", null, new FarmId(FarmAGuid), new UserId(CallerGuid), Now));
        repo.SeedOperator(FieldOperator.Create(ganesh, "गणेश", null, new FarmId(FarmAGuid), new UserId(CallerGuid), Now));
        repo.SeedWorkRow(FieldOperatorWorkRow.Create(
            Guid.NewGuid(), balu, assignment.Id, new FarmId(FarmAGuid),
            new DateOnly(2026, 8, 10), "बाळू", new UserId(CallerGuid), Now));

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, adds: [ganesh], removals: [balu]));

        result.IsSuccess.Should().BeTrue();
        assignment.WorkerCount.Should().Be(8,
            "attribution NEVER changes reported quantity — naming people must not shrink the number");

        repo.Corrections.Should().HaveCount(2);
        repo.Corrections.Should().Contain(c =>
            c.ChangedField == "Attribution" && c.OriginalValue == balu.ToString() && c.NewValue == null);
        repo.Corrections.Should().Contain(c =>
            c.ChangedField == "Attribution" && c.OriginalValue == null && c.NewValue == ganesh.ToString());

        repo.RemovedRows.Should().ContainSingle().Which.FieldOperatorId.Should().Be(balu);
        repo.AddedRows.Should().ContainSingle().Which.FieldOperatorId.Should().Be(ganesh);
        result.Value!.AttributedFieldOperatorIds.Should().BeEquivalentTo([ganesh]);
    }

    [Fact]
    public async Task Attributing_an_operator_from_another_farm_is_Forbidden_with_zero_mutation()
    {
        var (repo, store, assignment) = Scenario();
        var foreignOperator = Guid.Parse("33333333-3333-3333-3333-333333333333");
        repo.SeedOperator(FieldOperator.Create(
            foreignOperator, "परका", null, new FarmId(FarmBGuid), new UserId(CallerGuid), Now));

        var result = await BuildHandler(repo, store).HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null), adds: [foreignOperator]));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        assignment.WorkerCount.Should().Be(8,
            "the operator check runs BEFORE any staging, so the quantity in the same request is "
            + "not applied either");
        repo.Corrections.Should().BeEmpty();
        repo.AddedRows.Should().BeEmpty();
    }

    // ── Idempotency (12b.6) ──────────────────────────────────────────────────

    [Fact]
    public async Task A_retried_correction_yields_one_logical_correction()
    {
        var (repo, store, assignment) = Scenario();
        var handler = BuildHandler(repo, store);

        var first = await handler.HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));
        var retry = await handler.HandleAsync(
            Command(assignment.Id, quantity: new LabourQuantityCorrection(6, null, null)));

        first.IsSuccess.Should().BeTrue();
        retry.IsSuccess.Should().BeTrue("a retry is a success outcome, not an error");
        retry.Value!.AlreadyApplied.Should().BeTrue();
        retry.Value!.WorkerCount.Should().Be(6, "the replayed answer is the corrected truth");

        repo.Corrections.Should().ContainSingle(
            "one review action must produce ONE logical correction, not two history rows");
        store.Stored.Should().ContainSingle();
    }

    [Fact]
    public async Task A_different_client_request_id_is_a_different_correction()
    {
        var (repo, store, assignment) = Scenario();
        var handler = BuildHandler(repo, store);

        await handler.HandleAsync(Command(
            assignment.Id, quantity: new LabourQuantityCorrection(6, null, null), clientRequestId: "req-1"));
        await handler.HandleAsync(Command(
            assignment.Id, quantity: new LabourQuantityCorrection(4, null, null), clientRequestId: "req-2"));

        assignment.WorkerCount.Should().Be(4);
        repo.Corrections.Should().HaveCount(2);
        repo.Corrections[1].OriginalValue.Should().Be("6");
        repo.Corrections[1].NewValue.Should().Be("4");
    }

    // ── Shape ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_request_that_corrects_nothing_is_rejected()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(Command(assignment.Id));

        result.IsFailure.Should().BeTrue();
        repo.Corrections.Should().BeEmpty();
    }

    [Fact]
    public async Task A_missing_client_request_id_is_rejected_before_anything_is_read()
    {
        var (repo, store, assignment) = Scenario();

        var result = await BuildHandler(repo, store).HandleAsync(Command(
            assignment.Id,
            quantity: new LabourQuantityCorrection(6, null, null),
            clientRequestId: "   "));

        result.IsFailure.Should().BeTrue(
            "without a retry identity a retried correction writes a second set of history rows");
        assignment.WorkerCount.Should().Be(8);
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class GuidIds : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Mirrors <c>SyncMutationStore</c>'s contract: <c>true</c> the first time a
    /// (deviceId, clientRequestId) pair is stored, <c>false</c> afterwards.
    /// </summary>
    private sealed class FakeMutationStore : ISyncMutationStore
    {
        private readonly Dictionary<(string, string), StoredSyncMutation> _stored = [];

        public IReadOnlyCollection<StoredSyncMutation> Stored => _stored.Values;

        public Task<StoredSyncMutation?> GetAsync(string deviceId, string clientRequestId, CancellationToken ct = default)
            => Task.FromResult(_stored.TryGetValue((deviceId, clientRequestId), out var m) ? m : null);

        public Task<bool> TryStoreSuccessAsync(
            string deviceId, string clientRequestId, string mutationType,
            string responsePayloadJson, DateTime processedAtUtc, CancellationToken ct = default)
        {
            if (_stored.ContainsKey((deviceId, clientRequestId)))
            {
                return Task.FromResult(false);
            }

            _stored[(deviceId, clientRequestId)] = new StoredSyncMutation(
                deviceId, clientRequestId, mutationType, responsePayloadJson, processedAtUtc);
            return Task.FromResult(true);
        }
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<Guid, LabourAssignment> _assignments = new();
        private readonly Dictionary<Guid, FieldOperator> _operators = new();
        private readonly List<FieldOperatorWorkRow> _workRows = [];
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();

        public List<LabourCorrection> Corrections { get; } = [];
        public List<FieldOperatorWorkRow> AddedRows { get; } = [];
        public List<FieldOperatorWorkRow> RemovedRows { get; } = [];

        public void SeedLog(DailyLog log) => _logs[log.Id] = log;
        public void SeedAssignment(LabourAssignment a) => _assignments[a.Id] = a;
        public void SeedOperator(FieldOperator o) => _operators[o.Id] = o;
        public void SeedWorkRow(FieldOperatorWorkRow r) => _workRows.Add(r);
        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_assignments.TryGetValue(id, out var a) ? a : null);

        public override Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_operators.TryGetValue(id, out var o) ? o : null);

        public override Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(
            Guid labourAssignmentId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>(
                _workRows.Where(r => r.LabourAssignmentId == labourAssignmentId).ToList());

        public override Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default)
        {
            Corrections.Add(c);
            return Task.CompletedTask;
        }

        public override Task AddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        {
            AddedRows.Add(r);
            _workRows.Add(r);
            return Task.CompletedTask;
        }

        public override Task RemoveFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
        {
            RemovedRows.Add(r);
            _workRows.Remove(r);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
