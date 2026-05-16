// spec: data-principle-spine-2026-05-05/04.7
namespace AgriSync.BuildingBlocks.Auditing;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 04 sub-phase 04.7 — well-known sentinel
/// principals for code paths that run outside an HTTP request and must
/// stamp an <c>actorUserId</c> on an
/// <see cref="AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory{TContext}.CreateAsync"/>
/// call (the factory rejects <see cref="System.Guid.Empty"/>).
///
/// <para>
/// <b>Why a constant and not <see cref="System.Guid.NewGuid"/>.</b> The
/// audit ledger's value proposition is that the actor column is
/// queryable: <c>WHERE actor_user_id = '…ffff'</c> returns every
/// background-worker opening across the lifetime of the database. A
/// fresh Guid per call would scatter those rows across the index and
/// defeat that query. The all-ones GUID
/// <c>ffffffff-ffff-ffff-ffff-ffffffffffff</c> mirrors the sentinel
/// already in use by <c>MarkOverdueInstancesHandler.SystemActorUserId</c>
/// (CEI §4.5) so cross-context queries against
/// <c>ssf.audit_events.actor_user_id</c> produce one consistent worker
/// identity. The value is reserved — RFC 4122 v4 UserIds can never
/// collide with it because bit-7 of byte-8 is constrained to <c>10</c>
/// (so a v4 always has byte-8 in the range <c>[0x80, 0xbf]</c>; the
/// all-ones byte <c>0xff</c> is outside that range).
/// </para>
///
/// <para>
/// <b>Lifetime.</b> Pure compile-time constant — exposed as a static
/// readonly field so reflection-based serializers (audit payload
/// JSON) treat it as a value, not a property invocation.
/// </para>
/// </summary>
public static class SystemActor
{
    /// <summary>
    /// All-ones sentinel for background workers: nightly sweepers,
    /// retention jobs, startup backfills — anything invoked outside
    /// an HTTP request that needs to call
    /// <see cref="AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory{TContext}.CreateAsync"/>.
    /// The <c>reason</c> argument on each <c>CreateAsync</c> call is
    /// the per-site discriminator; the actor is the same sentinel for
    /// every worker so the ledger can list all worker openings with a
    /// single equality filter.
    /// </summary>
    public static readonly System.Guid Worker =
        new("ffffffff-ffff-ffff-ffff-ffffffffffff");
}
