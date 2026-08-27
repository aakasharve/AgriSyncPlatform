namespace ShramSafal.Application.Ports;

/// <summary>
/// spec: dfes-companion-2026-07-11 · spec: 2026-08-25-prod-cutover-waves — runs a
/// block of work under a user-scoped (NOT farm-scoped) tenant claim, for tables whose
/// RLS is keyed ENTIRELY on <c>agrisync.user_id</c> (no <c>farm_id</c> column, no
/// farm-scoped predicate at all). <c>ssf.correction_events</c> is the consumer: policy
/// <c>p_user_correction_events</c> (<c>20260517010000_AddDeferredAuditRls</c>) reads
/// <c>USING/WITH CHECK (user_id = NULLIF(current_setting('agrisync.user_id', true), '')::uuid)</c>.
///
/// <para>
/// <b>Why not <see cref="ICallerFarmTenantScope"/>.</b> That port validates the
/// caller's MEMBERSHIP of a caller-suppliable <c>farmId</c> before trusting it —
/// there is no analogous "foreign id" here: the scope this port establishes is
/// always the caller's OWN validated JWT subject, never a value the caller
/// supplies, so there is nothing to authorize a membership check against. A
/// farm-shaped port would have no farmId to resolve from the request or the
/// entity (<c>CorrectionEvent</c> carries no farm dimension at all).
/// </para>
///
/// <para>
/// <b>Why not <c>TenantContext.SetUserScoped</c> + the interceptor's automatic
/// prepend</b> (the mechanism <c>GET /sync/pull</c> and
/// <c>POST /shramsafal/consent-gate/link</c> use). That path is READ-safe only.
/// <see cref="AgriSync.BuildingBlocks.Persistence.TenantConnectionInterceptor"/>
/// prepends <c>SET LOCAL agrisync.user_id = '...'; </c> onto the SAME
/// <see cref="System.Data.Common.DbCommand.CommandText"/> as the actual command. For a
/// SELECT that is harmless; for an EF <c>SaveChangesAsync</c> INSERT the extra
/// statement desyncs <c>NpgsqlModificationCommandBatch.Consume</c>'s rows-affected
/// accounting and the write dies with
/// <c>DbUpdateConcurrencyException: expected to affect 1 row(s), but actually affected
/// 0 row(s)</c>.
/// </para>
///
/// <para>
/// <b>That is not folklore — it was re-measured on 2026-08-27</b> against real
/// Postgres :5433 by routing <c>POST /shramsafal/corrections</c> through the
/// middleware's user-scoped branch and running
/// <c>CorrectionsEndpointTenancyTests.Authenticated_caller_can_record_a_correction…</c>.
/// The request 500'd at <c>CorrectionEventRepository.AddAsync</c> with exactly that
/// exception. The middleware route was reverted; this port is the write-safe path.
/// </para>
///
/// <para>
/// <b>What it does instead.</b> Admin-elevate — which makes the interceptor a no-op, so
/// the INSERT's command text is never touched — and then establish
/// <c>agrisync.user_id</c> through
/// <c>AgriSync.BuildingBlocks.Persistence.RlsIdentityScope.RunAsUserAsync</c>, which
/// issues it as a SEPARATE parameterised <c>set_config(..., is_local := true)</c>
/// command and owns the transaction decision. Elevation alone would be the WRONG fix on
/// its own: it emits no GUC, so a row naming a user meets a <c>WITH CHECK</c> of
/// <c>user_id = NULL</c> and Postgres refuses it with <c>42501</c> (an earlier attempt
/// at this fix hit exactly that). Elevation here silences the interceptor; the identity
/// comes from the GUC that follows it.
/// </para>
///
/// <para>
/// <b>Why a wrapper and not a prelude.</b> It used to be
/// <c>EstablishForCallerAsync(userId)</c> — set the GUC, return, let the caller carry
/// on — and it hand-wrote the <c>set_config</c> itself. That is a private copy of the
/// tenant-GUC technique, which <c>AgriSync.ArchitectureTests.RlsIdentityScopeRules</c>
/// fails the build over: every private copy is one more place that can forget the
/// transaction or drift from the others. <c>RlsIdentityScope</c> is a wrapper because
/// the transaction is part of the guarantee (an <c>is_local</c> setting outside a
/// transaction is a no-op), so this port is a wrapper too.
/// </para>
/// </summary>
public interface ICallerUserTenantScope
{
    /// <summary>
    /// Run <paramref name="work"/> with the user-scoped tenant GUC
    /// (<c>agrisync.user_id</c>) established for <paramref name="userId"/> — the
    /// CALLER'S OWN validated JWT subject, never a caller-supplied value (ADR 0019
    /// Caveat B); the entire isolation guarantee rests on that.
    /// </summary>
    /// <exception cref="System.ArgumentException">
    /// <paramref name="userId"/> is <see cref="System.Guid.Empty"/>. Empty is not an
    /// identity: it coerces to NULL through the policy's NULLIF wrap, so the work would
    /// read zero rows and its writes would be refused — but only after running. Callers
    /// must reject an empty subject as unauthenticated BEFORE reaching here; this throw
    /// is the backstop, not the gate.
    /// </exception>
    Task<T> RunForCallerAsync<T>(
        Guid userId,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct = default);
}
