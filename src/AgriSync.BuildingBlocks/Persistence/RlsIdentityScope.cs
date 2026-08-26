// spec: rls-identity-sweep-2026-08-10
using Microsoft.EntityFrameworkCore;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// The ONE sanctioned way to establish "who is asking" for a block of work that
/// touches a FORCE-RLS table from OUTSIDE the normal per-request pipeline.
///
/// <para>
/// <b>The bug class this exists to kill.</b> 33 tables (32 in <c>ssf</c> +
/// <c>public.memberships</c>) have <c>ROW LEVEL SECURITY</c> ENABLED <b>and
/// FORCED</b>. Their policies key on the Postgres session settings
/// <c>agrisync.farm_id</c> (tenant scope) and <c>agrisync.user_id</c> (the
/// <c>p_user_select_*</c> policies). The app connects as <c>agrisync_app</c>,
/// which owns nothing and has no <c>BYPASSRLS</c>, so a query issued without the
/// relevant setting does not error — it returns <b>zero rows</b>. Silently.
/// Every historical instance of this bug (<c>GET /shramsafal/farms/mine</c>
/// showing no farms, <c>/user/auth/me/context</c> answering <c>farms: []</c> for
/// a farmer who owns a farm, the login JWT losing its <c>membership</c> claim,
/// <c>ComplianceEvaluatorSweeper</c> logging "no active farms found" every
/// night) is the same mistake: a read ran before anyone said who was asking.
/// </para>
///
/// <para>
/// <b>When you need this.</b> Inside an HTTP request that
/// <see cref="TenantTransactionMiddleware"/> routes normally, identity is
/// already established for you — <see cref="ShramSafal"/>'s authorization
/// enforcer / <c>ICallerFarmTenantScope</c> set <see cref="TenantContext"/> and
/// <see cref="TenantConnectionInterceptor"/> prepends the GUCs to every command.
/// You need this helper when that pipeline is NOT in play:
/// <list type="bullet">
/// <item>a <c>BackgroundService</c> / hosted job (no HttpContext, no
/// middleware, no ambient transaction);</item>
/// <item>a route on <see cref="TenantTransactionMiddleware"/>'s admin skip-list
/// (admin elevation makes the interceptor a no-op — it sets NO GUC, so a
/// farm-scoped read there returns nothing);</item>
/// <item>a composition-root adapter that reads across app DbContexts.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Why not just <see cref="TenantContext.SetTenant"/>?</b> Because the
/// interceptor's per-command <c>SET LOCAL</c> prepend desyncs EF Core's
/// rows-affected accounting on WRITES (<c>DbUpdateConcurrencyException:
/// expected to affect 1 row(s), but actually affected 0 row(s)</c> — see
/// <c>reference_interceptor_setlocal_desyncs_ef_writes</c>). The prod-proven
/// technique, live since <c>FirstFarmBootstrapEndpoints</c> (f7fab197) and
/// <c>ShramSafalRepository.GetMyFarmsAsync</c>, is: admin-elevate so the
/// interceptor no-ops, then set the GUCs yourself with a PARAMETERISED
/// <c>set_config(..., is_local: true)</c> inside an explicit transaction.
/// This type is that technique, once, with the transaction handling correct.
/// </para>
///
/// <para>
/// <b>Transaction handling.</b> <c>set_config(name, value, is_local := true)</c>
/// is scoped to the CURRENT transaction — outside one it is a no-op and the
/// policies still see nothing. So each method joins the ambient transaction when
/// the caller already has one (the request pipeline) and otherwise opens and
/// commits its own (background jobs). Non-relational providers (the EF InMemory
/// provider used by unit/integration harnesses) have no RLS to satisfy and no
/// raw SQL — the work runs unchanged.
/// </para>
///
/// <para>
/// <b>This is the only place allowed to name an <c>agrisync.*</c> GUC in
/// application code.</b> <c>RlsIdentityScopeRules</c> in
/// <c>AgriSync.ArchitectureTests</c> fails the build if a new call site
/// hand-rolls <c>set_config('agrisync.…')</c> / <c>SET LOCAL agrisync.…</c>
/// somewhere else.
/// </para>
/// </summary>
public static class RlsIdentityScope
{
    /// <summary>
    /// Run <paramref name="work"/> with <c>agrisync.user_id</c> established, so
    /// the <c>p_user_select_*</c> policies (and <c>public.memberships</c>'
    /// <c>p_user_memberships</c>) surface the caller's OWN rows and nothing
    /// else. This is a USER-scoped, multi-farm, NON-admin identity: it grants
    /// no cross-tenant visibility, it only stops the read returning nothing.
    /// </summary>
    /// <param name="userId">
    /// The authenticated principal. MUST come from a validated JWT subject or a
    /// server-resolved user id — never a request header/body value, never
    /// <see cref="Guid.Empty"/> (ADR 0019 Caveat B). The entire isolation
    /// guarantee of user-scoped mode rests on this.
    /// </param>
    public static Task<T> RunAsUserAsync<T>(
        DbContext db,
        Guid userId,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(work);
        if (userId == Guid.Empty)
        {
            throw new ArgumentException(
                "RlsIdentityScope.RunAsUserAsync requires a non-empty userId — an empty GUC coerces to " +
                "NULL through the policies' NULLIF wrap and the read silently returns zero rows.",
                nameof(userId));
        }

        return RunAsync(
            db,
            settings: [("agrisync.user_id", userId)],
            work,
            ct);
    }

    /// <summary>
    /// Run <paramref name="work"/> with the single-farm tenant identity
    /// (<c>agrisync.farm_id</c> + <c>agrisync.owner_account_id</c>, plus
    /// <c>agrisync.user_id</c> when an actor is known) established, so both the
    /// <c>p_tenant_*</c> read policies AND their <c>WITH CHECK</c> write half
    /// pass for that one farm.
    ///
    /// <para>
    /// <b>Authorization is the caller's job.</b> This establishes scope; it does
    /// not decide whether the caller may have it. On a request path, prove
    /// membership first (<c>ICallerFarmTenantScope</c> is the gate that does
    /// this). On a cron path, the farm list must itself come from a genuinely
    /// privileged enumeration (<c>IAdminDbContextFactory</c>), not from an
    /// RLS-bound query that would silently return nothing.
    /// </para>
    /// </summary>
    public static Task<T> RunAsFarmAsync<T>(
        DbContext db,
        Guid farmId,
        Guid ownerAccountId,
        Guid? actorUserId,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(db);
        ArgumentNullException.ThrowIfNull(work);
        if (farmId == Guid.Empty)
        {
            throw new ArgumentException(
                "RlsIdentityScope.RunAsFarmAsync requires a non-empty farmId.", nameof(farmId));
        }
        if (ownerAccountId == Guid.Empty)
        {
            throw new ArgumentException(
                "RlsIdentityScope.RunAsFarmAsync requires a non-empty ownerAccountId — the " +
                "p_tenant_* policies on farm-scoped tables check it alongside farm_id.",
                nameof(ownerAccountId));
        }

        var settings = new List<(string Name, Guid Value)>(3)
        {
            ("agrisync.farm_id", farmId),
            ("agrisync.owner_account_id", ownerAccountId),
        };
        if (actorUserId is { } actor && actor != Guid.Empty)
        {
            settings.Add(("agrisync.user_id", actor));
        }

        return RunAsync(db, settings, work, ct);
    }

    /// <summary>Void-returning overload of <see cref="RunAsUserAsync{T}"/>.</summary>
    public static Task RunAsUserAsync(
        DbContext db,
        Guid userId,
        Func<CancellationToken, Task> work,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        return RunAsUserAsync<object?>(
            db, userId, async token => { await work(token); return null; }, ct);
    }

    /// <summary>Void-returning overload of <see cref="RunAsFarmAsync{T}"/>.</summary>
    public static Task RunAsFarmAsync(
        DbContext db,
        Guid farmId,
        Guid ownerAccountId,
        Guid? actorUserId,
        Func<CancellationToken, Task> work,
        CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(work);
        return RunAsFarmAsync<object?>(
            db, farmId, ownerAccountId, actorUserId,
            async token => { await work(token); return null; }, ct);
    }

    private static async Task<T> RunAsync<T>(
        DbContext db,
        IReadOnlyList<(string Name, Guid Value)> settings,
        Func<CancellationToken, Task<T>> work,
        CancellationToken ct)
    {
        // No relational provider ⇒ no RLS to satisfy and no raw SQL available
        // (EF InMemory harnesses). Run the work unchanged; every caller keeps
        // its own LINQ-level predicates, so behaviour is identical.
        if (!db.Database.IsRelational())
        {
            return await work(ct);
        }

        // Join the caller's transaction when there is one (the request pipeline
        // already opened one per writing context); otherwise own one, because
        // `set_config(..., is_local := true)` outside a transaction is a no-op
        // and the policies would still see nothing.
        if (db.Database.CurrentTransaction is not null)
        {
            await ApplyAsync(db, settings, ct);
            return await work(ct);
        }

        await using var tx = await db.Database.BeginTransactionAsync(ct);
        await ApplyAsync(db, settings, ct);
        var result = await work(ct);
        await tx.CommitAsync(ct);
        return result;
    }

    private static async Task ApplyAsync(
        DbContext db,
        IReadOnlyList<(string Name, Guid Value)> settings,
        CancellationToken ct)
    {
        foreach (var (name, value) in settings)
        {
            // PARAMETERISED (never interpolated into the SQL text) and issued as
            // its OWN command rather than prepended to the query, so the
            // set_config result row is consumed by ExecuteNonQuery and can never
            // be mistaken for the caller's result set. `switch` on the literal
            // name keeps the GUC vocabulary closed — a caller cannot smuggle an
            // arbitrary setting name through this helper.
            switch (name)
            {
                case "agrisync.farm_id":
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT set_config('agrisync.farm_id', {value.ToString()}, true)", ct);
                    break;
                case "agrisync.owner_account_id":
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT set_config('agrisync.owner_account_id', {value.ToString()}, true)", ct);
                    break;
                case "agrisync.user_id":
                    await db.Database.ExecuteSqlInterpolatedAsync(
                        $"SELECT set_config('agrisync.user_id', {value.ToString()}, true)", ct);
                    break;
                default:
                    throw new ArgumentOutOfRangeException(
                        nameof(settings), name, "Unknown tenant GUC.");
            }
        }
    }
}
