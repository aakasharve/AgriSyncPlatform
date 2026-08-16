// spec: dfes-companion-2026-07-11 (wave-1.5)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.UseCases.Logs.BackfillOwnerAttestations;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.5) — gives
/// <see cref="BackfillOwnerAttestationsHandler"/> the only database posture from which it
/// can actually see the farm history it exists to repair.
///
/// <para><b>Why the handler cannot just be resolved from DI.</b> The scoped
/// <c>IShramSafalRepository</c> is built over a <see cref="ShramSafalDbContext"/> that
/// carries <c>TenantConnectionInterceptor</c>, and the repair spans every farm in the
/// system so there is no single tenant claim to set. Calling
/// <c>TenantContext.ElevateToAdminCrossTenant()</c> is NOT sufficient and fails in the
/// worst possible way: it only tells the interceptor to skip GUC injection, after which
/// the RLS policy <c>farm_id = current_setting('agrisync.farm_id', true)::uuid</c>
/// evaluates against NULL and returns ZERO ROWS. The backfill would then report
/// "no logs need repair" against a database full of stuck days and every assertion about
/// its boundaries would pass vacuously. (This is the documented 03.4 boundary on
/// <see cref="IAdminDbContextFactory{TContext}"/>, and it was reproduced here before this
/// runner existed.)</para>
///
/// <para><b>So it goes through the admin factory</b>, exactly as
/// <c>BackfillFarmOwnerAccounts</c>, <c>RetentionSweepWorker</c> and the privacy workers
/// do: a context with no interceptor attached, on the privileged migration connection,
/// and an <c>admin_cross_tenant</c> audit row written BEFORE the context is handed over —
/// so the elevation is on the ledger even if the repair then crashes.</para>
///
/// <para><b>Why this class lives in Infrastructure.</b> <c>ShramSafalRepository</c> is
/// <c>internal</c>, so only this assembly can pair it with a hand-built context. Nothing
/// about the repair's RULES lives here: authority is still
/// <c>GetUserRoleForFarmAsync</c> and the FSM is still
/// <c>VerificationStateMachine</c>, both reached through the same handler the rest of the
/// application would use. This type supplies a connection and nothing else.</para>
/// </summary>
public sealed class OwnerAttestationBackfillRunner(
    IAdminDbContextFactory<ShramSafalDbContext> adminDbContextFactory,
    IIdGenerator idGenerator,
    IClock clock,
    ILogger<BackfillOwnerAttestationsHandler> handlerLogger)
{
    /// <summary>
    /// Runs one pass and commits it. The caller loops until a pass comes back under
    /// <paramref name="batchSize"/>; each pass gets its own privileged context so a long
    /// history is not repaired inside one transaction that holds locks across the whole
    /// <c>daily_logs</c> table while the API is booting.
    /// </summary>
    public async Task<BackfillOwnerAttestationsResult> RunPassAsync(
        int batchSize, CancellationToken ct)
    {
        await using var adminDb = await adminDbContextFactory.CreateAsync(
            reason: nameof(OwnerAttestationBackfillRunner),
            actorUserId: SystemActor.Worker,
            ct: ct);

        var repository = new ShramSafalRepository(adminDb);
        var handler = new BackfillOwnerAttestationsHandler(
            repository, idGenerator, clock, handlerLogger);

        var result = await handler.HandleAsync(
            new BackfillOwnerAttestationsCommand(batchSize), ct);

        return result.IsSuccess
            ? result.Value!
            : throw new InvalidOperationException(
                $"Owner-attestation backfill pass failed: {result.Error?.ToString() ?? "unknown"}");
    }
}
