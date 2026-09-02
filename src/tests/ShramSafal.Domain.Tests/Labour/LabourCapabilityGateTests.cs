using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Application.UseCases.Labour.RenameFieldOperator;
using ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Work.Handlers;
using ShramSafal.Infrastructure.Auth;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — <b>one predicate, five call sites</b>, and the
/// grant/revoke lifecycle that feeds it (founder decision O-4).
///
/// <para><b>What this suite is really guarding.</b> Before Phase 5 the five
/// governed labour actions obeyed THREE different rules, and the drift had
/// already produced a live contradiction: a Mukadam could CORRECT the labour on
/// a log but could not VERIFY that same log. Asserting "the Mukadam can verify"
/// alone would not stop that recurring — so every fact below drives a REAL
/// handler (or the real <see cref="ShramSafalAuthorizationEnforcer"/>) rather
/// than <see cref="LabourManagementPermission"/>, which is enumerated separately
/// in <c>LabourManagementPermissionTests</c>. If a sixth action grows its own
/// inline role list, the agreement facts here are what fail.</para>
///
/// <para><b>The trap this suite deliberately steps around.</b> Every in-tree
/// <see cref="IShramSafalRepository"/> double inherits
/// <c>GetLabourManagementGrantAsync</c>'s default body, which returns <c>false</c>
/// — so a denial test can pass against a repository that never consulted the
/// grant at all. The fake below OVERRIDES the member and the allow-cases prove
/// the grant is genuinely read; a deny-case is only meaningful here because its
/// allow-case twin exists two lines away.</para>
/// </summary>
public sealed class LabourCapabilityGateTests
{
    private static readonly DateTime Now = new(2026, 8, 13, 9, 0, 0, DateTimeKind.Utc);

    private static readonly Guid FarmA = Guid.Parse("aa000000-0000-0000-0000-0000000000a1");
    private static readonly Guid FarmB = Guid.Parse("bb000000-0000-0000-0000-0000000000b1");
    private static readonly Guid OwnerA = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid MukadamA = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid WorkerA = Guid.Parse("33333333-3333-3333-3333-333333333333");

    // ═════════════════════════════════════════════════════════════════════════
    // 1. The gate itself, resolved against a repository.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task An_owner_is_allowed_without_the_grant_ever_being_read()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, OwnerA)).Should().BeTrue();

        repo.GrantReads.Should().Be(0,
            "the role answers on its own for owner-tier; reaching for the grant would mean a "
            + "database round trip on the dominant path, and would let a bad grant read deny an owner");
    }

    [Fact]
    public async Task An_ungranted_Mukadam_is_denied_and_the_denial_comes_from_the_grant_being_read()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, AppRole.Mukadam);

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeFalse(
            "founder master review 2026-09-02 (D5): one switch, owner-controlled — the Mukadam "
            + "role no longer carries labour authority, and existing Mukadams start OFF");
        repo.GrantReads.Should().Be(1,
            "his answer now genuinely depends on the stored grant, so it IS read — a denial "
            + "without the read would pass identically against code that ignores the switch");

        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam).SetLabourRecordManagement(true, Now);
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeTrue(
            "the same grant that admits a Worker admits him — one switch, no second permission model");
    }

    [Fact]
    public async Task A_non_member_is_denied_and_the_grant_is_not_consulted()
    {
        var repo = new FakeRepo();
        repo.Grant(FarmA, WorkerA); // a grant with no membership behind it

        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA)).Should().BeFalse(
            "a grant cannot outlive the membership that carries it");
        repo.GrantReads.Should().Be(0);
    }

    /// <summary>
    /// The done-condition, in one fact: <b>denied → granted → allowed → revoked
    /// → denied</b>, driven through the REAL grant handler rather than by poking
    /// the flag.
    /// </summary>
    [Fact]
    public async Task An_ordinary_member_is_denied_then_granted_then_allowed_then_revoked_then_denied()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        var membership = repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        // 1 — denied
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA)).Should().BeFalse();
        repo.GrantReads.Should().Be(1, "a Worker's answer genuinely depends on the grant, so it IS read");

        // 2 — granted, by the owner, through the real handler
        var granted = await handler.HandleAsync(Set(FarmA, WorkerA, true, OwnerA));
        granted.IsSuccess.Should().BeTrue();
        granted.Value!.CanManageLabourRecords.Should().BeTrue();
        granted.Value!.Source.Should().Be("ExplicitGrant");
        granted.Value!.IsGrantEditable.Should().BeTrue();
        membership.CanManageLabourRecords.Should().BeTrue("the domain entity carries the decision");

        // 3 — allowed
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA)).Should().BeTrue();

        // 4 — revoked
        var revoked = await handler.HandleAsync(Set(FarmA, WorkerA, false, OwnerA));
        revoked.IsSuccess.Should().BeTrue();
        revoked.Value!.CanManageLabourRecords.Should().BeFalse();
        revoked.Value!.Source.Should().Be("NotGranted");

        // 5 — denied again
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, WorkerA)).Should().BeFalse();

        repo.AuditActions.Should().Equal(["LabourManagementGranted", "LabourManagementRevoked"],
            "each real change is explainable afterwards — and there are exactly two changes, not four");
    }

    [Fact]
    public async Task Re_sending_the_state_the_row_already_holds_succeeds_and_records_no_history()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        await handler.HandleAsync(Set(FarmA, WorkerA, true, OwnerA));
        var retry = await handler.HandleAsync(Set(FarmA, WorkerA, true, OwnerA));

        retry.IsSuccess.Should().BeTrue(
            "a farmer on a bad connection re-sending the same switch must land on the same state, not "
            + "an error — the request carries the DESIRED STATE, not a 'flip' verb");
        retry.Value!.CanManageLabourRecords.Should().BeTrue();
        repo.AuditActions.Should().ContainSingle(
            "a re-sent toggle is not a decision and must not appear in history as one");
        repo.SaveCalls.Should().Be(1);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. All five governed actions agree — proven by driving them.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Inverted 2026-09-02 (founder master review, D5). O-4 let the role carry
    /// the labour surface; D5 makes it the owner's switch. An UNGRANTED Mukadam
    /// is refused at the enforcer — same layer, same predicate as an ungranted
    /// Worker. DELIBERATE consequence, decided in Task 2.1: OFF also removes
    /// Draft→Confirmed, because VerifyLogAuthorizer routes every verify_log_v2
    /// through EnsureCanVerify. The five actions still agree — that is the
    /// property this fact has always pinned.
    /// </summary>
    [Fact]
    public async Task An_ungranted_Mukadam_is_refused_by_the_enforcer_and_a_granted_one_is_admitted()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, AppRole.Mukadam);
        var log = NewLog(FarmA, MukadamA);
        repo.AddLog(log);
        var enforcer = new ShramSafalAuthorizationEnforcer(repo, new TenantContext());

        (await enforcer.EnsureCanVerify(new UserId(MukadamA), log.Id)).IsSuccess.Should().BeFalse(
            "an ungranted foreman cannot sign off his own day — and the refusal now happens one "
            + "layer earlier, at the shared gate, exactly as for an ungranted Worker");

        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam).SetLabourRecordManagement(true, Now);
        (await enforcer.EnsureCanVerify(new UserId(MukadamA), log.Id)).IsSuccess.Should().BeTrue(
            "the owner's switch is the one thing that changes the answer");
    }

    [Fact]
    public async Task A_bare_Worker_is_refused_by_every_one_of_the_five_actions()
    {
        var repo = SeedWorkerScenario(granted: false, out var log, out var assignment, out var fieldOperator);
        var enforcer = new ShramSafalAuthorizationEnforcer(repo, new TenantContext());

        (await CreateAsync(repo, WorkerA)).IsFailure.Should().BeTrue();
        (await RenameAsync(repo, WorkerA, fieldOperator.Id)).IsFailure.Should().BeTrue();
        (await AttachAsync(repo, WorkerA, fieldOperator.Id, assignment.Id)).IsFailure.Should().BeTrue();
        (await enforcer.EnsureCanVerify(new UserId(WorkerA), log.Id)).IsSuccess.Should().BeFalse();

        repo.GrantReads.Should().BeGreaterThan(0,
            "this denial must come from the GRANT being read and found absent, not from the fake never "
            + "having been asked — otherwise the fact would pass identically against code that ignores "
            + "the capability entirely");
    }

    [Fact]
    public async Task The_same_Worker_is_admitted_by_every_one_of_the_five_actions_once_granted()
    {
        var repo = SeedWorkerScenario(granted: true, out var log, out var assignment, out var fieldOperator);
        var enforcer = new ShramSafalAuthorizationEnforcer(repo, new TenantContext());

        (await CreateAsync(repo, WorkerA)).IsSuccess.Should().BeTrue();
        (await RenameAsync(repo, WorkerA, fieldOperator.Id)).IsSuccess.Should().BeTrue();
        (await AttachAsync(repo, WorkerA, fieldOperator.Id, assignment.Id)).IsSuccess.Should().BeTrue();
        (await enforcer.EnsureCanVerify(new UserId(WorkerA), log.Id)).IsSuccess.Should().BeTrue(
            "one predicate means the grant reaches approve/verify too — a capability that stopped at "
            + "four of the five actions would be the old inconsistency in a new place");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. Who may grant — and the farm the grant lands on.
    // ═════════════════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(AppRole.Mukadam)]
    [InlineData(AppRole.Worker)]
    [InlineData(AppRole.Agronomist)]
    public async Task A_non_owner_cannot_grant_even_when_they_hold_the_capability_themselves(AppRole callerRole)
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, callerRole);
        repo.Grant(FarmA, MukadamA);
        repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(Set(FarmA, WorkerA, true, MukadamA));

        result.IsFailure.Should().BeTrue("O-4: the OWNER decides who is trusted");
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0, "a refused grant writes nothing");
    }

    [Fact]
    public async Task Nobody_can_grant_themselves()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, OwnerA, AppRole.PrimaryOwner);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(Set(FarmA, OwnerA, true, OwnerA));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0);
    }

    /// <summary>
    /// Farm-scoping, in the direction a single-sided check would miss: the
    /// caller really IS a PrimaryOwner — of the OTHER farm.
    /// </summary>
    [Fact]
    public async Task An_owner_of_Farm_B_cannot_grant_on_Farm_A()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmB, OwnerA, AppRole.PrimaryOwner); // owner of B, nothing on A
        repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(Set(FarmA, WorkerA, true, OwnerA));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        result.Error.Code.Should().NotContain("NotFound",
            "a distinct NotFound would turn this endpoint into an oracle for which people belong to "
            + "which farm");
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task An_owner_cannot_grant_to_somebody_who_is_not_a_member_of_this_farm()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmB, WorkerA, AppRole.Worker); // a member — of the OTHER farm

        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));
        var result = await handler.HandleAsync(Set(FarmA, WorkerA, true, OwnerA));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0);
    }

    /// <summary>
    /// The previous fact is satisfied by the REPOSITORY not finding the row —
    /// which proves the read filters, not that the handler checks. This one
    /// removes that comfort: the repository HANDS BACK Farm B's membership when
    /// asked about Farm A, exactly as <c>p_user_select_memberships</c> (a
    /// PERMISSIVE <c>FOR SELECT</c> policy OR-ed with the tenant policy) can, and
    /// as any future repository regression would. The ONLY thing left that can
    /// reject it is the handler's own
    /// <c>membership.FarmId != command.FarmId</c> assertion — doctrine E4,
    /// "assert tenancy on BOTH sides in application code".
    /// </summary>
    [Fact]
    public async Task A_foreign_farm_membership_handed_back_by_the_repository_is_still_refused()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        var foreign = repo.AddMembership(FarmB, WorkerA, AppRole.Worker);
        repo.LeakForeignMembershipFromTrackedRead = true;

        // Precondition: the row really is reachable, or this proves nothing.
        (await repo.GetTrackedFarmMembershipAsync(FarmA, WorkerA))
            .Should().NotBeNull("the leak must be real for the assertion to be the thing under test");

        var result = await new SetLabourPermissionHandler(repo, new FixedClock(Now))
            .HandleAsync(Set(FarmA, WorkerA, true, OwnerA));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        foreign.CanManageLabourRecords.Should().BeFalse("Farm B's row must be untouched by a Farm A request");
        repo.SaveCalls.Should().Be(0);
    }

    /// <summary>
    /// The P5 guard on owner-tier, PLUS the Mukadam round-trip — the founder's
    /// sentence made executable. Storing <c>false</c> for a co-owner would
    /// leave the owner looking at a switch that did not work, because the role
    /// carries the capability regardless; a Mukadam's switch is real now (D5).
    /// </summary>
    [Fact]
    public async Task Toggling_owner_tier_is_refused_and_a_Mukadam_toggle_now_works()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, OwnerA, AppRole.PrimaryOwner);
        var coOwner = Guid.Parse("55555555-5555-5555-5555-555555555555");
        var coOwnerMembership = repo.AddMembership(FarmA, coOwner, AppRole.SecondaryOwner);
        var mukadam = repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam);
        var handler = new SetLabourPermissionHandler(repo, new FixedClock(Now));

        // Owner-tier: the P5 refusal survives — that role genuinely carries it.
        var refused = await handler.HandleAsync(Set(FarmA, coOwner, false, OwnerA));
        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("ShramSafal.LabourManagementCarriedByRole");
        coOwnerMembership.CanManageLabourRecords.Should().BeFalse("nothing was stored");

        // Mukadam: the refusal is GONE — this is the owner's switch now (D5).
        var granted = await handler.HandleAsync(Set(FarmA, MukadamA, true, OwnerA));
        granted.IsSuccess.Should().BeTrue();
        granted.Value!.Source.Should().Be("ExplicitGrant");
        granted.Value!.IsGrantEditable.Should().BeTrue();
        mukadam.CanManageLabourRecords.Should().BeTrue();

        var revoked = await handler.HandleAsync(Set(FarmA, MukadamA, false, OwnerA));
        revoked.IsSuccess.Should().BeTrue(
            "'the owner may keep him as mukadam with the authority OFF' — the exact sentence "
            + "the shipped code made impossible");
        (await LabourManagementGate.IsAllowedAsync(repo, FarmA, MukadamA)).Should().BeFalse(
            "denied by the gate, not merely hidden in a UI");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4. The read the switch renders from.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_roster_read_reports_why_each_member_is_allowed_and_whether_the_switch_may_move()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam);
        var worker = repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        worker.SetLabourRecordManagement(true, Now);

        var result = await new GetLabourPermissionsHandler(repo)
            .HandleAsync(new GetLabourPermissionsQuery(new FarmId(FarmA), new UserId(OwnerA)));

        result.IsSuccess.Should().BeTrue();
        var rows = result.Value!.ToDictionary(r => r.UserId);

        rows[OwnerA].Source.Should().Be("OwnerTier");
        rows[OwnerA].CanManageLabourRecords.Should().BeTrue();
        rows[OwnerA].IsGrantEditable.Should().BeFalse();

        rows[MukadamA].Source.Should().Be("NotGranted");
        rows[MukadamA].CanManageLabourRecords.Should().BeFalse();
        rows[MukadamA].IsGrantEditable.Should().BeTrue(
            "the switch is real for a Mukadam now — the server will honour a move, so it must "
            + "render interactive");
        rows[MukadamA].HasExplicitGrant.Should().BeFalse();

        rows[WorkerA].Source.Should().Be("ExplicitGrant");
        rows[WorkerA].CanManageLabourRecords.Should().BeTrue();
        rows[WorkerA].IsGrantEditable.Should().BeTrue();
        rows[WorkerA].HasExplicitGrant.Should().BeTrue();
    }

    [Fact]
    public async Task The_roster_read_is_owner_only()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, MukadamA, AppRole.Mukadam);
        repo.AddMembership(FarmA, MukadamA, AppRole.Mukadam);

        var result = await new GetLabourPermissionsHandler(repo)
            .HandleAsync(new GetLabourPermissionsQuery(new FarmId(FarmA), new UserId(MukadamA)));

        result.IsFailure.Should().BeTrue("who else may rewrite labour is access-control information");
        result.Error.Code.Should().Contain("Forbidden");
    }

    [Fact]
    public async Task The_roster_read_never_returns_another_farms_membership_row()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, OwnerA, AppRole.PrimaryOwner);
        repo.AddMembership(FarmA, WorkerA, AppRole.Worker);
        repo.AddMembership(FarmB, MukadamA, AppRole.Mukadam);

        // The repository double deliberately returns EVERY membership it holds,
        // reproducing p_user_select_memberships — a PERMISSIVE FOR SELECT policy
        // that surfaces rows outside the scoped farm. The handler's own farm
        // assertion is the thing under test (doctrine E4).
        repo.LeakForeignMembershipsFromRoster = true;

        var result = await new GetLabourPermissionsHandler(repo)
            .HandleAsync(new GetLabourPermissionsQuery(new FarmId(FarmA), new UserId(OwnerA)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Select(r => r.UserId).Should().BeEquivalentTo([WorkerA],
            "'the repository returned it' is never authorisation");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Helpers
    // ═════════════════════════════════════════════════════════════════════════

    private static SetLabourPermissionCommand Set(Guid farmId, Guid target, bool allowed, Guid caller) =>
        new(new FarmId(farmId), new UserId(target), allowed, new UserId(caller),
            "test", "device-test", "sha256:test");

    private static DailyLog NewLog(Guid farmId, Guid actor) => DailyLog.Create(
        id: Guid.NewGuid(),
        farmId: new FarmId(farmId),
        plotId: Guid.NewGuid(),
        cropCycleId: Guid.NewGuid(),
        operatorUserId: new UserId(actor),
        logDate: DateOnly.FromDateTime(Now),
        idempotencyKey: null,
        location: null,
        createdAtUtc: Now);

    private static FakeRepo SeedWorkerScenario(
        bool granted, out DailyLog log, out LabourAssignment assignment, out FieldOperator fieldOperator)
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmA, WorkerA, AppRole.Worker);
        if (granted)
        {
            repo.Grant(FarmA, WorkerA);
        }

        log = NewLog(FarmA, WorkerA);
        repo.AddLog(log);

        assignment = LabourAssignment.Create(
            id: Guid.NewGuid(),
            dailyLogId: log.Id,
            engagementType: LabourEngagementType.Hired,
            maleCount: null,
            femaleCount: null,
            workerCount: 8,
            wagePerPerson: null,
            contractUnit: null,
            contractQuantity: null,
            totalCost: null,
            linkedActivityId: null,
            createdAtUtc: Now,
            time: LabourTime.Assumed(8m));
        repo.AddAssignment(assignment);

        fieldOperator = FieldOperator.Create(
            Guid.NewGuid(), "बाळू", null, new FarmId(FarmA), new UserId(OwnerA), Now);
        repo.AddFieldOperator(fieldOperator);

        return repo;
    }

    private static Task<AgriSync.BuildingBlocks.Results.Result<FieldOperatorDto>> CreateAsync(
        FakeRepo repo, Guid caller)
        => new CreateFieldOperatorHandler(repo, new StaticIdGenerator(), new FixedClock(Now))
            .HandleAsync(new CreateFieldOperatorCommand(
                new FarmId(FarmA), "गणेश", null, new UserId(caller)));

    private static Task<AgriSync.BuildingBlocks.Results.Result<FieldOperatorDto>> RenameAsync(
        FakeRepo repo, Guid caller, Guid fieldOperatorId)
        => new RenameFieldOperatorHandler(repo, new FixedClock(Now))
            .HandleAsync(new RenameFieldOperatorCommand(
                new FarmId(FarmA), fieldOperatorId, "बाळासाहेब", new UserId(caller)));

    private static Task<AgriSync.BuildingBlocks.Results.Result<AttachFieldOperatorResult>> AttachAsync(
        FakeRepo repo, Guid caller, Guid fieldOperatorId, Guid assignmentId)
        => new AttachFieldOperatorHandler(repo, new StaticIdGenerator(), new FixedClock(Now))
            .HandleAsync(new AttachFieldOperatorCommand(
                new FarmId(FarmA), fieldOperatorId, assignmentId, new UserId(caller)));

    private sealed class StaticIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Overrides <c>GetLabourManagementGrantAsync</c> deliberately — see the
    /// class remarks. <see cref="GrantReads"/> is what turns a passing denial
    /// into evidence rather than a coincidence.
    /// </summary>
    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly HashSet<(Guid farmId, Guid userId)> _grants = [];
        private readonly List<FarmMembership> _memberships = [];
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<Guid, LabourAssignment> _assignments = new();
        private readonly Dictionary<Guid, FieldOperator> _fieldOperators = new();

        public int GrantReads { get; private set; }
        public int SaveCalls { get; private set; }
        public List<string> AuditActions { get; } = [];
        public bool LeakForeignMembershipsFromRoster { get; set; }
        public bool LeakForeignMembershipFromTrackedRead { get; set; }

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public void Grant(Guid farmId, Guid userId) => _grants.Add((farmId, userId));

        public FarmMembership AddMembership(Guid farmId, Guid userId, AppRole role)
        {
            SetRole(farmId, userId, role);
            var membership = FarmMembership.Create(
                Guid.NewGuid(), new FarmId(farmId), new UserId(userId), role, Now);
            _memberships.Add(membership);
            return membership;
        }

        public void AddLog(DailyLog log) => _logs[log.Id] = log;
        public void AddAssignment(LabourAssignment a) => _assignments[a.Id] = a;
        public void AddFieldOperator(FieldOperator o) => _fieldOperators[o.Id] = o;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            GrantReads++;

            // The stored flag lives on the membership when there is one, so the
            // handler's write and this read cannot disagree.
            var membership = _memberships.FirstOrDefault(
                m => m.FarmId == new FarmId(farmId) && m.UserId == new UserId(userId));
            if (membership is not null)
            {
                return Task.FromResult(membership.CanManageLabourRecords);
            }

            return Task.FromResult(_grants.Contains((farmId, userId)));
        }

        public override Task<FarmMembership?> GetTrackedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(LeakForeignMembershipFromTrackedRead
                ? _memberships.FirstOrDefault(m => m.UserId == new UserId(userId) && !m.IsTerminal)
                : _memberships.FirstOrDefault(
                    m => m.FarmId == new FarmId(farmId) && m.UserId == new UserId(userId) && !m.IsTerminal));

        public override Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default)
            => Task.FromResult(LeakForeignMembershipsFromRoster
                ? _memberships.ToList()
                : _memberships.Where(m => m.FarmId == farmId).ToList());

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var log) ? log : null);

        public override Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_assignments.TryGetValue(id, out var a) ? a : null);

        public override Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_fieldOperators.TryGetValue(id, out var o) ? o : null);

        public override Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
        {
            _fieldOperators[o.Id] = o;
            return Task.CompletedTask;
        }

        public override Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
            => Task.FromResult(true);

        public override Task AddAuditEventAsync(ShramSafal.Domain.Audit.AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditActions.Add(auditEvent.Action);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }
}
