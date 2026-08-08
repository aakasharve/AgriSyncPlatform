using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace Accounts.Infrastructure.Persistence;

/// <summary>
/// Design-time factory for <see cref="AccountsDbContext"/> used by the
/// <c>dotnet ef</c> CLI migration tooling. Resolves the connection string from
/// the Bootstrapper's appsettings chain rather than hardcoding credentials.
/// </summary>
/// <remarks>
/// <para>
/// This factory previously hardcoded a database name and a superuser password
/// inline. That made it the last of the three design-time factories still
/// carrying a credential in tracked source, and it pinned <c>dotnet ef</c> to
/// one database regardless of configuration — which is why EF tooling appeared
/// "broken on this machine": it was aimed at a stale database with a desynced
/// migration history, not actually broken. Converted to match the
/// <c>UserDbContextFactory</c> / <c>ShramSafalDbContextFactory</c> pattern.
/// </para>
/// <para>
/// <b>Search order</b> for the connection string, first non-empty wins:
/// <list type="number">
/// <item><c>AccountsDb_Migration</c> — preferred. Privileged DDL role.</item>
/// <item><c>UserDb_Migration</c> — single-DB development: all apps share one
/// PostgreSQL instance under different schemas.</item>
/// <item><c>AccountsDb</c> then <c>UserDb</c> — runtime-role fallbacks, matching
/// <c>AddAccountsInfrastructure</c>'s own order, so a developer with only the
/// legacy keys configured can still run <c>dotnet ef</c>.</item>
/// </list>
/// </para>
/// <para>
/// <b>Configuration sources walked</b> (later wins, matching the Bootstrapper):
/// <c>appsettings.json</c>, <c>appsettings.&lt;ENVIRONMENT&gt;.json</c>, then
/// environment variables — the last of which is how CI and a rotated local
/// machine inject the connection string without touching disk.
/// </para>
/// </remarks>
public sealed class AccountsDbContextFactory : IDesignTimeDbContextFactory<AccountsDbContext>
{
    public AccountsDbContext CreateDbContext(string[] args)
    {
        var environment =
            Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT")
            ?? Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT")
            ?? "Development";

        var bootstrapperDir = FindBootstrapperDirectory();

        var builder = new ConfigurationBuilder();

        if (bootstrapperDir is not null)
        {
            builder.SetBasePath(bootstrapperDir);
            builder.AddJsonFile("appsettings.json", optional: true, reloadOnChange: false);
            builder.AddJsonFile($"appsettings.{environment}.json", optional: true, reloadOnChange: false);
        }

        builder.AddEnvironmentVariables();

        var configuration = builder.Build();

        var connectionString =
            configuration.GetConnectionString("AccountsDb_Migration")
            ?? configuration.GetConnectionString("UserDb_Migration")
            ?? configuration.GetConnectionString("AccountsDb")
            ?? configuration.GetConnectionString("UserDb")
            ?? throw new InvalidOperationException(
                "Connection string 'AccountsDb_Migration' (or fallback 'UserDb_Migration'/'AccountsDb'/'UserDb') is required for design-time EF tooling. " +
                "Set it in src/AgriSync.Bootstrapper/appsettings.Development.json or export ConnectionStrings__UserDb_Migration.");

        var options = new DbContextOptionsBuilder<AccountsDbContext>()
            .UseNpgsql(
                connectionString,
                npgsql => npgsql.MigrationsHistoryTable(
                    "__accounts_migrations_history",
                    AccountsDbContext.SchemaName))
            .Options;

        return new AccountsDbContext(options);
    }

    /// <summary>
    /// Walks up from the current working directory looking for the Bootstrapper
    /// appsettings. EF tooling typically launches with cwd at the Infrastructure
    /// project. Returns <c>null</c> if not found after eight levels — at that
    /// point the factory falls back to env-vars only, which is the correct
    /// behaviour for CI.
    /// </summary>
    private static string? FindBootstrapperDirectory()
    {
        var current = new DirectoryInfo(Directory.GetCurrentDirectory());
        for (var i = 0; i < 8 && current is not null; i++)
        {
            var candidate = Path.Combine(current.FullName, "src", "AgriSync.Bootstrapper", "appsettings.json");
            if (File.Exists(candidate))
            {
                return Path.GetDirectoryName(candidate);
            }

            // Also accept the case where cwd is already inside the Bootstrapper.
            var direct = Path.Combine(current.FullName, "AgriSync.Bootstrapper", "appsettings.json");
            if (File.Exists(direct))
            {
                return Path.GetDirectoryName(direct);
            }

            current = current.Parent;
        }

        return null;
    }
}
