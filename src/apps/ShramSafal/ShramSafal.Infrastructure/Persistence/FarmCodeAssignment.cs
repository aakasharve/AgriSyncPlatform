// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, M3)
using Microsoft.EntityFrameworkCore;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence.Repositories;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1, M3) — the ONE way a farm is saved with a freshly
/// drawn code. Codes are random (<see cref="FarmCode.New"/>) and uniqueness is the database's job
/// (<c>ux_farms_farm_code</c>), so a draw can, rarely, equal another farm's code. Before this, only
/// <c>EnsureFarmCodeAsync</c> (the invite sheet, the startup backfill) drew again on that
/// collision; the two paths that CREATE a farm — <c>CreateFarmHandler</c> and
/// <c>POST /bootstrap/first-farm</c> — assigned one draw and let the unique violation fail the
/// whole creation (a farmer's first farm refused with a 500). All three now go through here.
///
/// <para><b>Why a retry is safe.</b> EF Core wraps <c>SaveChanges</c> in a savepoint when a
/// transaction is already open (the request transaction <c>TenantTransactionMiddleware</c> opens,
/// or the bootstrap's) and rolls back to it on failure, or uses its own transaction when none is
/// open; either way the failed INSERT/UPDATE leaves nothing behind and the transaction stays
/// usable. The entities stay Added / Modified, so the next save re-sends them — the farm with its
/// new code, plus whatever else the same unit of work added (the owner's seat, the audit row).
/// Proven against real Postgres by <c>JoinByCodeRealPostgresTests</c> (one collision forced on
/// each creation path and on the invite-sheet path).</para>
/// </summary>
public static class FarmCodeAssignment
{
    /// <summary>Draws per save before a collision is allowed to fail it. At ~1 in a billion per
    /// existing farm per draw, five consecutive collisions mean something other than chance.</summary>
    public const int MaxDraws = 5;

    /// <summary>The unique index that makes two farms with one code impossible.</summary>
    public const string UniqueIndexName = "ux_farms_farm_code";

    /// <summary>
    /// Gives <paramref name="farm"/> a code from <paramref name="drawFarmCode"/> and saves every
    /// pending change on <paramref name="db"/>; on a collision with another farm's code, draws
    /// again and saves again, at most <see cref="MaxDraws"/> times. <paramref name="farm"/> must be
    /// tracked by <paramref name="db"/> (Added for a new farm, Unchanged/Modified for an existing
    /// one), or the new code is never written. Any other failure propagates unchanged.
    /// </summary>
    public static async Task SaveWithFreshFarmCodeAsync(
        DbContext db,
        Farm farm,
        DateTime utcNow,
        Func<string> drawFarmCode,
        CancellationToken ct = default)
    {
        for (var draw = 1; ; draw++)
        {
            farm.AssignFarmCode(drawFarmCode(), utcNow);
            try
            {
                await db.SaveChangesAsync(ct);
                return;
            }
            catch (DbUpdateException ex) when (draw < MaxDraws && IsFarmCodeCollision(ex))
            {
                // Another farm already holds this code. EF rolled the failed statement back (see
                // the class remarks) and left the entities pending, so the next draw re-sends them.
            }
        }
    }

    /// <summary>True when <paramref name="ex"/> is a unique violation on <see cref="UniqueIndexName"/>.</summary>
    public static bool IsFarmCodeCollision(DbUpdateException ex)
        => ShramSafalRepository.IsUniqueViolationOn(ex, UniqueIndexName);
}
