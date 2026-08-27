using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Compliance.EvaluateCompliance;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// CEI Phase 3 §4.6 — nightly compliance evaluation sweeper.
/// Runs at 03:00 UTC daily: fetches all active farm IDs and dispatches
/// <see cref="EvaluateComplianceCommand"/> per farm via a scoped DI scope.
/// Failures on individual farms are caught and logged so one bad farm
/// does not block the rest.
/// </summary>
public sealed class ComplianceEvaluatorSweeper(
    IServiceScopeFactory scopeFactory,
    ILogger<ComplianceEvaluatorSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("ComplianceEvaluatorSweeper started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken);

            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(3); // 03:00 UTC next day
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("ComplianceEvaluatorSweeper stopping.");
    }

    /// <summary>
    /// One (farm, owning account) pair from the privileged enumeration. The
    /// owner account id is carried alongside because the per-farm pass needs it
    /// to establish the tenant scope — looking it up later would be another
    /// RLS-bound read with no identity, i.e. the very bug this pass had.
    /// </summary>
    private readonly record struct SweepTarget(Guid FarmId, Guid OwnerAccountId);

    private async Task RunPassAsync(CancellationToken ct)
    {
        List<SweepTarget> targets;

        await using (var scope = scopeFactory.CreateAsyncScope())
        {
            // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — listing
            // every active farm is by definition a cross-tenant read. The
            // admin factory writes an AuditEvent("admin_cross_tenant","open")
            // row with farm_id=NULL BEFORE returning, recording the pre-
            // pass enumeration on ssf.audit_events.
            //
            // RLS FIX (2026-08-10). The pass used to DISCARD this privileged
            // context and re-ask the question through the SCOPED
            // IShramSafalRepository under ElevateToAdminCrossTenant. Admin
            // elevation only tells TenantConnectionInterceptor to skip its GUC
            // prelude — it grants no visibility. ssf.farm_memberships has RLS
            // ENABLED and FORCED and the app connects as agrisync_app (owns
            // nothing, no BYPASSRLS), so `SELECT DISTINCT farm_id FROM
            // ssf.farm_memberships WHERE status = 3` returned ZERO rows and the
            // sweeper logged "no active farms found" every single night since it
            // shipped — a nightly job that had never once run its body in normal
            // operation. The enumeration now runs ON the privileged context the
            // factory hands back (ShramSafalDb_Migration role, which does bypass
            // the policies), which is what that context was always for.
            var adminFactory = scope.ServiceProvider
                .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var adminDb = await adminFactory.CreateAsync(
                reason: $"{nameof(ComplianceEvaluatorSweeper)}.enumerate",
                actorUserId: SystemActor.Worker,
                ct: ct);

            targets = await adminDb.FarmMemberships
                .AsNoTracking()
                .Where(m => m.Status == MembershipStatus.Active)
                .Join(adminDb.Farms.AsNoTracking(),
                    m => m.FarmId,
                    f => f.Id,
                    (m, f) => new SweepTarget((Guid)f.Id, (Guid)f.OwnerAccountId))
                .Distinct()
                .ToListAsync(ct);
        }

        if (targets.Count == 0)
        {
            logger.LogDebug("ComplianceEvaluatorSweeper: no active farms found.");
            return;
        }

        logger.LogInformation("ComplianceEvaluatorSweeper evaluating {Count} farms.", targets.Count);
        int totalOpened = 0, totalRefreshed = 0, totalAutoResolved = 0;

        foreach (var (farmId, ownerAccountId) in targets)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();
                // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — the
                // compliance handler operates on a single farm but its
                // DAOs span multiple tables under one ShramSafalDbContext
                // scope; routing through the admin factory records a
                // per-farm AuditEvent("admin_cross_tenant","open") row
                // with farm_id=NULL on ssf.audit_events. The reason string
                // is keyed to the FarmId so investigators can correlate
                // the opening with downstream tenant-scoped audit writes
                // emitted by EvaluateComplianceHandler itself.
                var adminFactory = scope.ServiceProvider
                    .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
                await using (await adminFactory.CreateAsync(
                    reason: $"{nameof(ComplianceEvaluatorSweeper)}.evaluate.{farmId:N}",
                    actorUserId: SystemActor.Worker,
                    ct: ct))
                {
                    // Audit row committed; primary context disposed.
                }

                // RLS FIX (2026-08-10) — the handler runs on the SCOPED
                // ShramSafalDbContext, so it needs a REAL tenant identity, not
                // just elevation. Elevate first so the interceptor no-ops (its
                // per-command SET LOCAL prepend desyncs EF's rows-affected
                // accounting on writes — see
                // reference_interceptor_setlocal_desyncs_ef_writes, and this
                // handler WRITES ssf.compliance_signals + ssf.audit_events),
                // then let RlsIdentityScope set agrisync.farm_id +
                // agrisync.owner_account_id itself. That is the same
                // admin-elevate-then-set_config technique CallerFarmTenantScope
                // uses on the HTTP path. The helper owns the transaction,
                // because a cron pass has no request pipeline to open one and
                // `set_config(..., is_local := true)` outside a transaction is a
                // silent no-op.
                //
                // Cross-tenant enumeration stays privileged (above); per-farm
                // work is genuinely single-farm-scoped, so a bug in the handler
                // cannot reach another farm's rows.
                var tenantContext = scope.ServiceProvider.GetRequiredService<TenantContext>();
                tenantContext.ElevateToAdminCrossTenant();
                var scopedDb = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
                var handler = scope.ServiceProvider.GetRequiredService<IHandler<EvaluateComplianceCommand, EvaluateComplianceResult>>();

                // DATA_PRINCIPLE_SPINE sub-phase 04.3b §Part 2 — cron path
                // has no HttpContext, so we explicitly construct the command
                // with AuditContextAccessor.WorkerClaims() ("worker",
                // "sha256:worker") plus the entry assembly's
                // AppVersionProvider.Current. Every AuditEvent row emitted
                // by the handler inherits this forensic-provenance trio.
                var (deviceId, ipHash) = AuditContextAccessor.WorkerClaims();
                var result = await RlsIdentityScope.RunAsFarmAsync(
                    scopedDb,
                    farmId,
                    ownerAccountId,
                    // No human actor on a cron pass. Leaving agrisync.user_id
                    // unset keeps the user-scoped policies fail-closed; the
                    // farm-scoped p_tenant_* policies are what this pass needs.
                    actorUserId: null,
                    token => handler.HandleAsync(
                        new EvaluateComplianceCommand(
                            FarmId: new FarmId(farmId),
                            ClientAppVersion: AppVersionProvider.Current,
                            AuditDeviceId: deviceId,
                            AuditIpHash: ipHash),
                        token),
                    ct);

                if (result.IsSuccess && result.Value is not null)
                {
                    totalOpened += result.Value.Opened;
                    totalRefreshed += result.Value.Refreshed;
                    totalAutoResolved += result.Value.AutoResolved;
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "ComplianceEvaluatorSweeper failed for farm {FarmId}.", farmId);
            }
        }

        logger.LogInformation(
            "ComplianceEvaluatorSweeper completed. Opened: {Opened}, Refreshed: {Refreshed}, AutoResolved: {AutoResolved}.",
            totalOpened, totalRefreshed, totalAutoResolved);
    }
}
