using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Accounts.Infrastructure.Persistence;

/// <summary>
/// Design-time factory for <see cref="AccountsDbContext"/> used by the EF
/// CLI migration tooling. Reads the connection string from the
/// <c>ConnectionStrings__ShramSafalDb_Migration</c> environment variable
/// (same secrets/env pattern <c>Program.cs</c> supports at boot), falling
/// back to a non-secret placeholder so the factory never carries a real
/// credential in tracked source.
/// </summary>
public sealed class AccountsDbContextFactory : IDesignTimeDbContextFactory<AccountsDbContext>
{
    public AccountsDbContext CreateDbContext(string[] args)
    {
        var connectionString =
            Environment.GetEnvironmentVariable("ConnectionStrings__ShramSafalDb_Migration")
            ?? "Host=localhost;Port=5433;Database=agrisync_dev;Username=postgres;Password=SET_VIA_ENV_OR_secrets_local_credentials_json";

        var options = new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable(
                    "__accounts_migrations_history",
                    AccountsDbContext.SchemaName))
            .Options;

        return new AccountsDbContext(options);
    }
}
