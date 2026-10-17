using System.Text.Encodings.Web;
using System.Text.Json;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;

namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the ONE-SHOT demo re-seed, run by a human
/// exactly like <c>--migrate-only</c>:
/// <code>
///   dotnet AgriSync.Bootstrapper.dll --reseed-purvesh-demo --dry-run   # rehearse: same work, rolled back
///   dotnet AgriSync.Bootstrapper.dll --reseed-purvesh-demo             # commit
/// </code>
/// </summary>
/// <remarks>
/// <para>It returns before <c>app.Run()</c>, so no hosted service starts and nothing is served.
/// It applies NO migration: if the database is behind this binary it refuses. It reads no new
/// environment variable — it uses the same connection strings as the API.</para>
/// <para><b>Exit codes:</b> 0 = done (or dry run done); 2 = refused by a safety precondition,
/// nothing written; 1 = failed and rolled back.</para>
/// </remarks>
public static class PurveshDemoReseedCommand
{
    public const string Flag = "--reseed-purvesh-demo";
    public const string DryRunFlag = "--dry-run";

    public const int ExitOk = 0;
    public const int ExitFailed = 1;
    public const int ExitRefused = 2;

    private const string BeginFence = "---BEGIN-PURVESH-DEMO-RESEED---";
    private const string EndFence = "---END-PURVESH-DEMO-RESEED---";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        // Terminal output only — never embedded in HTML.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    public static async Task<int> RunAsync(
        IServiceProvider services,
        IReadOnlyCollection<string> args,
        TextWriter output,
        DateTime utcNow,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(services);
        ArgumentNullException.ThrowIfNull(args);
        ArgumentNullException.ThrowIfNull(output);

        var dryRun = args.Contains(DryRunFlag, StringComparer.Ordinal);
        await output.WriteLineAsync(
            $"{Flag}: {(dryRun ? "DRY RUN — every change will be rolled back" : "COMMIT")}; "
            + "touches only the demo farm's seed rows. No migration, no hosted service.");

        await using var scope = services.CreateAsyncScope();
        var provider = scope.ServiceProvider;
        try
        {
            // The same posture the startup seeders take: the interceptor's per-command prelude
            // is switched off, and the seeder establishes the demo farm's tenancy itself with
            // RlsIdentityScope (admin elevation grants NO row visibility on its own).
            provider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

            // The schema must match this binary. A Development database is built by
            // EnsureCreated (Program.InitializeApplicationDataAsync), which writes no migration
            // history, so the check is only meaningful — and only run — outside Development.
            if (provider.GetService<IHostEnvironment>()?.IsDevelopment() == true)
            {
                await output.WriteLineAsync($"{Flag}: Development — migration-history check skipped.");
            }
            else
            {
                foreach (var (name, context) in new (string, DbContext)[]
                         {
                             ("UserDbContext", provider.GetRequiredService<UserDbContext>()),
                             ("ShramSafalDbContext", provider.GetRequiredService<ShramSafalDbContext>()),
                         })
                {
                    var pending = (await context.Database.GetPendingMigrationsAsync(cancellationToken)).ToArray();
                    if (pending.Length > 0)
                    {
                        throw new PurveshDemoReseedRefusedException(
                            $"{name} has {pending.Length} pending migration(s) ({string.Join(", ", pending)}). "
                            + "The re-seed never migrates; run the normal deployment first.");
                    }
                }
            }

            var seeder = provider.GetRequiredService<PurveshDemoSeeder>();
            var repository = provider.GetRequiredService<IShramSafalRepository>();
            var report = await seeder.ReseedDemoContentAsync(
                repository, new PurveshDemoReseedOptions(utcNow, dryRun), cancellationToken);

            await output.WriteLineAsync(BeginFence);
            await output.WriteLineAsync(JsonSerializer.Serialize(report, JsonOptions));
            await output.WriteLineAsync(EndFence);
            await output.WriteLineAsync(dryRun
                ? $"{Flag}: dry run complete — rolled back, the database is unchanged."
                : $"{Flag}: committed.");
            return ExitOk;
        }
        catch (PurveshDemoReseedRefusedException refused)
        {
            await output.WriteLineAsync($"{Flag}: REFUSED — {refused.Message}");
            return ExitRefused;
        }
        catch (Exception ex)
        {
            await output.WriteLineAsync(
                $"{Flag}: FAILED and rolled back — {ex.GetType().Name}: {ex.Message}");
            if (ex.InnerException is { } inner)
            {
                await output.WriteLineAsync($"  caused by {inner.GetType().Name}: {inner.Message}");
            }

            if (ex is DbUpdateException update)
            {
                foreach (var entry in update.Entries)
                {
                    await output.WriteLineAsync(
                        $"  while saving {entry.Metadata.ClrType.Name} ({entry.State})");
                }
            }

            return ExitFailed;
        }
    }
}
