using Accounts.Application.Ports;
using Accounts.Domain.OwnerAccounts;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;

namespace Accounts.Infrastructure.Persistence.Repositories;

internal sealed class OwnerAccountRepository(AccountsDbContext dbContext) : IOwnerAccountRepository
{
    public async Task AddAsync(OwnerAccount account, CancellationToken ct = default)
        => await dbContext.OwnerAccounts.AddAsync(account, ct);

    public Task<OwnerAccount?> GetByIdAsync(OwnerAccountId id, CancellationToken ct = default)
        => dbContext.OwnerAccounts.FirstOrDefaultAsync(a => a.Id == id, ct)!;

    public Task<OwnerAccount?> GetByPrimaryOwnerUserIdAsync(UserId userId, CancellationToken ct = default)
        => dbContext.OwnerAccounts.FirstOrDefaultAsync(a => a.PrimaryOwnerUserId == userId, ct)!;

    public Task SaveChangesAsync(CancellationToken ct = default)
        => dbContext.SaveChangesAsync(ct);
}
