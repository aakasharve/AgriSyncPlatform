// spec: data-principle-spine-2026-05-05/03.5
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using ShramSafal.Domain.Audit;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.5 — concrete
/// <see cref="IAdminDbContextFactory{TContext}"/> for
/// <see cref="ShramSafalDbContext"/>. Returns a privileged context whose
/// options chain has NO <see cref="TenantConnectionInterceptor"/>
/// attached, so commands leave the wire without the per-request
/// <c>set_config('agrisync.farm_id', …)</c> prelude that would otherwise
/// fail-closed when no tenant claim is present.
///
/// <para>
/// <b>Connection string search order</b> (mirrors the design-time
/// <see cref="ShramSafalDbContextFactory"/>):
/// <list type="number">
/// <item><c>ShramSafalDb_Migration</c> — preferred. Privileged role
/// (locally <c>postgres</c>; in RDS the IAM-assumed deploy role) that
/// owns every table created by EF Core and therefore bypasses RLS
/// policy evaluation when the table-owner-applies-FORCE escape ratchet
/// is in play.</item>
/// <item><c>ShramSafalDb</c> — fallback so a developer who has only the
/// runtime app role configured can still iterate on admin-scope code
/// paths locally; in production the migration role is always provided
/// by the deploy pipeline.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Audit-first contract.</b> Every <see cref="CreateAsync"/> call
/// writes an <see cref="AuditEvent"/> row to <c>ssf.audit_events</c>
/// BEFORE returning the primary context — the cross-tenant scope only
/// becomes usable once the auditing tx is committed. The audit context
/// is a SHORT-LIVED parallel <see cref="ShramSafalDbContext"/> with the
/// same NO-interceptor options; <c>await using</c> scoped so it
/// disposes immediately after the commit. This keeps the audit row's
/// own write from running under the privileged scope the caller is
/// about to use.
/// </para>
///
/// <para>
/// <b>Why a separate audit context.</b> Writing the audit through the
/// returned primary context would race the caller's transaction
/// boundary — a caller that fails before <c>SaveChangesAsync</c> would
/// lose its audit row, defeating the gate. A self-contained audit tx
/// is committed unconditionally so the "admin opened a cross-tenant
/// scope" fact survives downstream failure.
/// </para>
/// </summary>
public sealed class ShramSafalAdminDbContextFactory : IAdminDbContextFactory<ShramSafalDbContext>
{
    private readonly IConfiguration _configuration;

    public ShramSafalAdminDbContextFactory(IConfiguration configuration)
    {
        _configuration = configuration ?? throw new ArgumentNullException(nameof(configuration));
    }

    public async Task<ShramSafalDbContext> CreateAsync(string reason, Guid actorUserId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reason))
        {
            throw new ArgumentException(
                "Reason is required when opening an admin cross-tenant DbContext.", nameof(reason));
        }

        if (actorUserId == Guid.Empty)
        {
            throw new ArgumentException(
                "Actor user id is required when opening an admin cross-tenant DbContext.", nameof(actorUserId));
        }

        var connectionString =
            _configuration.GetConnectionString("ShramSafalDb_Migration")
            ?? _configuration.GetConnectionString("ShramSafalDb")
            ?? throw new InvalidOperationException(
                "Connection string 'ShramSafalDb_Migration' (or fallback 'ShramSafalDb') is required " +
                "for ShramSafalAdminDbContextFactory.");

        // Options chain has NO TenantConnectionInterceptor attached.
        // Commands leave without the set_config(...) prelude, so the
        // table-owner connection bypasses RLS policy evaluation.
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        // ── Audit BEFORE returning the privileged context ──────────────
        // Use a parallel short-lived context so the audit row is
        // committed independently of whatever the caller is about to do
        // with the returned primary context. Caller failures must NOT
        // erase the "admin opened a cross-tenant scope" fact.
        var openedAtUtc = DateTime.UtcNow;
        await using (var auditContext = new ShramSafalDbContext(options))
        {
            var auditEvent = AuditEvent.Create(
                farmId: null,
                entityType: "admin_cross_tenant",
                // AuditEvent.Create rejects Guid.Empty, so each opening
                // gets its own unique entity id — also handy for
                // correlating audit rows with downstream operations.
                entityId: Guid.NewGuid(),
                action: "open",
                actorUserId: actorUserId,
                actorRole: "admin_cross_tenant",
                payload: new
                {
                    reason,
                    openedAtUtc,
                    appVersion = AppVersionProvider.Current,
                },
                clientCommandId: null,
                occurredAtUtc: openedAtUtc);

            auditContext.AuditEvents.Add(auditEvent);
            await auditContext.SaveChangesAsync(ct);
        }

        // Fresh primary context for the caller — separate instance so
        // disposal is the caller's responsibility and the audit context
        // is already torn down.
        return new ShramSafalDbContext(options);
    }
}
