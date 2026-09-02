using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// <see cref="CreateFieldOperatorHandler"/>. The load-bearing assertion here
/// is 11.3: <c>OriginatingFarmId</c> is always the FARM ESTABLISHED FOR THIS
/// REQUEST (the command's <c>FarmId</c>), never re-derived from "the
/// caller's farm" — a caller may be an active member of several farms at
/// once (multi-farm-per-login is a core product invariant).
/// </summary>
public sealed class CreateFieldOperatorHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmBGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CallerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static CreateFieldOperatorHandler BuildHandler(FakeRepo repo) =>
        new(repo, new SequentialIdGenerator(), new FixedClock(Now));

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_display_name_returns_InvalidCommand(string blank)
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new CreateFieldOperatorCommand(
            new FarmId(FarmAGuid), blank, null, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
        repo.Saved.Should().BeEmpty();
    }

    [Fact]
    public async Task Caller_with_no_membership_on_the_farm_returns_Forbidden()
    {
        var repo = new FakeRepo(); // no role seeded for (FarmA, Caller)
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new CreateFieldOperatorCommand(
            new FarmId(FarmAGuid), "बाळू", null, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.Saved.Should().BeEmpty();
    }

    [Fact]
    public async Task Active_member_creates_operator_originating_on_the_command_farm()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmAGuid, CallerGuid); // D5 2026-09-02: the acting foreman is GRANTED — role alone no longer admits
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new CreateFieldOperatorCommand(
            new FarmId(FarmAGuid), "बाळू", "Balu Shinde", new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.DisplayName.Should().Be("बाळू");
        result.Value!.FullName.Should().Be("Balu Shinde");
        result.Value!.OriginatingFarmId.Should().Be(FarmAGuid);
        repo.Saved.Should().ContainSingle(o => o.OriginatingFarmId == new FarmId(FarmAGuid));
        repo.SaveCalls.Should().Be(1);
    }

    /// <summary>
    /// 11.3, the load-bearing case: the SAME caller is an active member of
    /// TWO farms. OriginatingFarmId must be the farm established for THIS
    /// request (FarmB), never silently the other farm the caller also
    /// belongs to.
    ///
    /// <para><b>LABOUR_PHASE2 Phase 5 — the caller's role on Farm B changed from
    /// <c>Worker</c> to <c>Mukadam</c>, and the reason is a founder decision, not
    /// a convenience.</b> Until O-4 (2026-08-12) this handler admitted ANY member
    /// ("<c>callerRole is null</c>"), so a Worker could mint a work identity. The
    /// five governed labour actions now share one predicate — owner-tier always,
    /// any other role (Mukadam included, since D5 2026-09-02) only when the owner
    /// has explicitly granted it — so a bare Worker is Forbidden here and the
    /// Mukadam below carries the owner's grant. The claim this test exists for is
    /// untouched: the caller still holds TWO memberships with DIFFERENT roles,
    /// and the operator must still originate on the farm the REQUEST named. (A
    /// Worker who HAS been granted is covered separately in
    /// <c>LabourCapabilityGateTests</c>.)</para>
    /// </summary>
    [Fact]
    public async Task Multi_farm_caller_gets_the_requested_farm_not_the_other_one_they_also_belong_to()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.PrimaryOwner);
        repo.SetRole(FarmBGuid, CallerGuid, AppRole.Mukadam);
        repo.GrantLabour(FarmBGuid, CallerGuid); // D5 2026-09-02: granted on Farm B, where the request acts
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new CreateFieldOperatorCommand(
            new FarmId(FarmBGuid), "गणपत", null, new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.OriginatingFarmId.Should().Be(FarmBGuid);
        repo.Saved.Should().ContainSingle();
        repo.Saved[0].OriginatingFarmId.Should().Be(new FarmId(FarmBGuid));
        repo.Saved[0].OriginatingFarmId.Should().NotBe(new FarmId(FarmAGuid));
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
        private readonly HashSet<(Guid farmId, Guid userId)> _labourGrants = [];

        public List<FieldOperator> Saved { get; } = [];
        public int SaveCalls { get; private set; }

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;
        public void GrantLabour(Guid farmId, Guid userId) => _labourGrants.Add((farmId, userId));

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_labourGrants.Contains((farmId, userId)));

        public override Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
        {
            Saved.Add(o);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }
}
