using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;

namespace AgriSync.Bootstrapper.Adapters;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3) - his own PERSON picture for <c>GET /user/auth/me/identity</c>, read from
/// ShramSafal's <c>ssf.pictures</c> by this composition root (the User context never references ShramSafal). The identity door sits under
/// <c>/user/auth</c>, which is admin-elevated with NO tenant setting, and <c>ssf.pictures</c> is FORCE-RLS with reads open to every USER scope: so
/// the read runs inside <see cref="RlsIdentityScope.RunAsUserAsync{T}"/> with the caller's own validated id (its own short transaction, as
/// <see cref="FarmMembershipSnapshotReader"/> does). Only his own picture is asked for; only its id and hash leave.
/// </summary>
public sealed class MePictureSnapshotReader(ShramSafalDbContext ssfDb) : IMePictureSnapshotReader
{
    public async Task<MePictureSnapshot?> GetForUserAsync(UserId userId, CancellationToken ct = default)
    {
        if (userId == UserId.Empty)
        {
            return null;
        }

        var row = await RlsIdentityScope.RunAsUserAsync(
            ssfDb,
            userId.Value,
            token => ssfDb.Pictures
                .AsNoTracking()
                .Where(p => p.Kind == ShramSafal.Domain.Pictures.PictureKind.Person && p.SubjectId == userId.Value)
                .Select(p => new { p.Id, p.Sha256 })
                .FirstOrDefaultAsync(token),
            ct);
        return row is null ? null : new MePictureSnapshot(row.Id, row.Sha256);
    }
}
