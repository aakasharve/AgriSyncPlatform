using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AgriSync.Bootstrapper.Infrastructure;

public sealed class TestFixturesDisabledException(string message) : System.Exception(message);

public sealed record FixtureResult(string Fixture, string Action, string Summary);

/// <summary>
/// Runtime reset/seed of known test fixtures. Hard-blocks ALL destructive paths in
/// Production (before any DB access). Reset is bounded by the configured owner-account
/// allowlist. Spec: test-fixture-service-runtime-2026-06-06.
/// </summary>
public sealed class TestFixtureService(
    IHostEnvironment env,
    IOptions<TestFixtureOptions> options,
    IServiceProvider services,
    ILogger<TestFixtureService> logger)
{
    private static readonly string[] KnownFixtures =
        ["blank-test-user", "purvesh-demo", "ramu-demo", "admin-two-orgs"];

    private readonly TestFixtureOptions _opts = options.Value;

    public IReadOnlyList<string> ListFixtures() => KnownFixtures;

    private void GuardDestructive(string action)
    {
        if (action is not ("reset" or "seed"))
            throw new System.ArgumentOutOfRangeException(nameof(action), action, "Unknown destructive action.");
        if (env.IsProduction())
        {
            throw new TestFixturesDisabledException(
                $"Test fixture {action} is permanently disabled in Production. No override exists by design.");
        }
        var allowed = action == "reset" ? _opts.AllowRuntimeReset : _opts.AllowRuntimeSeed;
        if (!allowed)
        {
            throw new TestFixturesDisabledException(
                $"Test fixture {action} is not enabled (TestFixtures:AllowRuntime{(action == "reset" ? "Reset" : "Seed")}=false).");
        }
    }

    public Task<FixtureResult> ResetFixtureAsync(string fixture, CancellationToken ct = default)
    {
        GuardDestructive("reset");
        return ResetInternalAsync(Normalize(fixture), ct);
    }

    public Task<FixtureResult> SeedFixtureAsync(string fixture, CancellationToken ct = default)
    {
        GuardDestructive("seed");
        return SeedInternalAsync(Normalize(fixture), ct);
    }

    // Intentional double-guard: reset+seed requires BOTH AllowRuntimeReset AND AllowRuntimeSeed.
    public async Task<FixtureResult> ResetAndSeedFixtureAsync(string fixture, CancellationToken ct = default)
    {
        await ResetFixtureAsync(fixture, ct);
        return await SeedFixtureAsync(fixture, ct);
    }

    private static string Normalize(string f) => (f ?? "").Trim().ToLowerInvariant();

    // Reset/Seed bodies are filled in Tasks 3 + 4.
    private Task<FixtureResult> ResetInternalAsync(string fixture, CancellationToken ct) =>
        throw new System.NotImplementedException();
    private Task<FixtureResult> SeedInternalAsync(string fixture, CancellationToken ct) =>
        throw new System.NotImplementedException();
}
