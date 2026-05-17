// spec: data-principle-spine-2026-05-05/05.4
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace AgriSync.BuildingBlocks.Security;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.4 — startup guard that
/// enforces the single-region invariant: every AWS resource the API
/// touches MUST live in <c>ap-south-1</c> (Mumbai) so DPDP residency is
/// provable end-to-end.
///
/// <para>
/// <b>Behaviour per OQ-3 verdict</b> (conflict-resolver 2026-05-17):
/// <list type="bullet">
/// <item><c>AWS:Region</c> unset / empty → log a <c>Warning</c> and
/// return. Production MUST set the key; dev/CI does not need to. Phase
/// 04 burned twice on fail-fast against env-absent config (commits
/// <c>e2bbeed</c> + <c>629bc56</c>) — repeating that mistake here would
/// be a regression.</item>
/// <item><c>AWS:Region</c> set to anything other than
/// <c>ap-south-1</c> → <see cref="InvalidOperationException"/>. The
/// guard fails the boot so a misconfigured deploy cannot accidentally
/// write tenant data into the wrong AWS region.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Architecture test partner.</b>
/// <see cref="AgriSync.ArchitectureTests"/> <c>RegionPinningRules</c>
/// parses <c>src/AgriSync.Bootstrapper/appsettings.json</c> and asserts
/// that every key whose name contains <c>"egion"</c> (case-insensitive)
/// has the value <c>ap-south-1</c> (or is null/empty per the same
/// warn-on-missing policy). The architecture test catches accidental
/// commits of a non-Mumbai region default; the runtime guard catches
/// deploy-time overrides via environment variables / Secrets Manager.
/// </para>
///
/// <para>
/// <b>Call site.</b> <c>Program.cs</c> invokes
/// <see cref="AssertApSouth1(IConfiguration, ILogger)"/> AFTER
/// <c>var app = builder.Build();</c> so the
/// <see cref="ILogger{TCategoryName}"/> for <see cref="RegionGuard"/>
/// is resolvable from the host's <see cref="System.IServiceProvider"/>.
/// Calling earlier would force us to wire up a bootstrap logger by
/// hand; doing it post-build hooks into Serilog automatically.
/// </para>
/// </summary>
public static class RegionGuard
{
    /// <summary>
    /// The only AWS region AgriSync provisions resources in. DPDP-residency
    /// invariant — see plan §05.4 + ADR-DS-004.
    /// </summary>
    public const string RequiredRegion = "ap-south-1";

    /// <summary>
    /// Validate the configured AWS region against the
    /// <see cref="RequiredRegion"/> invariant. Warn-on-missing,
    /// throw-on-mismatch per OQ-3 verdict.
    /// </summary>
    /// <param name="cfg">
    /// Host configuration; reads <c>AWS:Region</c>.
    /// </param>
    /// <param name="logger">
    /// Logger used to surface the warn-on-missing path. Required —
    /// callers MUST resolve <c>ILogger&lt;RegionGuard&gt;</c> from the
    /// built host's service provider.
    /// </param>
    /// <exception cref="InvalidOperationException">
    /// Thrown when <c>AWS:Region</c> is set to anything other than
    /// <see cref="RequiredRegion"/>.
    /// </exception>
    public static void AssertApSouth1(IConfiguration cfg, ILogger logger)
    {
        ArgumentNullException.ThrowIfNull(cfg);
        ArgumentNullException.ThrowIfNull(logger);

        var region = cfg["AWS:Region"];
        if (string.IsNullOrWhiteSpace(region))
        {
            logger.LogWarning(
                "AWS:Region not set — region pinning skipped. Production MUST set ap-south-1.");
            return;
        }

        if (region != RequiredRegion)
        {
            throw new InvalidOperationException(
                $"AWS:Region must be {RequiredRegion}, got '{region}'. Cross-border denied.");
        }
    }
}
