// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT, S1) - the person's own identity card in the User context.
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using User.Application.Ports;
using User.Domain.Identity;

namespace User.Infrastructure.Persistence.Repositories;

/// <summary>
/// <see cref="IUserIdentityProfileStore"/> over <c>public.user_identity_profiles</c>. The table carries no row security (like <c>public.users</c>):
/// its only doors are the person's own (the id is his token's). The version column is the row's concurrency token, so a save that read an older
/// card than the one stored writes nothing (EF's <c>WHERE version = original</c>), and a first card made twice at once is refused by the key.
/// </summary>
internal sealed class UserIdentityProfileStore(UserDbContext db) : IUserIdentityProfileStore
{
    private const string UniqueViolation = "23505";

    public Task<UserIdentityProfile?> GetAsync(UserId userId, bool track, CancellationToken ct = default)
    {
        var query = track ? db.UserIdentityProfiles : db.UserIdentityProfiles.AsNoTracking();
        return query.FirstOrDefaultAsync(p => p.UserId == userId, ct);
    }

    public void Add(UserIdentityProfile profile) => db.UserIdentityProfiles.Add(profile);

    public async Task<int> CurrentVersionAsync(UserId userId, CancellationToken ct = default) =>
        await db.UserIdentityProfiles.AsNoTracking()
            .Where(p => p.UserId == userId)
            .Select(p => (int?)p.Version)
            .FirstOrDefaultAsync(ct) ?? 0;

    public async Task<bool> TrySaveAsync(CancellationToken ct = default)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            Discard();
            return false;
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: UniqueViolation })
        {
            Discard();
            return false;
        }
    }

    /// <summary>Nothing of a lost save stays staged in this unit of work.</summary>
    private void Discard()
    {
        foreach (var entry in db.ChangeTracker.Entries().Where(e => e.State is EntityState.Added or EntityState.Modified or EntityState.Deleted).ToList())
        {
            entry.State = EntityState.Detached;
        }
    }
}
