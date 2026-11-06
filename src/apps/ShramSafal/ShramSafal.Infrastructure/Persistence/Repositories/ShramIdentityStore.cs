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

    public async Task<IReadOnlyList<ShramPhoneChallenge>> GetChallengesToNumberSinceAsync(
        string phoneE164, DateTime sinceUtc, CancellationToken ct = default)
    {
        await scope.OpenAsync(ct);
        return await db.ShramPhoneChallenges.AsNoTracking()
            .Where(c => c.PhoneE164 == phoneE164 && c.CreatedAtUtc >= sinceUtc)
            .ToListAsync(ct);
    }

    public async Task<IReadOnlyDictionary<Guid, int>> CountWrongTriesForPersonsByFarmSinceAsync(
        IReadOnlyCollection<Guid> personIds, DateTime sinceUtc, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return new Dictionary<Guid, int>();
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();

        // Every try counts; the one right try that spent a code is not a wrong one (as for a farm).
        var rows = await db.ShramPhoneChallenges.AsNoTracking()
            .Where(c => ids.Contains(c.PersonId) && c.CreatedAtUtc >= sinceUtc)
            .GroupBy(c => c.RequestedByFarmId)
            .Select(g => new { Farm = g.Key, Wrong = g.Sum(c => c.Attempts - (c.ConsumedAtUtc == null ? 0 : 1)) })
            .ToListAsync(ct);
        return rows.ToDictionary(r => r.Farm, r => r.Wrong);
    }

    public async Task LockPersonAsync(Guid personId, CancellationToken ct = default)
    {
        if (!db.Database.IsRelational())
        {
            return;
        }

        await scope.OpenAsync(ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT 1 FROM ssf.shram_persons WHERE id = {personId} FOR UPDATE", ct);
    }

    public async Task<CountedTry> CountTryAsync(ShramPhoneChallenge challenge, CancellationToken ct = default)
    {
        var entry = db.Entry(challenge);
        if (!db.Database.IsRelational())
        {
            // In-memory host only: the domain's own rule.
            if (challenge.ConsumedAtUtc is not null || challenge.Attempts >= ShramPhoneChallenge.MaxAttempts)
            {
                return new CountedTry(false, challenge.Attempts, challenge.ConsumedAtUtc is not null);
            }

            entry.Property(c => c.Attempts).CurrentValue = challenge.Attempts + 1;
            return new CountedTry(true, challenge.Attempts, false);
        }

        await scope.OpenAsync(ct);
        var id = challenge.Id;
        var counted = await db.Database
            .SqlQuery<int>($"""
                UPDATE ssf.shram_phone_challenges SET attempts = attempts + 1
                 WHERE id = {id} AND attempts < {ShramPhoneChallenge.MaxAttempts} AND consumed_at_utc IS NULL
                RETURNING attempts AS "Value"
                """)
            .ToListAsync(ct);
        if (counted.Count == 1)
        {
            // In line with the database, and NOT written again by the next save (the statement above is the count).
            entry.Property(c => c.Attempts).CurrentValue = counted[0];
            entry.Property(c => c.Attempts).OriginalValue = counted[0];
            return new CountedTry(true, counted[0], false);
        }

        var now = await db.ShramPhoneChallenges.AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => new { c.Attempts, Spent = c.ConsumedAtUtc != null })
            .FirstOrDefaultAsync(ct);
        return new CountedTry(false, now?.Attempts ?? ShramPhoneChallenge.MaxAttempts, now?.Spent ?? true);
    }

    public async Task<IReadOnlyList<Guid>> GetFarmsLinkedByCodeAsync(IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
    {
        if (personIds.Count == 0)
        {
            return [];
        }

        await scope.OpenAsync(ct);
        var ids = personIds.ToList();
        return await db.ShramPhoneChallenges.AsNoTracking()
            .Where(c => ids.Contains(c.PersonId) && c.Purpose == ChallengePurpose.Link && c.ConsumedAtUtc != null)
            .Select(c => c.RequestedByFarmId)
            .Distinct()
            .ToListAsync(ct);
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
        => await SaveChangesOrClashAsync(ct) == IdentitySaveClash.None;

    /// <summary>The per-number one-holder index (R3, the AddWorkerIdentity migration).</summary>
    internal const string VerifiedNumberIndex = "ux_shram_person_phones_verified_number";

    /// <summary>The per-person one-verified-number index (fix pass 2, N3: the AddOneVerifiedNumberPerPerson migration).</summary>
    internal const string VerifiedPerPersonIndex = "ux_shram_person_phones_one_verified_per_person";

    public async Task<IdentitySaveClash> SaveChangesOrClashAsync(CancellationToken ct = default)
    {
        if (!db.ChangeTracker.HasChanges())
        {
            return IdentitySaveClash.None;
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
            await ReleaseNumbersFirstAsync(ct);
            await db.SaveChangesAsync(ct);
        }
        catch (Exception ex) when (ex is DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } }
                                   || ex is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            if (transaction is not null && savepoint is not null)
            {
                await transaction.RollbackToSavepointAsync(savepoint, ct);
            }

            foreach (var entry in db.ChangeTracker.Entries().Where(e => e.State != EntityState.Unchanged).ToList())
            {
                entry.State = entry.State == EntityState.Added ? EntityState.Detached : EntityState.Unchanged;
            }

            var constraint = (ex as PostgresException ?? ex.InnerException as PostgresException)?.ConstraintName;
            return constraint switch
            {
                VerifiedPerPersonIndex => IdentitySaveClash.PersonAlreadyVerified,
                VerifiedNumberIndex => IdentitySaveClash.NumberAlreadyVerified,
                _ => IdentitySaveClash.Other,
            };
        }

        if (transaction is not null && savepoint is not null)
        {
            await transaction.ReleaseSavepointAsync(savepoint, ct);
        }

        return IdentitySaveClash.None;
    }

    /// <summary>
    /// Fix pass 2 (N3) — a number being RELEASED is written before anything else in the same save, so the one-verified-
    /// number-per-person index never sees the old and the new verified number together (the case-5 move releases one and
    /// verifies another in one unit of work; EF's own statement order would not know the index's filter). Same savepoint,
    /// so a refusal later in the save rolls the release back too.
    /// </summary>
    private async Task ReleaseNumbersFirstAsync(CancellationToken ct)
    {
        if (!db.Database.IsRelational())
        {
            return;
        }

        var releases = db.ChangeTracker.Entries<ShramPersonPhone>()
            .Where(e => e.State == EntityState.Modified
                && e.Property(p => p.ReleasedAtUtc).IsModified
                && e.Property(p => p.ReleasedAtUtc).OriginalValue is null
                && e.Entity.ReleasedAtUtc is not null)
            .ToList();
        foreach (var entry in releases)
        {
            var id = entry.Entity.Id;
            var releasedAt = entry.Entity.ReleasedAtUtc;
            await db.ShramPersonPhones.Where(p => p.Id == id && p.ReleasedAtUtc == null)
                .ExecuteUpdateAsync(s => s.SetProperty(p => p.ReleasedAtUtc, releasedAt), ct);
            entry.Property(p => p.ReleasedAtUtc).OriginalValue = releasedAt;
            entry.Property(p => p.ReleasedAtUtc).IsModified = false;
        }
    }

    public Task CloseAsync(CancellationToken ct = default) => scope.CloseAsync(ct);
}
