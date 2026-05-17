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

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 05 sub-phase 05.6 — sentinel for the
    /// cross-border transfer logger. Every successful Gemini call writes
    /// one <c>CrossBorderTransfer</c> row via
    /// <see cref="AgriSync.BuildingBlocks.Persistence.IAdminDbContextFactory{TContext}"/>
    /// (admin scope, no tenant claim). The factory rejects
    /// <see cref="System.Guid.Empty"/>; using a deterministic sibling to
    /// <see cref="Worker"/> keeps the audit ledger queryable
    /// (<c>WHERE actor_user_id = '…fffe'</c> returns every cross-border
    /// logger opening). The penultimate-byte difference vs Worker
    /// (<c>0xfe</c> vs <c>0xff</c>) preserves the same out-of-RFC-4122-v4
    /// reservation argument: byte-8 stays at <c>0xff</c> (variant=10
    /// requires byte-8 ∈ [0x80, 0xbf]).
    /// </summary>
    public static readonly System.Guid CrossBorderLoggerUserId =
        new("ffffffff-ffff-ffff-ffff-fffffffffffe");

    /// <summary>
    /// DATA_PRINCIPLE_SPINE Phase 08 sub-phase 08.0 — sentinel for rows
    /// whose original operator/creator/actor user has been anonymized by
    /// the DPDP §12 ErasureWorker (DS-017 rule (a)). After the worker
    /// processes an <c>ErasureRequest</c> the original user-id columns
    /// (e.g. <c>operator_user_id</c>, <c>created_by_user_id</c>,
    /// <c>actor_user_id</c>) on the surviving farm/compliance/accounting
    /// rows are overwritten with this Guid. The rows then carry their
    /// audit/financial weight WITHOUT identifying the principal —
    /// satisfying §12 (erasure of personal data) while preserving the
    /// non-personal fields the platform needs (DS-017 rule (c) keep
    /// fields). The penultimate-byte differs from <see cref="Worker"/>
    /// (<c>0xfd</c> vs <c>0xff</c>) and <see cref="CrossBorderLoggerUserId"/>
    /// (<c>0xfd</c> vs <c>0xfe</c>), giving a deterministic sibling that
    /// is queryable (<c>WHERE actor_user_id = '…fffd'</c> returns every
    /// row touched by an erasure across the lifetime of the database).
    /// Byte-8 stays at <c>0xff</c> so the reservation argument from
    /// <see cref="Worker"/> still holds: an RFC 4122 v4 UserId cannot
    /// collide with this constant.
    /// </summary>
    public static readonly System.Guid ErasedFarmer =
        new("ffffffff-ffff-ffff-ffff-fffffffffffd");
}
