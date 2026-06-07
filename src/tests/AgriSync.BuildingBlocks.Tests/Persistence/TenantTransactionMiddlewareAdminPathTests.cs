using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence;

public sealed class TenantTransactionMiddlewareAdminPathTests
{
    [Theory]
    [InlineData("/shramsafal/admin/me/scope")]
    [InlineData("/shramsafal/admin/ops/health")]
    [InlineData("/admin/farmer-health/cohort")]
    public async Task Admin_paths_are_elevated_before_tenant_transactions(string path)
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();
        var nextCalled = false;

        var middleware = new TenantTransactionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var http = new DefaultHttpContext();
        http.Request.Path = path;

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(nextCalled);
        Assert.True(tenantContext.IsAdminCrossTenant);
        Assert.Equal(0, registry.Calls);
    }

    [Fact]
    public async Task Normal_shramsafal_paths_still_use_tenant_transactions()
    {
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();
        var nextCalled = false;

        var middleware = new TenantTransactionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var http = new DefaultHttpContext();
        http.Request.Path = "/shramsafal/logs";

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(nextCalled);
        Assert.False(tenantContext.IsAdminCrossTenant);
        Assert.Equal(1, registry.Calls);
    }

    private sealed class RecordingRegistry : ITenantScopedDbContextRegistry
    {
        public int Calls { get; private set; }

        public IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices)
        {
            Calls++;
            return Array.Empty<DbContext>();
        }
    }
}
