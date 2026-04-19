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

    public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, CancellationToken ct = default)
    {
        return db.OtpChallenges
            .Where(x => x.PhoneNumberNormalized == phoneNumberNormalized
                && x.Status == OtpChallengeStatus.Pending)
            .OrderByDescending(x => x.CreatedAtUtc)
            .FirstOrDefaultAsync(ct);
    }

    public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, DateTime sinceUtc, CancellationToken ct = default)
    {
        return db.OtpChallenges
            .CountAsync(x => x.PhoneNumberNormalized == phoneNumberNormalized
                && x.CreatedAtUtc >= sinceUtc, ct);
    }

    public Task SaveChangesAsync(CancellationToken ct = default) => db.SaveChangesAsync(ct);
}
