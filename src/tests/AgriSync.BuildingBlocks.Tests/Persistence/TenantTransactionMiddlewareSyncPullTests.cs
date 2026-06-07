using System.Security.Claims;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence;

public sealed class TenantTransactionMiddlewareSyncPullTests
{
    [Fact]
    public async Task Sync_pull_without_authenticated_subject_fails_closed_before_admin_skip_path()
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
        http.Request.Path = "/sync/pull";

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.Equal(StatusCodes.Status401Unauthorized, http.Response.StatusCode);
        Assert.False(nextCalled);
        Assert.False(tenantContext.IsAdminCrossTenant);
        Assert.False(tenantContext.IsUserScoped);
        Assert.Equal(0, registry.Calls);
    }

    [Fact]
    public async Task Sync_pull_with_unparseable_subject_fails_closed_before_admin_skip_path()
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
        http.Request.Path = "/sync/pull";
        http.User = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[] { new Claim("sub", "not-a-guid") },
                authenticationType: "TestAuth"));

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.Equal(StatusCodes.Status401Unauthorized, http.Response.StatusCode);
        Assert.False(nextCalled);
        Assert.False(tenantContext.IsAdminCrossTenant);
        Assert.False(tenantContext.IsUserScoped);
        Assert.Equal(0, registry.Calls);
    }

    [Fact]
    public async Task Sync_pull_with_authenticated_subject_enters_user_scoped_transaction_path()
    {
        var userId = Guid.Parse("82afbe27-6f4b-4e0f-bef7-33e67ad54bff");
        var registry = new RecordingRegistry();
        var tenantContext = new TenantContext();
        var nextCalled = false;

        var middleware = new TenantTransactionMiddleware(_ =>
        {
            nextCalled = true;
            return Task.CompletedTask;
        });

        var http = new DefaultHttpContext();
        http.Request.Path = "/sync/pull";
        http.User = new ClaimsPrincipal(
            new ClaimsIdentity(
                new[] { new Claim("sub", userId.ToString()) },
                authenticationType: "TestAuth"));

        await middleware.InvokeAsync(http, registry, tenantContext);

        Assert.True(nextCalled);
        Assert.False(tenantContext.IsAdminCrossTenant);
        Assert.True(tenantContext.IsUserScoped);
        Assert.Equal(userId, tenantContext.UserId);
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
