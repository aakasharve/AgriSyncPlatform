using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.Ports;

public interface IFarmInvitationRepository
{
    Task AddInvitationAsync(FarmInvitation invitation, CancellationToken ct = default);
    Task AddTokenAsync(FarmJoinToken token, CancellationToken ct = default);

    /// <summary>
    /// Fetch the current Active invitation for a farm (if any).
    /// Used by the idempotent issue path.
    /// </summary>
    Task<FarmInvitation?> GetActiveInvitationByFarmAsync(FarmId farmId, CancellationToken ct = default);

    /// <summary>
    /// Fetch the Active join token for an invitation, or null if revoked.
    /// </summary>
    Task<FarmJoinToken?> GetActiveTokenByInvitationAsync(FarmInvitationId invitationId, CancellationToken ct = default);

    /// <summary>
    /// Claim-path lookup: hash the submission, look up the token row.
    /// Returns null if not found, regardless of revoked state — the
    /// handler decides whether a revoked token can be distinguished from
    /// "no such token" externally (it cannot; same 404 for both).
    /// </summary>
    Task<FarmJoinToken?> GetTokenByHashAsync(string tokenHash, CancellationToken ct = default);

    Task SaveChangesAsync(CancellationToken ct = default);
}
