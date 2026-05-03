using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmerHealth;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// Handler-level tests for <see cref="GetFarmerHealthHandler"/>. These
/// exercise the orchestration logic (scope-out → NotFound, audit emit,
/// redactor invocation) using in-memory fakes for the three injected
/// ports. The repository's matview-side scope check is covered separately
/// by <c>AdminFarmerHealthRepositoryTests</c> (RequiresDocker).
/// </summary>
/// <remarks>
/// <para>
/// DWC v2 §3.6 Step 2. No <c>RequiresDocker</c> trait — these tests do
/// not touch a database. Following the pattern in
/// <see cref="EntitlementResolverTests"/> for fake-only handler coverage.
/// </para>
/// </remarks>
public sealed class GetFarmerHealthHandlerTests
{
    private static readonly Guid OrgId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    private static readonly Guid FarmId = Guid.Parse("b0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task Returns_NotFound_when_repository_returns_null()
    {
        var (handler, repo, _, audit) = BuildHandler(repoResult: null);

        var query = new GetFarmerHealthQuery(MakePlatformOwnerScope(), FarmId);
        var result = await handler.HandleAsync(query, CancellationToken.None);

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.NotFound);
        result.Error.Code.Should().Be("farmer_health.not_found");
        repo.LastFarmId.Should().Be(FarmId);
        repo.LastScope!.OrganizationId.Should().Be(OrgId);
        audit.Emissions.Should().BeEmpty(
            "audit must NOT emit when the farm is out of scope — audit row would otherwise leak the scoped-out farmId");
    }

    [Fact]
    public async Task Emits_admin_farmer_lookup_audit_with_scope_and_target_farmId_on_success()
    {
        var dto = SeedDto();
        var (handler, _, _, audit) = BuildHandler(repoResult: dto);

        var query = new GetFarmerHealthQuery(MakePlatformOwnerScope(), FarmId);
        var result = await handler.HandleAsync(query, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        audit.Emissions.Should().HaveCount(1);
        var emission = audit.Emissions[0];
        emission.Scope.OrganizationId.Should().Be(OrgId);
        emission.TargetFarmId.Should().Be(FarmId);
        emission.ModeName.Should().Be("ModeA_Drilldown");
    }

    [Fact]
    public async Task Invokes_redactor_with_FarmerHealth_module_key_for_low_privilege_scope()
    {
        var dto = SeedDto();
        var (handler, _, redactor, _) = BuildHandler(repoResult: dto);

        var lowPrivilege = MakeFpoEmployeeScope();
        var query = new GetFarmerHealthQuery(lowPrivilege, FarmId);
        var result = await handler.HandleAsync(query, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        redactor.LastModuleKey.Should().Be(ModuleKey.FarmerHealth,
            "the handler must always redact against the FarmerHealth module key — that's how the matrix entry from §3.7 is looked up");
        redactor.LastScope.Should().BeSameAs(lowPrivilege);
        // The fake redactor returns a sentinel "redacted" copy so we know the
        // pipeline ran the dto through redaction rather than returning it raw.
        result.Value!.FarmerName.Should().Be("**redacted-by-fake**");
    }

    private static (
        GetFarmerHealthHandler Handler,
        FakeFarmerHealthRepo Repo,
        FakeRedactor Redactor,
        FakeAuditEmitter Audit)
        BuildHandler(FarmerHealthDto? repoResult)
    {
        var repo = new FakeFarmerHealthRepo(repoResult);
        var redactor = new FakeRedactor();
        var audit = new FakeAuditEmitter();
        return (new GetFarmerHealthHandler(repo, redactor, audit), repo, redactor, audit);
    }

    private static AdminScope MakePlatformOwnerScope()
        => new(OrgId, OrganizationType.Platform, OrganizationRole.Owner,
               EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner),
               IsPlatformAdmin: true);

    private static AdminScope MakeFpoEmployeeScope()
        => new(OrgId, OrganizationType.FPO, OrganizationRole.Employee,
               EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Employee),
               IsPlatformAdmin: false);

    private static FarmerHealthDto SeedDto() => new(
        FarmId: FarmId,
        FarmerName: "Ramu Patil",
        Phone: "9876543210",
        Score: new FarmerHealthScoreBreakdownDto(
            Total: 72, Bucket: "healthy", Flag: "ok",
            Pillars: new(8m, 18m, 20m, 8m, 7m, 11m),
            WeekStart: DateOnly.FromDateTime(DateTime.UtcNow.Date)),
        Timeline: Array.Empty<FarmerHealthTimelineDto>(),
        SyncState: null,
        AiHealth: null,
        Verifications: new(0, 0, 0, 0),
        WorkerSummary: Array.Empty<FarmerHealthWorkerSummaryDto>());
}

internal sealed class FakeFarmerHealthRepo(FarmerHealthDto? result) : IAdminFarmerHealthRepository
{
    public Guid LastFarmId { get; private set; }
    public AdminScope? LastScope { get; private set; }

    public Task<FarmerHealthDto?> GetAsync(Guid farmId, AdminScope scope, CancellationToken ct = default)
    {
        LastFarmId = farmId;
        LastScope = scope;
        return Task.FromResult(result);
    }
}

internal sealed class FakeRedactor : IResponseRedactor
{
    public string? LastModuleKey { get; private set; }
    public AdminScope? LastScope { get; private set; }

    public T Redact<T>(T dto, AdminScope scope, string moduleKey) where T : class
    {
        LastModuleKey = moduleKey;
        LastScope = scope;

        // For the FarmerHealthDto specifically, return a sentinel copy so the
        // test can verify the handler returned the redacted instance rather
        // than the raw repo dto. For other types, pass through.
        if (dto is FarmerHealthDto fh)
        {
            return (T)(object)(fh with { FarmerName = "**redacted-by-fake**" });
        }
        if (dto is CohortPatternsDto cp)
        {
            return (T)(object)cp;
        }
        return dto;
    }

    public IReadOnlyList<T> RedactMany<T>(IEnumerable<T> dtos, AdminScope scope, string moduleKey) where T : class
        => dtos.Select(d => Redact(d, scope, moduleKey)).ToList();
}

internal sealed class FakeAuditEmitter : IAdminAuditEmitter
{
    public sealed record Emission(AdminScope Scope, Guid TargetFarmId, string ModeName);

    private readonly List<Emission> _emissions = new();
    public IReadOnlyList<Emission> Emissions => _emissions;

    public Task EmitFarmerLookupAsync(AdminScope scope, Guid targetFarmId, string modeName, CancellationToken ct = default)
    {
        _emissions.Add(new Emission(scope, targetFarmId, modeName));
        return Task.CompletedTask;
    }
}
