using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCohortPatterns;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// Handler-level tests for <see cref="GetCohortPatternsHandler"/>. Same
/// fake-only pattern as <see cref="GetFarmerHealthHandlerTests"/>; the
/// repository's matview-level scope filtering is exercised in the
/// RequiresDocker repo tests.
/// </summary>
/// <remarks>
/// DWC v2 §3.6. The cohort handler does not have a NotFound path
/// (always returns an aggregated payload, possibly with empty arrays);
/// the audit emit uses <see cref="Guid.Empty"/> as the target farmId
/// because the call is org-wide rather than farm-scoped.
/// </remarks>
public sealed class GetCohortPatternsHandlerTests
{
    private static readonly Guid OrgId = Guid.Parse("a0000000-0000-0000-0000-000000000001");

    [Fact]
    public async Task Returns_payload_and_emits_ModeB_Cohort_audit_event()
    {
        var dto = EmptyCohort();
        var repo = new FakeCohortRepo(dto);
        var redactor = new FakeRedactor();
        var audit = new FakeAuditEmitter();
        var handler = new GetCohortPatternsHandler(repo, redactor, audit);

        var scope = MakePlatformOwnerScope();
        var query = new GetCohortPatternsQuery(scope);
        var result = await handler.HandleAsync(query, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().NotBeNull();
        repo.LastScope!.OrganizationId.Should().Be(OrgId);

        audit.Emissions.Should().HaveCount(1);
        audit.Emissions[0].ModeName.Should().Be("ModeB_Cohort");
        audit.Emissions[0].TargetFarmId.Should().Be(Guid.Empty,
            "cohort fetch is not scoped to one farm — the emit uses Guid.Empty per the handler's contract");
        audit.Emissions[0].Scope.OrganizationId.Should().Be(OrgId);
    }

    [Fact]
    public async Task Invokes_redactor_with_FarmerHealth_module_key()
    {
        var dto = EmptyCohort();
        var repo = new FakeCohortRepo(dto);
        var redactor = new FakeRedactor();
        var audit = new FakeAuditEmitter();
        var handler = new GetCohortPatternsHandler(repo, redactor, audit);

        var scope = MakeFpoEmployeeScope();
        var query = new GetCohortPatternsQuery(scope);
        var result = await handler.HandleAsync(query, CancellationToken.None);

        result.IsSuccess.Should().BeTrue();
        redactor.LastModuleKey.Should().Be(ModuleKey.FarmerHealth);
        redactor.LastScope.Should().BeSameAs(scope);
    }

    private static AdminScope MakePlatformOwnerScope()
        => new(OrgId, OrganizationType.Platform, OrganizationRole.Owner,
               EntitlementMatrix.For(OrganizationType.Platform, OrganizationRole.Owner),
               IsPlatformAdmin: true);

    private static AdminScope MakeFpoEmployeeScope()
        => new(OrgId, OrganizationType.FPO, OrganizationRole.Employee,
               EntitlementMatrix.For(OrganizationType.FPO, OrganizationRole.Employee),
               IsPlatformAdmin: false);

    private static CohortPatternsDto EmptyCohort() => new(
        ScoreDistribution: Array.Empty<CohortScoreBinDto>(),
        InterventionQueue: Array.Empty<CohortBucketDto>(),
        Watchlist: Array.Empty<CohortBucketDto>(),
        EngagementTierBreakdown: Array.Empty<CohortEngagementTierDto>(),
        PillarHeatmap: Array.Empty<CohortPillarHeatmapDto>(),
        TrendByWeek: Array.Empty<CohortWeeklyTrendDto>(),
        FarmerSufferingTop10: Array.Empty<CohortFarmerSufferingDto>());
}

internal sealed class FakeCohortRepo(CohortPatternsDto result) : IAdminCohortPatternsRepository
{
    public AdminScope? LastScope { get; private set; }

    public Task<CohortPatternsDto> GetAsync(AdminScope scope, CancellationToken ct = default)
    {
        LastScope = scope;
        return Task.FromResult(result);
    }
}
