using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

internal sealed class FarmInvitationRepository(ShramSafalDbContext db) : IFarmInvitationRepository
{
    public Task AddInvitationAsync(FarmInvitation invitation, CancellationToken ct = default)
        => db.FarmInvitations.AddAsync(invitation, ct).AsTask();

    public Task AddTokenAsync(FarmJoinToken token, CancellationToken ct = default)
        => db.FarmJoinTokens.AddAsync(token, ct).AsTask();

    public Task<FarmInvitation?> GetActiveInvitationByFarmAsync(FarmId farmId, CancellationToken ct = default)
        => db.FarmInvitations
            .Where(x => x.FarmId == farmId && x.Status == InvitationStatus.Active)
            .FirstOrDefaultAsync(ct);

    public Task<FarmJoinToken?> GetActiveTokenByInvitationAsync(FarmInvitationId invitationId, CancellationToken ct = default)
        => db.FarmJoinTokens
            .Where(x => x.InvitationId == invitationId && !x.IsRevoked)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);

    public Task<FarmJoinToken?> GetTokenByHashAsync(string tokenHash, CancellationToken ct = default)
        => db.FarmJoinTokens
            .Where(x => x.TokenHash == tokenHash)
            .FirstOrDefaultAsync(ct);

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
