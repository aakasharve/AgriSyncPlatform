// spec: data-principle-spine-2026-05-05/03.6
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.6 — default singleton
/// implementation of <see cref="ITenantScopedDbContextRegistry"/>.
/// Apps register concrete context types via
/// <see cref="Register{TContext}"/>; the registry stores the type list
/// and resolves per-scope instances at request time via the supplied
/// <see cref="IServiceProvider"/>.
///
/// <para>
/// <b>Lifetime:</b> Singleton. The registry itself is type metadata;
/// the actual <see cref="DbContext"/> instances are still resolved
/// per-scope by <see cref="GetWritingContexts"/>.
/// </para>
///
/// <para>
/// <b>Why not just inspect the DI container.</b> The container has
/// many <see cref="DbContext"/> registrations (read-only contexts,
/// analytics context) that we explicitly do NOT want to wrap in a
/// transaction for every request. Explicit registration through this
/// registry makes the writing-context list auditable and prevents an
/// accidentally-added analytics DbContext from sneaking a tx into
/// every <c>/metrics</c> scrape.
/// </para>
/// </summary>
public sealed class TenantScopedDbContextRegistry : ITenantScopedDbContextRegistry
{
    private readonly List<Type> _contextTypes = new();

    public TenantScopedDbContextRegistry Register<TContext>() where TContext : DbContext
    {
        if (!_contextTypes.Contains(typeof(TContext)))
        {
            _contextTypes.Add(typeof(TContext));
        }
        return this;
    }

    public IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices)
    {
        if (_contextTypes.Count == 0)
        {
            return Array.Empty<DbContext>();
        }

        var resolved = new List<DbContext>(_contextTypes.Count);
        foreach (var t in _contextTypes)
        {
            // GetRequiredService<T>() throws if a registered context
            // cannot be resolved — that is intentional: a misregistered
            // type is a config bug we want to surface immediately
            // rather than silently drop the tx for that context.
            var instance = (DbContext)scopedServices.GetRequiredService(t);
            resolved.Add(instance);
        }
        return resolved;
    }
}
