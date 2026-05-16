using Microsoft.AspNetCore.Http;

namespace AgriSync.BuildingBlocks.Audit;

/// <summary>
/// Reader-side counterpart to <see cref="AuditContextMiddleware"/>. Handlers
/// inside the HTTP request pipeline call <c>ctx.AuditClaims()</c> to retrieve
/// the device_id + ip_hash pair that the middleware deposited into
/// <c>HttpContext.Items</c>.
/// <para>
/// Worker/cron emission paths (those that run outside HTTP, e.g. nightly
/// sweepers, retention jobs, outbox handlers) call <see cref="WorkerClaims"/>
/// to obtain the sentinel pair <c>("worker", "sha256:worker")</c>. This
/// preserves the non-null <c>AuditEvent.DeviceId</c> / <c>IpHash</c>
/// invariant set in §04.1 without faking a forensic identity.
/// </para>
/// <para>Spec: §04.3.2 + senior-architect R5 (worker sentinel fallback).</para>
/// </summary>
public static class AuditContextAccessor
{
    public static (string deviceId, string ipHash) AuditClaims(this HttpContext ctx) =>
        ((string?)ctx.Items["audit.device_id"] ?? "unknown",
         (string?)ctx.Items["audit.ip_hash"] ?? "sha256:unknown");

    /// <summary>
    /// Sentinel pair for handlers invoked outside an HTTP request
    /// (background services, cron jobs, outbox subscribers).
    /// </summary>
    public static (string deviceId, string ipHash) WorkerClaims() =>
        ("worker", "sha256:worker");
}
