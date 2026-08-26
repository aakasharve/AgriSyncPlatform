using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Tests.MarkOverdueInstances;
using ShramSafal.Domain.Tests;
using ShramSafal.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Jobs;

/// <summary>
/// CEI §4.5 — sweeps <c>TestInstance</c> rows that passed their
/// <c>PlannedDueDate</c> without being collected and transitions them from
/// <c>Due</c> → <c>Overdue</c>. Runs once per day at 02:00 UTC.
/// </summary>
public sealed class TestOverdueSweeper(
    IServiceScopeFactory scopeFactory,
    ILogger<TestOverdueSweeper> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("TestOverdueSweeper started.");

        while (!stoppingToken.IsCancellationRequested)
        {
            await RunPassAsync(stoppingToken);

            var now = DateTime.UtcNow;
            var nextRun = now.Date.AddDays(1).AddHours(2); // 02:00 UTC next day
            var delay = nextRun - now;
            if (delay <= TimeSpan.Zero) delay = TimeSpan.FromHours(24);

            try { await Task.Delay(delay, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }

        logger.LogInformation("TestOverdueSweeper stopping.");
    }

    /// <summary>One (farm, owning account) pair from the privileged enumeration.</summary>
    private readonly record struct SweepTarget(Guid FarmId, Guid OwnerAccountId);

    private async Task RunPassAsync(CancellationToken ct)
    {
        // DATA_PRINCIPLE_SPINE 04.7 carry-over (was 03.5b) — the overdue
        // sweep transitions TestInstance rows across every farm; cross-
        // tenant by definition. The admin factory writes an
        // AuditEvent("admin_cross_tenant","open") row with farm_id=NULL
        // BEFORE returning the privileged context, so every nightly pass
        // leaves a forensic breadcrumb on ssf.audit_events that names
        // this sweeper as the opener.
        //
        // RLS FIX (2026-08-10) — the pass used to DISCARD that privileged
        // context and run MarkOverdueInstancesHandler on the SCOPED
        // ShramSafalDbContext under ElevateToAdminCrossTenant. Elevation only
        // tells TenantConnectionInterceptor to skip its GUC prelude; it grants
        // no visibility. ssf.test_instances has RLS ENABLED and FORCED and the
        // runtime role agrisync_app owns nothing and has no BYPASSRLS, so
        // `SELECT ... FROM ssf.test_instances WHERE status = 0 AND
        // planned_due_date < @today` matched nothing and the sweeper logged
        // "no instances to transition" on every pass since it shipped.
        //
        // Shape of the fix mirrors ComplianceEvaluatorSweeper: enumerate the
        // farms on the PRIVILEGED context (the only honest way to ask a
        // cross-tenant question), then run the handler once per farm under a
        // real single-farm identity. RLS narrows each pass's read to that farm,
        // so the handler needs no new parameter — and a bug in it can no longer
        // reach another farm's rows, which a blanket bypass would have allowed.
        List<SweepTarget> targets;
        await using (var enumerationScope = scopeFactory.CreateAsyncScope())
        {
            var adminFactory = enumerationScope.ServiceProvider
                .GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>();
            await using var adminDb = await adminFactory.CreateAsync(
                reason: $"{nameof(TestOverdueSweeper)}.enumerate",
                actorUserId: SystemActor.Worker,
                ct: ct);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            targets = await adminDb.TestInstances
                .AsNoTracking()
                .Where(t => t.Status == TestInstanceStatus.Due && t.PlannedDueDate < today)
                .Join(adminDb.Farms.AsNoTracking(),
                    t => t.FarmId,
                    f => f.Id,
                    (t, f) => new SweepTarget((Guid)f.Id, (Guid)f.OwnerAccountId))
                .Distinct()
                .ToListAsync(ct);
        }

        if (targets.Count == 0)
        {
            logger.LogDebug("TestOverdueSweeper: no instances to transition.");
            return;
        }

        var totalMarked = 0;
        foreach (var (farmId, ownerAccountId) in targets)
        {
            try
            {
                await using var scope = scopeFactory.CreateAsyncScope();

                // Admin-elevate first so the interceptor no-ops (its per-command
                // SET LOCAL prepend desyncs EF's rows-affected accounting on
                // writes — reference_interceptor_setlocal_desyncs_ef_writes —
                // and this handler UPDATEs ssf.test_instances and INSERTs
                // ssf.audit_events), then let RlsIdentityScope establish the
                // real farm identity inside a transaction it owns (a cron pass
                // has no request pipeline, and set_config(..., is_local := true)
                // outside a transaction is a silent no-op).
                scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
                var scopedDb = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
                var handler = scope.ServiceProvider.GetRequiredService<IHandler<MarkOverdueInstancesCommand, int>>();

                // DATA_PRINCIPLE_SPINE sub-phase 04.3b §Part 2 — cron path has
                // no HttpContext, so we explicitly construct the command with
                // AuditContextAccessor.WorkerClaims() ("worker", "sha256:worker")
                // plus the entry assembly's AppVersionProvider.Current. Every
                // AuditEvent row emitted by the handler inherits this trio.
                var (deviceId, ipHash) = AuditContextAccessor.WorkerClaims();
                var result = await RlsIdentityScope.RunAsFarmAsync(
                    scopedDb,
                    farmId,
                    ownerAccountId,
                    actorUserId: null,
                    token => handler.HandleAsync(
                        new MarkOverdueInstancesCommand(
                            ClientAppVersion: AppVersionProvider.Current,
                            AuditDeviceId: deviceId,
                            AuditIpHash: ipHash),
                        token),
                    ct);

                if (!result.IsSuccess)
                {
                    logger.LogWarning(
                        "TestOverdueSweeper returned failure {ErrorCode} for farm {FarmId}: {Description}.",
                        result.Error.Code,
                        farmId,
                        result.Error.Description);
                    continue;
                }

                totalMarked += result.Value;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                logger.LogError(ex, "TestOverdueSweeper pass failed for farm {FarmId}.", farmId);
            }
        }

        if (totalMarked > 0)
        {
            logger.LogInformation(
                "TestOverdueSweeper marked {Count} test instances as Overdue across {Farms} farms.",
                totalMarked, targets.Count);
        }
        else
        {
            logger.LogDebug("TestOverdueSweeper: no instances to transition.");
        }
    }
}
