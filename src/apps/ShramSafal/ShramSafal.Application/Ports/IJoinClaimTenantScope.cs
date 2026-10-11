namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves - the tenant scope for the ONE flow whose caller is,
/// by definition, not yet a member of the farm they are joining (<c>POST /join/claim</c>,
/// the worker half of the QR invite).
///
/// <para>
/// <see cref="ICallerFarmTenantScope"/> cannot serve it: it validates MEMBERSHIP of a farm id,
/// and the claimant has none. The authorization artifact here is the join TOKEN, so the scope
/// is staged around it, and each stage widens visibility by exactly what the previous stage
/// proved - never more:
/// <list type="number">
/// <item><see cref="BeginTokenLookup"/> - admin-elevates ONLY to silence
/// <c>TenantConnectionInterceptor</c> (elevation sets no GUC and grants no visibility). The
/// single read that follows, <c>ssf.farm_join_tokens</c> keyed on the SHA-256 of the
/// presented token, is on a table with no RLS; it can reveal nothing but the row the
/// presented token hashes to.</item>
/// <item><see cref="PublishTokenFarmScopeAsync"/> - called ONLY once that row exists and is
/// not revoked, with the farm id TAKEN FROM THAT ROW (never from the request). It publishes
/// <c>agrisync.farm_id</c> (+ the validated JWT subject as <c>agrisync.user_id</c>) as
/// transaction-local GUCs, so the farm read and the <c>farm_memberships</c> /
/// <c>audit_events</c> INSERT pass FORCE-RLS for THAT farm and no other.</item>
/// </list>
/// A bad / unknown / revoked token never reaches stage 2: no farm GUC is ever set for it.
/// </para>
/// </summary>
public interface IJoinClaimTenantScope
{
    /// <summary>
    /// Stage 1. Must run before the first DbCommand of the claim. Publishes no tenant claim.
    /// </summary>
    void BeginTokenLookup();

    /// <summary>
    /// Stage 2. <paramref name="tokenFarmId"/> MUST be the <c>FarmId</c> of a join-token row
    /// that was just looked up by hash and found un-revoked. <paramref name="claimantUserId"/>
    /// is the caller's validated JWT subject.
    /// </summary>
    Task PublishTokenFarmScopeAsync(Guid tokenFarmId, Guid claimantUserId, CancellationToken ct = default);
}
