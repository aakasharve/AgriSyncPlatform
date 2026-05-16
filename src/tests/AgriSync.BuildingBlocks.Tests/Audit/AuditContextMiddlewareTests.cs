using System.Net;
using System.Text;
using AgriSync.BuildingBlocks.Audit;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Audit;

/// <summary>
/// Pins §04.3.1 contract for <see cref="AuditContextMiddleware"/>:
/// X-Device-Id header is mirrored verbatim into <c>HttpContext.Items</c>,
/// missing header degrades to <c>"unknown"</c>, and the remote IP flows
/// through <see cref="IpHasher"/> rather than being persisted raw.
/// Manual middleware invocation (no WebApplicationFactory) keeps these
/// fast and provider-free.
/// </summary>
public sealed class AuditContextMiddlewareTests
{
    private static IpHasher BuildHasher() =>
        new(Encoding.UTF8.GetBytes("middleware_test_salt_must_be_long_enough_padding"));

    private static AuditContextMiddleware BuildMiddleware() =>
        new(_ => Task.CompletedTask);

    [Fact]
    public async Task Middleware_populates_device_id_from_header()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Device-Id"] = "device-abc-123";

        await BuildMiddleware().InvokeAsync(ctx, BuildHasher());

        Assert.Equal("device-abc-123", ctx.Items["audit.device_id"]);
    }

    [Fact]
    public async Task Middleware_falls_back_to_unknown_when_header_missing()
    {
        var ctx = new DefaultHttpContext();
        // No X-Device-Id header set.

        await BuildMiddleware().InvokeAsync(ctx, BuildHasher());

        Assert.Equal("unknown", ctx.Items["audit.device_id"]);
    }

    [Fact]
    public async Task Middleware_hashes_remote_ip_via_IpHasher()
    {
        var ctx = new DefaultHttpContext();
        ctx.Connection.RemoteIpAddress = IPAddress.Parse("203.0.113.42");
        var hasher = BuildHasher();
        var expected = hasher.Hash("203.0.113.42");

        await BuildMiddleware().InvokeAsync(ctx, hasher);

        var stored = ctx.Items["audit.ip_hash"] as string;
        Assert.Equal(expected, stored);
        Assert.StartsWith("sha256:", stored);
        // Raw IP must NEVER appear in the audit context — proves the
        // hash path is actually being taken.
        Assert.DoesNotContain("203.0.113.42", stored!);
    }

    [Fact]
    public async Task Middleware_yields_sentinel_when_remote_ip_is_null()
    {
        // Local in-process callers (e.g. integration tests, health probes
        // routed through a unix socket) can have a null RemoteIpAddress.
        // IpHasher returns the "sha256:unknown" sentinel for null input,
        // which must propagate through the middleware unchanged.
        var ctx = new DefaultHttpContext();
        // RemoteIpAddress left null.

        await BuildMiddleware().InvokeAsync(ctx, BuildHasher());

        Assert.Equal("sha256:unknown", ctx.Items["audit.ip_hash"]);
    }

    [Fact]
    public async Task AuditClaims_extension_returns_middleware_populated_pair()
    {
        var ctx = new DefaultHttpContext();
        ctx.Request.Headers["X-Device-Id"] = "device-xyz";
        ctx.Connection.RemoteIpAddress = IPAddress.Parse("198.51.100.7");
        var hasher = BuildHasher();
        await BuildMiddleware().InvokeAsync(ctx, hasher);

        var (deviceId, ipHash) = ctx.AuditClaims();

        Assert.Equal("device-xyz", deviceId);
        Assert.Equal(hasher.Hash("198.51.100.7"), ipHash);
    }

    [Fact]
    public void WorkerClaims_returns_worker_sentinels()
    {
        // R5 sentinel pair for non-HTTP audit-row writers.
        var (deviceId, ipHash) = AuditContextAccessor.WorkerClaims();

        Assert.Equal("worker", deviceId);
        Assert.Equal("sha256:worker", ipHash);
    }
}
