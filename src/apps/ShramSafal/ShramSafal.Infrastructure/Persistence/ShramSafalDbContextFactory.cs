// spec: data-principle-spine-2026-05-05/03.1
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;

namespace ShramSafal.Infrastructure.Persistence;

/// <summary>
/// Design-time factory for <see cref="ShramSafalDbContext"/> used by the
/// <c>dotnet ef</c> CLI tooling (e.g. <c>migrations add</c>,
/// <c>migrations script</c>, <c>database update</c> when invoked outside the
/// Bootstrapper). Resolves the privileged DDL connection string
/// (<c>ShramSafalDb_Migration</c>) from the Bootstrapper's appsettings
/// chain rather than hardcoding credentials.
/// </summary>
/// <remarks>
/// <para>
/// Implements Conflict-Resolver R1 verdict OQ-2 (decisions-log 2026-05-16):
/// migrations run under the <c>_Migration</c> connection string (locally
/// the <c>postgres</c> superuser; in RDS the IAM-assumed deploy role); the
/// runtime app continues to read <c>ShramSafalDb</c> (no caller change).
/// </para>
/// <para>
/// <b>Search order</b> for the connection string, first non-empty wins:
/// <list type="number">
/// <item><c>ShramSafalDb_Migration</c> — preferred. Privileged role.</item>
/// <item><c>ShramSafalDb</c> — legacy fallback so a developer who has only
/// the old key in their local config can still run <c>dotnet ef</c>.</item>
/// </list>
/// </para>
/// <para>
/// <b>Configuration sources walked</b> (later wins, matching the
/// Bootstrapper's order):
/// <list type="number">
/// <item><c>appsettings.json</c> — root config.</item>
/// <item><c>appsettings.&lt;ENVIRONMENT&gt;.json</c> — env-specific
/// overrides (<c>DOTNETCORE_ENVIRONMENT</c> /
/// <c>ASPNETCORE_ENVIRONMENT</c>, default <c>Development</c>).</item>
/// <item>Environment variables — used by CI to inject the connection
/// string without touching disk.</item>
/// </list>
/// </para>
/// <para>
/// Looks for the Bootstrapper appsettings on disk by walking up from the
/// Infrastructure project directory until it finds
/// <c>src/AgriSync.Bootstrapper/appsettings.json</c>. If not found, falls
/// back to env-vars only — appropriate for CI where the connection string
/// is injected directly via <c>ConnectionStrings__ShramSafalDb_Migration</c>.
/// </para>
/// </remarks>
public sealed class ShramSafalDbContextFactory : IDesignTimeDbContextFactory<ShramSafalDbContext>
{
    public ShramSafalDbContext CreateDbContext(string[] args)
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
            configuration.GetConnectionString("ShramSafalDb_Migration")
            ?? configuration.GetConnectionString("ShramSafalDb")
            ?? throw new InvalidOperationException(
                "Connection string 'ShramSafalDb_Migration' (or fallback 'ShramSafalDb') is required for design-time EF tooling. " +
                "Set it in src/AgriSync.Bootstrapper/appsettings.Development.json or export ConnectionStrings__ShramSafalDb_Migration.");

        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(connectionString)
            .Options;

        return new ShramSafalDbContext(options);
    }

    /// <summary>
    /// Walks up from the current working directory looking for the
    /// Bootstrapper appsettings. EF tooling typically launches with cwd at
    /// the Infrastructure project; the Bootstrapper sits three levels up
    /// (<c>src/apps/ShramSafal/ShramSafal.Infrastructure</c> →
    /// <c>src/AgriSync.Bootstrapper</c>). Returns <c>null</c> if not found
    /// after eight levels — at that point the factory falls back to
    /// env-vars only.
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
