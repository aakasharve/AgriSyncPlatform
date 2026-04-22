using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

[Collection(nameof(AdminTestCollection))]
public sealed class EntitlementResolverTests
{
    private readonly AdminTestFixture _f;

    public EntitlementResolverTests(AdminTestFixture f) => _f = f;

    [Fact]
    public async Task Resolve_NoMemberships_ReturnsUnauthorized_AndEmitsEvent()
    {
        _f.GetAnalyticsFake().Clear();
        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(new UserId(Guid.NewGuid()), null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Unauthorized);
        result.Scope.Should().BeNull();
        result.Memberships.Should().BeEmpty();
        _f.GetAnalyticsFake().Events
            .Should().ContainSingle(e => e.EventType == AnalyticsEventType.AdminScopeUnauthorized);
    }

    [Fact]
    public async Task Resolve_SingleMembership_NoActiveOrgNeeded_ReturnsResolved()
    {
        var userId = new UserId(Guid.NewGuid());
        var orgId = await SeedOrgWithOwnerAsync(OrganizationType.FPO, userId);

        _f.GetAnalyticsFake().Clear();
        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(userId, null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.OrganizationId.Should().Be(orgId);
        result.Scope.OrganizationType.Should().Be(OrganizationType.FPO);
        result.Scope.OrganizationRole.Should().Be(OrganizationRole.Owner);
        result.Scope.Modules.Should().NotBeEmpty();
        _f.GetAnalyticsFake().Events
            .Should().ContainSingle(e => e.EventType == AnalyticsEventType.AdminScopeResolved);
    }

    [Fact]
    public async Task Resolve_MultipleMemberships_NoActiveOrgId_ReturnsAmbiguous()
    {
        var userId = new UserId(Guid.NewGuid());
        await SeedOrgWithOwnerAsync(OrganizationType.FPO, userId);
        await SeedOrgWithOwnerAsync(OrganizationType.Lab, userId);

        _f.GetAnalyticsFake().Clear();
        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(userId, null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Ambiguous);
        result.Scope.Should().BeNull();
        result.Memberships.Should().HaveCount(2);
        _f.GetAnalyticsFake().Events
            .Should().ContainSingle(e => e.EventType == AnalyticsEventType.AdminScopeAmbiguous);
    }

    [Fact]
    public async Task Resolve_MultipleMemberships_WithValidActiveOrgId_ResolvesToThatOrg()
    {
        var userId = new UserId(Guid.NewGuid());
        var fpoId = await SeedOrgWithOwnerAsync(OrganizationType.FPO, userId);
        await SeedOrgWithOwnerAsync(OrganizationType.Lab, userId);

        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(userId, fpoId, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.OrganizationId.Should().Be(fpoId);
        result.Scope.OrganizationType.Should().Be(OrganizationType.FPO);
    }

    [Fact]
    public async Task Resolve_WithUnknownActiveOrgId_ReturnsNotInOrg_AndEmitsForbidden()
    {
        var userId = new UserId(Guid.NewGuid());
        await SeedOrgWithOwnerAsync(OrganizationType.FPO, userId);
        await SeedOrgWithOwnerAsync(OrganizationType.Lab, userId);
        var strangerOrgId = Guid.NewGuid();

        _f.GetAnalyticsFake().Clear();
        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(userId, strangerOrgId, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.NotInOrg);
        result.Scope.Should().BeNull();
        result.Memberships.Should().HaveCount(2);
        _f.GetAnalyticsFake().Events
            .Should().ContainSingle(e => e.EventType == AnalyticsEventType.AdminScopeForbidden);
    }

    [Fact]
    public async Task Resolve_PlatformOwner_SetsIsPlatformAdminTrue_AndFullExportRights()
    {
        var userId = new UserId(Guid.NewGuid());
        await SeedOrgWithOwnerAsync(OrganizationType.Platform, userId);

        await using var scope = _f.Services.CreateAsyncScope();
        var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();

        var result = await resolver.ResolveAsync(userId, null, CancellationToken.None);

        result.Outcome.Should().Be(ResolveOutcome.Resolved);
        result.Scope!.IsPlatformAdmin.Should().BeTrue();
        result.Scope.CanExport(ModuleKey.CeiW1Deviation).Should().BeTrue();
        result.Scope.CanRead(ModuleKey.OpsLive).Should().BeTrue();
    }

    private async Task<Guid> SeedOrgWithOwnerAsync(OrganizationType type, UserId userId)
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

        var orgId = Guid.NewGuid();
        var now = DateTime.UtcNow;

        ctx.Organizations.Add(Organization.Create(orgId, $"Test-{type}-{Guid.NewGuid():N}", type, now));
        ctx.OrganizationMemberships.Add(OrganizationMembership.Create(
            Guid.NewGuid(), orgId, userId, OrganizationRole.Owner,
            new UserId(Guid.Empty), now));

        await ctx.SaveChangesAsync();
        return orgId;
    }
}
