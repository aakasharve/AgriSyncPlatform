using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Labour.RenameFieldOperator;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 11) —
/// <see cref="RenameFieldOperatorHandler"/>. Same RLS-permissiveness caveat
/// as <c>AttachFieldOperatorHandler</c> applies to the single row this
/// handler loads: a "wrong farm" operator must be loadable by the fake repo
/// (simulating a permissive <c>p_user_select_field_operators</c> policy) and
/// still rejected with Forbidden and zero writes.
/// </summary>
public sealed class RenameFieldOperatorHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmBGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CallerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static RenameFieldOperatorHandler BuildHandler(FakeRepo repo) =>
        new(repo, new FixedClock(Now));

    private static FieldOperator MakeOperator(Guid id, Guid farmGuid, string displayName = "बाळू") =>
        FieldOperator.Create(id, displayName, null, new FarmId(farmGuid), new UserId(CallerGuid), Now);

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Blank_display_name_returns_InvalidCommand(string blank)
    {
        var repo = new FakeRepo();
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid);
        repo.Seed(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new RenameFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, blank, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task Nonexistent_operator_returns_Forbidden_not_NotFound_with_zero_writes()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new RenameFieldOperatorCommand(
            new FarmId(FarmAGuid), Guid.NewGuid(), "सुरेश", new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0);
    }

    [Fact]
    public async Task Operator_originated_on_a_different_farm_is_Forbidden_with_zero_writes()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        var op = MakeOperator(Guid.NewGuid(), FarmBGuid, "बाळू");
        repo.Seed(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new RenameFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, "सुरेश", new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0);
        op.DisplayName.Should().Be("बाळू", "a rejected cross-farm rename must not mutate the entity");
    }

    [Fact]
    public async Task Same_farm_rename_succeeds_and_persists()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid, "बाळू");
        repo.Seed(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new RenameFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, "श्री. सुरेश", new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value!.DisplayName.Should().Be("श्री. सुरेश");
        op.DisplayName.Should().Be("श्री. सुरेश");
        repo.SaveCalls.Should().Be(1);
    }

    /// <summary>
    /// Fix round 1 — the handler must be self-sufficient about the CALLER,
    /// not just the row. The operator exists and belongs to the SAME farm
    /// as the command (it would pass the row check below); the only thing
    /// missing is that the caller has no membership on that farm at all.
    /// Constructs the handler DIRECTLY (never through the endpoint) —
    /// bypassing ICallerFarmTenantScope is exactly the scenario under test.
    /// </summary>
    [Fact]
    public async Task Caller_with_no_membership_on_the_farm_is_Forbidden_with_zero_writes()
    {
        var repo = new FakeRepo(); // deliberately: no SetRole call
        var op = MakeOperator(Guid.NewGuid(), FarmAGuid, "बाळू");
        repo.Seed(op);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new RenameFieldOperatorCommand(
            new FarmId(FarmAGuid), op.Id, "सुरेश", new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.SaveCalls.Should().Be(0);
        op.DisplayName.Should().Be("बाळू", "a rejected no-membership rename must not mutate the entity");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<Guid, FieldOperator> _operators = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();

        public int SaveCalls { get; private set; }

        public void Seed(FieldOperator o) => _operators[o.Id] = o;
        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult(_operators.TryGetValue(id, out var o) ? o : null);

        public override Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveCalls++;
            return Task.CompletedTask;
        }
    }
}
