namespace AgriSync.Bootstrapper.Infrastructure;

/// <summary>
/// Configured allowlist with safe dev defaults (spec test-fixture-service-runtime-2026-06-06).
/// Bound from the "TestFixtures" config section. Production ships AllowRuntimeReset=false,
/// AllowRuntimeSeed=false, AllowedOwnerAccountIds=[] AND is additionally hard-blocked in code.
/// </summary>
public sealed class TestFixtureOptions
{
    public const string SectionName = "TestFixtures";

    /// <summary>Master switch for runtime seeding via TestFixtureService.</summary>
    public bool AllowRuntimeSeed { get; set; }

    /// <summary>Master switch for runtime (destructive) reset via TestFixtureService.</summary>
    public bool AllowRuntimeReset { get; set; }

    /// <summary>
    /// The ONLY owner-account ids whose data a reset may delete. Empty = delete nothing.
    /// Dev defaults (appsettings.Development.json): the deterministic seeder ids.
    /// </summary>
    public List<Guid> AllowedOwnerAccountIds { get; set; } = [];
}
