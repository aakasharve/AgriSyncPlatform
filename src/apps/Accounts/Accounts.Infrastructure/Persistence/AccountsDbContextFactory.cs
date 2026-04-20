using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Accounts.Infrastructure.Persistence;

/// <summary>
/// Design-time factory for <see cref="AccountsDbContext"/> used by the EF
/// CLI migration tooling. Uses the same dev defaults as appsettings.Development.json.
/// </summary>
public sealed class AccountsDbContextFactory : IDesignTimeDbContextFactory<AccountsDbContext>
{
    public AccountsDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(
                "Host=localhost;Port=5433;Database=agrisync_dev;Username=postgres;Password=akash123",
                npgsql => npgsql.MigrationsHistoryTable(
                    "__accounts_migrations_history",
                    AccountsDbContext.SchemaName))
            .Options;

        return new AccountsDbContext(options);
    }
}
