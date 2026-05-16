// spec: data-principle-spine-2026-05-05/03.6
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.6 — convenience helpers
/// for composing the
/// <see cref="ITenantScopedDbContextRegistry"/> from multiple app
/// composition roots without each one having to reinvent the lookup
/// dance.
/// </summary>
public static class TenantScopedDbContextRegistryExtensions
{
    /// <summary>
    /// Look up the singleton <see cref="TenantScopedDbContextRegistry"/>
    /// already registered in <paramref name="services"/>. If none is
    /// registered, register a fresh instance as a singleton and return
    /// it. Idempotent: repeated calls return the same instance.
    /// </summary>
    /// <remarks>
    /// Walks the descriptor list directly (rather than building a
    /// provider) because we need the concrete instance back so the
    /// caller can <c>.Register&lt;TContext&gt;()</c> against it before
    /// the provider is built. The DI container would otherwise erase
    /// the instance under the <see cref="ITenantScopedDbContextRegistry"/>
    /// abstraction.
    /// </remarks>
    public static TenantScopedDbContextRegistry EnsureTenantScopedRegistry(
        this IServiceCollection services)
    {
        var existing = services.LastOrDefault(sd =>
            sd.ServiceType == typeof(ITenantScopedDbContextRegistry));
        if (existing?.ImplementationInstance is TenantScopedDbContextRegistry instance)
        {
            return instance;
        }

        var fresh = new TenantScopedDbContextRegistry();
        // TryAdd because a previous call may have added under a
        // different overload — but we already checked existing above,
        // so the Add is safe.
        services.AddSingleton<ITenantScopedDbContextRegistry>(fresh);
        return fresh;
    }
}
