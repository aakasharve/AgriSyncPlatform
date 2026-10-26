// spec: plr-d7-m1-multiuser-2026-10-26 (step 1)
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) — gives every farm that has no code one, so the
/// owner's QR sheet never shows a blank code and every farm can be joined by typing its code.
/// Farms made before this change (the demo farm among them — D-1) were created by paths that
/// never assigned one; new farms get one at creation.
///
/// <para><b>Same posture as <see cref="OwnerAttestationBackfillRunner"/>, for the same
/// reason.</b> It spans every farm, so it cannot run on the tenant-scoped context (under an
/// admin posture that context sees zero rows and the backfill would report "nothing to do"
/// against a table full of blank codes). It goes through
/// <see cref="IAdminDbContextFactory{TContext}"/>, which records an
/// <c>admin_cross_tenant</c> audit row before handing the context over.</para>
///
/// <para><b>Safe to re-run, by data.</b> Only farms whose code is null or blank are candidates,
/// and each gets a code through the repository's <c>EnsureFarmCodeAsync</c> — the same
/// collision-safe path the invite sheet uses — so a second run finds nothing and changes
/// nothing. Codes already assigned are never changed (people may have them written down).</para>
/// </summary>
public sealed class FarmCodeBackfillRunner(IAdminDbContextFactory<ShramSafalDbContext> adminDbContextFactory)
{
    /// <summary>
    /// Assigns a code to every farm without one and commits each as it goes. Returns how many
    /// farms were looked at and how many received a code (equal unless cancelled).
    /// </summary>
    public async Task<FarmCodeBackfillResult> RunAsync(CancellationToken ct)
    {
        await using var adminDb = await adminDbContextFactory.CreateAsync(
            reason: nameof(FarmCodeBackfillRunner),
            actorUserId: SystemActor.Worker,
            ct: ct);

        var farmsWithoutCode = await adminDb.Farms
            .Where(f => f.FarmCode == null || f.FarmCode == string.Empty)
            .OrderBy(f => f.CreatedAtUtc)
            .ToListAsync(ct);

        var repository = new ShramSafalRepository(adminDb);
        var assigned = 0;
        foreach (var farm in farmsWithoutCode)
        {
            if (ct.IsCancellationRequested)
            {
                break;
            }

            // One commit per farm: a failure leaves every earlier farm's code in place.
            await repository.EnsureFarmCodeAsync(farm, DateTime.UtcNow, ct);
            assigned++;
        }

        return new FarmCodeBackfillResult(farmsWithoutCode.Count, assigned);
    }
}

public sealed record FarmCodeBackfillResult(int FarmsWithoutCode, int Assigned);
