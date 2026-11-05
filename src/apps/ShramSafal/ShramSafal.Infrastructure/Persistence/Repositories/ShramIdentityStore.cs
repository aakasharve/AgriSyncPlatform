using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Identity;
using ShramSafal.Infrastructure.Auth;

namespace ShramSafal.Infrastructure.Persistence.Repositories;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. <see cref="IShramIdentityStore"/> on the request's own
/// <see cref="ShramSafalDbContext"/>: every person-table call first opens <see cref="IdentityTenantScope"/> (once per
/// request), so the FORCE-RLS policies let THIS request — and no normal farm session — read and write them.
/// </summary>
internal sealed class ShramIdentityStore(ShramSafalDbContext db, IdentityTenantScope scope) : IShramIdentityStore
{
    public async Task<ShramPerson?> GetPersonAsync(Guid personId, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPersons.FirstOrDefaultAsync(p => p.Id == personId, ct);
    }

    public async Task<IReadOnlyList<ShramPerson>> GetPersonsAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return [];
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();
        return await db.ShramPersons.Where(p => ids.Contains(p.Id)).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ShramPerson>> GetPersonsMergedIntoAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return [];
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();
        return await db.ShramPersons
            .Where(p => p.MergedIntoPersonId != null && ids.Contains(p.MergedIntoPersonId.Value))
            .ToListAsync(ct);
    }

    public async Task AddPersonAsync(ShramPerson person, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        await db.ShramPersons.AddAsync(person, ct);
    }

    public async Task<ShramCard?> GetCardAsync(string codeBody, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramCards.FirstOrDefaultAsync(c => c.Code == codeBody, ct);
    }

    public async Task<IReadOnlyList<ShramCard>> GetCardsAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return [];
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();
        return await db.ShramCards.Where(c => ids.Contains(c.PersonId)).ToListAsync(ct);
    }

    public async Task AddCardAsync(ShramCard card, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        await db.ShramCards.AddAsync(card, ct);
    }

    public async Task<IReadOnlyList<ShramPersonPhone>> GetPhonesAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return [];
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();
        return await db.ShramPersonPhones.Where(p => ids.Contains(p.PersonId)).ToListAsync(ct);
    }

    public async Task<IReadOnlyList<ShramPersonPhone>> GetActivePhonesByNumberAsync(string phoneE164, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPersonPhones
            .Where(p => p.PhoneE164 == phoneE164 && p.ReleasedAtUtc == null)
            .ToListAsync(ct);
    }

    public async Task AddPhoneAsync(ShramPersonPhone phone, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        await db.ShramPersonPhones.AddAsync(phone, ct);
    }

    public async Task<ShramPhoneChallenge?> GetChallengeAsync(Guid challengeId, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPhoneChallenges.FirstOrDefaultAsync(c => c.Id == challengeId, ct);
    }

    public async Task<int> CountChallengesSinceAsync(string phoneE164, DateTime sinceUtc, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPhoneChallenges.CountAsync(c => c.PhoneE164 == phoneE164 && c.CreatedAtUtc >= sinceUtc, ct);
    }

    public async Task<int> CountChallengesByFarmSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPhoneChallenges.CountAsync(c => c.RequestedByFarmId == farmId && c.CreatedAtUtc >= sinceUtc, ct);
    }

    public async Task<int> CountChallengesByUserSinceAsync(Guid userId, DateTime sinceUtc, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPhoneChallenges.CountAsync(c => c.RequestedByUserId == userId && c.CreatedAtUtc >= sinceUtc, ct);
    }

    public async Task<int> CountWrongTriesByFarmSinceAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);

        // Every try counts; the one right try that spent a code is not a wrong one.
        return await db.ShramPhoneChallenges
            .Where(c => c.RequestedByFarmId == farmId && c.CreatedAtUtc >= sinceUtc)
            .SumAsync(c => c.Attempts - (c.ConsumedAtUtc == null ? 0 : 1), ct);
    }

    public async Task AddChallengeAsync(ShramPhoneChallenge challenge, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        await db.ShramPhoneChallenges.AddAsync(challenge, ct);
    }

    public async Task<IReadOnlyList<ShramIdentityEvent>> GetEventsForRecordAsync(Guid farmId, Guid fieldOperatorId, CancellationToken ct = default)
        => await db.ShramIdentityEvents
            .AsNoTracking()
            .Where(e => e.FarmId == farmId && e.FieldOperatorId == fieldOperatorId)
            .ToListAsync(ct);

    public async Task AddEventAsync(ShramIdentityEvent identityEvent, CancellationToken ct = default)
        => await db.ShramIdentityEvents.AddAsync(identityEvent, ct);

    public async Task<bool> TrySaveChangesAsync(CancellationToken ct = default)
    {
        if (!db.ChangeTracker.HasChanges())
        {
            return true;
        }

        await scope.OpenAsync(ct);

        // A clash on the one-verified-holder index (R3) must not abort the request's transaction: absorb it with a
        // SAVEPOINT (the shape of ShramSafalRepository.TryAddFieldOperatorAsync).
        var transaction = db.Database.CurrentTransaction;
        string? savepoint = null;
        if (transaction is not null)
        {
            savepoint = "sp_identity_" + Guid.NewGuid().ToString("N");
            await transaction.CreateSavepointAsync(savepoint, ct);
        }

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            if (transaction is not null && savepoint is not null)
            {
                await transaction.RollbackToSavepointAsync(savepoint, ct);
            }

            foreach (var entry in db.ChangeTracker.Entries().Where(e => e.State != EntityState.Unchanged).ToList())
            {
                entry.State = entry.State == EntityState.Added ? EntityState.Detached : EntityState.Unchanged;
            }

            return false;
        }

        if (transaction is not null && savepoint is not null)
        {
            await transaction.ReleaseSavepointAsync(savepoint, ct);
        }

        return true;
    }

    public Task CloseAsync(CancellationToken ct = default) => scope.CloseAsync(ct);
}
