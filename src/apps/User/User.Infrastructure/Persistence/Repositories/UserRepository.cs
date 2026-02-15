using Microsoft.EntityFrameworkCore;
using AgriSync.SharedKernel.Contracts.Ids;
using User.Application.Ports;
using User.Domain.Identity;

namespace User.Infrastructure.Persistence.Repositories;

internal sealed class UserRepository(UserDbContext db) : IUserRepository
{
    public async Task<Domain.Identity.User?> GetByIdAsync(Guid id, CancellationToken ct = default)
    {
        var userId = new UserId(id);
        return await db.Users.FirstOrDefaultAsync(u => u.Id == userId, ct);
    }

    public async Task<Domain.Identity.User?> GetByPhoneAsync(string phone, CancellationToken ct = default)
    {
        return await db.Users.FirstOrDefaultAsync(u => u.Phone.Value == phone, ct);
    }

    public async Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default)
    {
        return await db.Users.AnyAsync(u => u.Phone.Value == phone, ct);
    }

    public async Task AddAsync(Domain.Identity.User user, CancellationToken ct = default)
    {
        await db.Users.AddAsync(user, ct);
    }

    public async Task SaveChangesAsync(CancellationToken ct = default)
    {
        await db.SaveChangesAsync(ct);
    }
}
