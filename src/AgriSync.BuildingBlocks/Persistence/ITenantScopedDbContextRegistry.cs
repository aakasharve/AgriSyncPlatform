// spec: data-principle-spine-2026-05-05/03.6
using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.6 — registry of every
/// tenant-scoped <see cref="DbContext"/> that
/// <see cref="TenantTransactionMiddleware"/> must open a transaction
/// on. Lives in <c>BuildingBlocks/Persistence</c> because the
/// middleware also lives here and can therefore not name concrete app
/// context types directly (BuildingBlocks may use SharedKernel only).
///
/// <para>
/// <b>Usage.</b> Each app composition root
/// (<c>AddShramSafalInfrastructure</c>, <c>AddUserInfrastructure</c>)
/// registers its concrete context with the singleton registry
/// (<see cref="TenantScopedDbContextRegistry"/>); the middleware then
/// asks <see cref="GetWritingContexts"/> for the per-request scope's
/// instances at request time.
/// </para>
/// </summary>
public interface ITenantScopedDbContextRegistry
{
    /// <summary>
    /// Returns the per-scope <see cref="DbContext"/> instance for every
    /// registered tenant-scoped context type. Order matches
    /// registration order; the middleware opens transactions in this
    /// order and rolls back in reverse.
    /// </summary>
    IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices);
}
