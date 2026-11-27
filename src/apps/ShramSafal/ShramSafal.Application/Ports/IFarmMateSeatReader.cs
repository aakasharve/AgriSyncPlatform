using AgriSync.SharedKernel.Contracts.Roles;

namespace ShramSafal.Application.Ports;

/// <summary>One Active seat on a farm: who holds it and in what role.</summary>
public sealed record FarmMateSeat(Guid FarmId, Guid UserId, AppRole Role);

/// <summary>A farm the reader works on, with its owner account (the tenant scope its seats are read under).</summary>
public sealed record FarmMateFarm(Guid FarmId, Guid OwnerAccountId);

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S3; CTO ruling on founder question 2 = B). The Active seats of the farms a
/// person works on, so <c>PictureViewer</c> can say whose face he may see. A pull and the picture file door run under the caller's USER scope, where
/// row security shows him only his OWN seat rows (<c>p_user_select_memberships</c>); the implementation reads each farm's seats under THAT farm's
/// tenant scope instead (its own short transaction, never the request's, so no farm setting outlives the read).
///
/// <para><b>Authorization is the caller's job.</b> Ask only for farms the reader holds a working (Active) standing on - the read scopes the pull and
/// the door already computed from his own seats. Only ids and roles come back: no name, no phone.</para>
/// </summary>
public interface IFarmMateSeatReader
{
    /// <summary>Every Active, not-ended seat of each of <paramref name="farms"/>, read for <paramref name="readerUserId"/>.</summary>
    Task<IReadOnlyList<FarmMateSeat>> GetActiveSeatsAsync(
        IReadOnlyCollection<FarmMateFarm> farms, Guid readerUserId, CancellationToken ct = default);
}
