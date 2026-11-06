using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>spec: plr-d10 lane MU-2 — see <see cref="IPersonalInvitationRepository"/>.</summary>
internal sealed class PersonalInvitationRepository(ShramSafalDbContext db) : IPersonalInvitationRepository
{
    private const string CodeIndex = "ux_farm_personal_invitations_code";

    public Task AddAsync(PersonalInvitation invitation, CancellationToken ct = default)
        => db.PersonalInvitations.AddAsync(invitation, ct).AsTask();

    public async Task<PersonalInvitation?> GetForFarmForUpdateAsync(Guid farmId, Guid invitationId, CancellationToken ct = default)
    {
        var farm = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId);
        if (db.Database.IsRelational())
        {
            // Row-locked (under the caller's farm scope, so only this farm's row can be locked): two taps — a claim and
            // a withdrawal, or two claims — are decided one after the other. Same lock-then-read as the seat's.
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT 1 FROM ssf.farm_personal_invitations WHERE id = {invitationId} AND farm_id = {farmId} FOR UPDATE", ct);
        }

        return await db.PersonalInvitations.FirstOrDefaultAsync(x => x.Id == invitationId && x.FarmId == farm, ct);
    }

    public async Task<IReadOnlyList<PersonalInvitation>> ListForFarmAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
    {
        var farm = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId);
        return await db.PersonalInvitations
            .AsNoTracking()
            .Where(x => x.FarmId == farm && x.CreatedAtUtc >= sinceUtc)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);
    }

    public Task<int> CountCreatedSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
    {
        var farm = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId);
        return db.PersonalInvitations.CountAsync(x => x.FarmId == farm && x.CreatedAtUtc >= sinceUtc, ct);
    }

    public async Task<IReadOnlyList<PersonalInvitation>> GetWaitingForPhoneAsync(Guid farmId, string phoneE164, CancellationToken ct = default)
    {
        var farm = new AgriSync.SharedKernel.Contracts.Ids.FarmId(farmId);
        return await db.PersonalInvitations
            .Where(x => x.FarmId == farm && x.InvitedPhoneE164 == phoneE164 && x.Status == PersonalInvitationStatus.Waiting)
            .ToListAsync(ct);
    }

    public Task<PersonalInvitation?> FindVisibleByCodeAsync(string code, CancellationToken ct = default)
        => db.PersonalInvitations.AsNoTracking().FirstOrDefaultAsync(x => x.Code == code, ct);

    public async Task<IReadOnlyList<PersonalInvitation>> ListVisibleAsync(CancellationToken ct = default)
        => await db.PersonalInvitations.AsNoTracking().OrderByDescending(x => x.CreatedAtUtc).Take(50).ToListAsync(ct);

    public async Task<bool> TrySaveNewAsync(PersonalInvitation invitation, CancellationToken ct = default)
    {
        var entry = db.Entry(invitation);
        if (entry.State == EntityState.Detached)
        {
            await db.PersonalInvitations.AddAsync(invitation, ct);
        }

        var tx = db.Database.IsRelational() ? db.Database.CurrentTransaction : null;
        const string savepoint = "personal_invitation_code";
        if (tx is not null)
        {
            await tx.CreateSavepointAsync(savepoint, ct);
        }

        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } pg
                                           && pg.ConstraintName == CodeIndex)
        {
            // Eight digits already taken: undo this attempt only (the request's transaction lives on) and let the caller
            // make a fresh code. Everything else staged with it stays staged for the next attempt.
            if (tx is not null)
            {
                await tx.RollbackToSavepointAsync(savepoint, ct);
            }

            db.Entry(invitation).State = EntityState.Detached;
            return false;
        }
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
