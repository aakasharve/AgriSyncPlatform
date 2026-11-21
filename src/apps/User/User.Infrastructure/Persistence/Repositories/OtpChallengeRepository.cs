using Microsoft.EntityFrameworkCore;
using User.Application.Ports;
using User.Domain.Security;

namespace User.Infrastructure.Persistence.Repositories;

internal sealed class OtpChallengeRepository(UserDbContext db) : IOtpChallengeRepository
{
    public Task AddAsync(OtpChallenge challenge, CancellationToken ct = default)
    {
        return db.OtpChallenges.AddAsync(challenge, ct).AsTask();
    }

    public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, OtpPurpose purpose, CancellationToken ct = default)
    {
        return db.OtpChallenges
            .Where(x => x.PhoneNumberNormalized == phoneNumberNormalized
                && x.Purpose == purpose
                && x.Status == OtpChallengeStatus.Pending)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
    }

    public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, OtpPurpose purpose, DateTime sinceUtc, CancellationToken ct = default)
    {
        return db.OtpChallenges
            .CountAsync(x => x.PhoneNumberNormalized == phoneNumberNormalized
                && x.Purpose == purpose
                && x.CreatedAtUtc >= sinceUtc, ct);
    }

    public async Task<bool> TryCountAttemptAsync(OtpChallenge challenge, DateTime utcNow, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(challenge);
        var id = challenge.Id;

        // S-A2: one UPDATE ... WHERE attempt_count < max_attempts. Under READ COMMITTED a parallel UPDATE of the same row
        // waits for this one and then re-checks the WHERE on the new row, so no more than max_attempts guesses are ever
        // counted, whatever the burst.
        var counted = await db.OtpChallenges
            .Where(x => x.Id == id
                && x.Status == OtpChallengeStatus.Pending
                && x.AttemptCount < x.MaxAttempts
                && x.ExpiresAtUtc > utcNow)
            .ExecuteUpdateAsync(s => s.SetProperty(x => x.AttemptCount, x => x.AttemptCount + 1), ct);

        // The update bypassed the change tracker: re-read the row so the count and status the handler decides on are the
        // stored ones (and the count itself is never written back from memory).
        await db.Entry(challenge).ReloadAsync(ct);
        return counted == 1;
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
