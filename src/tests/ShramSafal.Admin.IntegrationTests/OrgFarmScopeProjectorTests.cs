using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

[Collection(nameof(AdminTestCollection))]
public sealed class OrgFarmScopeProjectorTests
{
    private readonly AdminTestFixture _f;

    public OrgFarmScopeProjectorTests(AdminTestFixture f) => _f = f;

    [Fact]
    public async Task UpsertExplicit_WritesOneRow_ThenIsIdempotentOnConflict()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var projector = scope.ServiceProvider.GetRequiredService<IOrgFarmScopeProjector>();
        var orgId = Guid.NewGuid();
        var farmId = Guid.NewGuid();

        await projector.UpsertExplicitAsync(orgId, farmId, "Explicit", CancellationToken.None);
        await projector.UpsertExplicitAsync(orgId, farmId, "Explicit", CancellationToken.None);

        (await CountProjectionRowsAsync(orgId, farmId)).Should().Be(1);
    }

    [Fact]
    public async Task Remove_DeletesRow_AndIsIdempotent()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var projector = scope.ServiceProvider.GetRequiredService<IOrgFarmScopeProjector>();
        var orgId = Guid.NewGuid();
        var farmId = Guid.NewGuid();
        await projector.UpsertExplicitAsync(orgId, farmId, "Explicit", CancellationToken.None);

        await projector.RemoveAsync(orgId, farmId, CancellationToken.None);
        await projector.RemoveAsync(orgId, farmId, CancellationToken.None);

        (await CountProjectionRowsAsync(orgId, farmId)).Should().Be(0);
    }

    [Fact]
    public async Task ReconcileAll_DetectsDrift_WhenSsfRowHasNoMisRow_AndEmitsDriftEvent()
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var projector = scope.ServiceProvider.GetRequiredService<IOrgFarmScopeProjector>();
        var fake = _f.GetAnalyticsFake();
        fake.Clear();

        // Seed an ssf org-farm scope row but intentionally do NOT write the
        // matching mis.effective_org_farm_scope row → drift.
        var orgId = Guid.NewGuid();
        ctx.Organizations.Add(Organization.Create(orgId, $"Drift-Org-{Guid.NewGuid():N}", OrganizationType.FPO, DateTime.UtcNow));
        ctx.OrganizationFarmScopes.Add(OrganizationFarmScope.Grant(
            Guid.NewGuid(), orgId, new FarmId(Guid.NewGuid()),
            FarmScopeSource.Explicit, new UserId(Guid.NewGuid()), DateTime.UtcNow));
        await ctx.SaveChangesAsync();

        var driftCount = await projector.ReconcileAllAsync(CancellationToken.None);

        driftCount.Should().BeGreaterThanOrEqualTo(1);
        fake.Events
            .Should().Contain(e => e.EventType == AnalyticsEventType.AdminScopeDriftDetected);
    }

    private async Task<int> CountProjectionRowsAsync(Guid orgId, Guid farmId)
    {
        await using var scope = _f.Services.CreateAsyncScope();
        var ctx = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
        var conn = ctx.Database.GetDbConnection();
        await conn.OpenAsync();
        try
        {
            await using var cmd = conn.CreateCommand();
            cmd.CommandText =
                "SELECT COUNT(*) FROM mis.effective_org_farm_scope " +
                "WHERE org_id = @o AND farm_id = @f";
            var po = cmd.CreateParameter(); po.ParameterName = "o"; po.Value = orgId; cmd.Parameters.Add(po);
            var pf = cmd.CreateParameter(); pf.ParameterName = "f"; pf.Value = farmId; cmd.Parameters.Add(pf);
            var scalar = await cmd.ExecuteScalarAsync();
            return Convert.ToInt32(scalar);
        }
        finally
        {
            await conn.CloseAsync();
        }
    }
}
