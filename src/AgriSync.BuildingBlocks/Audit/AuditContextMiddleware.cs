using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Audit;

/// <summary>
/// Stamps <c>HttpContext.Items["audit.device_id"]</c> and
/// <c>HttpContext.Items["audit.ip_hash"]</c> on every request so downstream
/// handlers that construct <c>AuditEvent</c> rows via <c>AuditEventFactory</c>
/// can read forensic provenance without re-deriving it per call site.
/// <para>
/// Must be registered AFTER <c>UseRouting</c> and BEFORE
/// <c>UseAuthentication</c> so the audit context is populated for every
/// request — including unauthenticated 401/403 paths whose audit rows
/// (e.g. denied admin attempts) still need device + IP-hash provenance.
/// </para>
/// <para>Spec: §04.3.1.</para>
/// </summary>
public sealed class AuditContextMiddleware
{
    private readonly RequestDelegate _next;

    public AuditContextMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext ctx, IpHasher ipHasher)
    {
        var deviceId = ctx.Request.Headers["X-Device-Id"].FirstOrDefault() ?? "unknown";
        var ip = ctx.Connection.RemoteIpAddress?.ToString();
        ctx.Items["audit.device_id"] = deviceId;
        ctx.Items["audit.ip_hash"] = ipHasher.Hash(ip);
        await _next(ctx);
    }
}
