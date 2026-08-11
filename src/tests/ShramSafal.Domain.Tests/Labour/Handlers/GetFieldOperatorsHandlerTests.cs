using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Labour.GetFieldOperators;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Tests.Work.Handlers;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour.Handlers;

/// <summary>
/// spec: 2026-07-13-labour-attendance-approval-design (Labour V1, Task 12) —
/// <see cref="GetFieldOperatorsHandler"/>. Locks two things: the
/// defense-in-depth Forbidden gate (mirrors CreateFieldOperatorHandler), and
/// the mapping from the domain <see cref="FieldOperator"/> to the LEAN
/// <see cref="FieldOperatorSummaryDto"/> — Id/DisplayName/FullName/IsActive
/// only, never <c>OriginatingFarmId</c>/<c>CreatedByUserId</c>/
/// <c>CreatedAtUtc</c>/<c>DisplayNameNormalized</c>.
/// </summary>
public sealed class GetFieldOperatorsHandlerTests
{
    private static readonly DateTime Now = new(2026, 8, 11, 9, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmAGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid CallerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");

    private static GetFieldOperatorsHandler BuildHandler(FakeRepo repo) => new(repo);

    private static FieldOperator MakeOperator(Guid id, Guid farmGuid, string displayName, string? fullName = null) =>
        FieldOperator.Create(id, displayName, fullName, new FarmId(farmGuid), new UserId(CallerGuid), Now);

    [Fact]
    public async Task Empty_FarmId_returns_InvalidCommand()
    {
        var repo = new FakeRepo();
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new GetFieldOperatorsQuery(FarmId.Empty, new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
        repo.ListCalls.Should().Be(0);
    }

    [Fact]
    public async Task Empty_CallerUserId_returns_InvalidCommand()
    {
        var repo = new FakeRepo();
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmAGuid), UserId.Empty));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("InvalidCommand");
        repo.ListCalls.Should().Be(0);
    }

    [Fact]
    public async Task Caller_with_no_membership_on_the_farm_returns_Forbidden_without_listing()
    {
        var repo = new FakeRepo(); // no role seeded for (FarmA, Caller)
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmAGuid), new UserId(CallerGuid)));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
        repo.ListCalls.Should().Be(0, "a Forbidden caller must never reach the repository list read");
    }

    [Fact]
    public async Task Active_member_with_no_operators_gets_an_empty_list_not_an_error()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmAGuid), new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeEmpty();
    }

    [Fact]
    public async Task Active_member_gets_the_lean_projection_for_every_seeded_operator()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.PrimaryOwner);
        var active = MakeOperator(Guid.NewGuid(), FarmAGuid, "बाळू", "Balu Shinde");
        var inactive = MakeOperator(Guid.NewGuid(), FarmAGuid, "गणेश");
        inactive.Deactivate(Now);
        repo.Seed(active);
        repo.Seed(inactive);
        var handler = BuildHandler(repo);

        var result = await handler.HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmAGuid), new UserId(CallerGuid)));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().HaveCount(2);

        var activeDto = result.Value.Should().ContainSingle(d => d.Id == active.Id).Subject;
        activeDto.DisplayName.Should().Be("बाळू");
        activeDto.FullName.Should().Be("Balu Shinde");
        activeDto.IsActive.Should().BeTrue();

        var inactiveDto = result.Value.Should().ContainSingle(d => d.Id == inactive.Id).Subject;
        inactiveDto.DisplayName.Should().Be("गणेश");
        inactiveDto.FullName.Should().BeNull();
        inactiveDto.IsActive.Should().BeFalse();
    }

    [Fact]
    public async Task Handler_passes_the_query_FarmId_through_to_the_repository_unmodified()
    {
        var repo = new FakeRepo();
        repo.SetRole(FarmAGuid, CallerGuid, AppRole.Mukadam);
        var handler = BuildHandler(repo);

        await handler.HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmAGuid), new UserId(CallerGuid)));

        repo.LastRequestedFarmId.Should().Be(new FarmId(FarmAGuid));
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FakeRepo : StubShramSafalRepository
    {
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _roles = new();
        private readonly List<FieldOperator> _operators = new();

        public int ListCalls { get; private set; }
        public FarmId? LastRequestedFarmId { get; private set; }

        public void SetRole(Guid farmId, Guid userId, AppRole role) => _roles[(farmId, userId)] = role;

        public void Seed(FieldOperator o) => _operators.Add(o);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_roles.TryGetValue((farmId, userId), out var role) ? (AppRole?)role : null);

        public override Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default)
        {
            ListCalls++;
            LastRequestedFarmId = farmId;
            return Task.FromResult<IReadOnlyList<FieldOperator>>(
                _operators.Where(o => o.OriginatingFarmId == farmId).ToList());
        }
    }
}
