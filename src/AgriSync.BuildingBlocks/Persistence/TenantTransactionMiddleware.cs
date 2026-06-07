// spec: data-principle-spine-2026-05-05/03.2
// spec: data-principle-spine-2026-05-05/03.6 — middleware now opens a
// transaction on EVERY writing DbContext registered in
// ITenantScopedDbContextRegistry so the third GUC `agrisync.user_id`
// (added to TenantConnectionInterceptor in 03.6) propagates across
// UserDbContext commands too. Single-context behaviour (just
// ShramSafalDbContext) silently failed-closed under UserDb RLS because
// auto-commit transactions expire the `set_config(..., true)` GUC
// before the policy sees it.
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace AgriSync.BuildingBlocks.Persistence;

/// <summary>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phases 03.2 + 03.6 — wraps every
/// business request in explicit DbContext transactions (one per
/// writing context registered) so the
/// <see cref="TenantConnectionInterceptor"/>'s
/// <c>set_config(..., true)</c> GUC writes propagate across every
/// command in the request. Postgres scopes <c>SET LOCAL</c>-style GUCs
/// to the current transaction; without an explicit transaction each
/// EF Core command would run on its own auto-commit transaction and
/// the GUC would expire before the next statement.
///
/// <para>
/// <b>03.6 critical change.</b> The original 03.2 middleware took a
/// single <see cref="DbContext"/> dependency that resolved (via DI
/// alias) to <c>ShramSafalDbContext</c>. When UserDbContext gained the
/// interceptor in 03.6, its commands continued to run on auto-commit
/// transactions; <c>set_config(..., true)</c> no-opped and the User
/// RLS policy saw NULL → returned 0 rows silently. The fix: resolve a
/// registry of every tenant-scoped DbContext type and open a tx on
/// each before the pipeline runs. Commit all on success, rollback all
/// on failure.
/// </para>
///
/// <para>
/// <b>Layering.</b> The middleware lives in
/// <c>AgriSync.BuildingBlocks</c>, which "may use SharedKernel only"
/// (root <c>CLAUDE.md</c>). It therefore CANNOT name
/// <c>ShramSafalDbContext</c> or <c>UserDbContext</c> directly. The
/// app composition root (<c>AddShramSafalInfrastructure</c>,
/// <c>AddUserInfrastructure</c>) registers each tenant-scoped context
/// into <see cref="ITenantScopedDbContextRegistry"/>; the middleware
/// asks the registry for the per-scope instances and opens a tx on
/// each.
/// </para>
///
/// <para>
/// <b>Skip list</b> covers infrastructure routes that must never enter
/// a per-request transaction:
/// <list type="bullet">
/// <item><c>/health</c>, <c>/version</c>, <c>/metrics</c> — observability
/// (Prometheus scrapes /metrics on a tight cadence; wrapping it in a
/// DB transaction would create needless connection pressure).</item>
/// <item><c>/swagger</c> — static UI assets.</item>
/// <item><c>/telemetry/client-error</c> — anonymous browser error
/// ingest; no tenant claim available.</item>
/// <item><c>/test</c> — Development-only test endpoints (db init, seed,
/// db connectivity) that must run with no tenant claim.</item>
/// </list>
/// </para>
/// </summary>
public sealed class TenantTransactionMiddleware
{
    private static readonly string[] SkipPathPrefixes =
    {
        "/health", "/version", "/metrics", "/swagger", "/telemetry/client-error", "/test",
        // Anonymous auth surface — login/register/refresh/OTP hit UserDb
        // without a tenant claim by definition (the user has not yet
        // authenticated). Without admin elevation the interceptor's
        // fail-closed throw blocks the login query and breaks e2e.
        "/user/auth", "/auth",
        // E2E test harness endpoints are dev-only and bypass tenancy.
        "/__e2e",
        // Post-login, pre-farm-selection bootstrap surface. This
        // endpoint intentionally spans all of the caller's farms (so
        // it cannot scope to a single farmId) yet still hits the
        // tenant-scoped ShramSafalDbContext. Without admin elevation
        // the interceptor fail-closes on the first DbCommand because
        // ShramSafalAuthorizationEnforcer.EnsureIsFarmMember was never
        // invoked (no farmId in scope to enforce against).
        //
        // GET /shramsafal/farms/mine — list farms the caller is a
        // member of. The frontend bootstrap calls this to populate the
        // FarmContextSwitcher BEFORE any farm is selected; e2e spec
        // 05_farm_context_switch is the smoking gun, and specs 02–04
        // also depend on this completing so the app shell renders.
        //
        // NOTE: deliberately NOT a catch-all on "/shramsafal" —
        // /shramsafal/logs, /shramsafal/farms/{farmId}/..., /sync,
        // /shramsafal/attachments, etc. MUST keep running under the
        // tenant-scoped transaction so RLS + the interceptor enforce
        // farm-level isolation. Adding peer "list-my-X" endpoints
        // here should follow the same per-route audit (confirm the
        // handler legitimately spans the caller's tenancies and has
        // user-scoped filtering of its own).
        "/shramsafal/farms/mine",
        // POST /sync/push, GET /sync/pull — user-scoped multi-farm
        // sync surface. Both handlers (PushSyncBatchHandler,
        // PullSyncChangesHandler) take only actorUserId and span every
        // farm the user is a member of; they have no farmId in scope
        // and therefore never invoke ShramSafalAuthorizationEnforcer.
        // EnsureIsFarmMember, so TenantContext stays unset and the
        // interceptor fail-closes on the first DbCommand. Each per-
        // mutation handler dispatched by PushSyncBatchHandler runs its
        // own IsUserMemberOfFarmAsync pre-check (see e.g.
        // CreateAttachmentAuthorizer docstring) and PullSyncChanges
        // filters every projection by actorUserId, so user-scoped
        // isolation is preserved without per-request RLS.
        //
        // Unblocks: spec 02 (offline log capture → /sync/push),
        // spec 03 (sync retry after rejection → /sync/push).
        "/sync/",
        // POST /shramsafal/attachments (+ /{id}/upload, /{id},
        // /{id}/download, list) — attachment lifecycle endpoints.
        // The CREATE accepts FarmId in the body and CreateAttachment-
        // Authorizer runs IsUserMemberOfFarmAsync(FarmId, actorUserId)
        // before the handler touches the DbContext. Upload, download,
        // metadata, list all resolve the attachment by id + actorUserId
        // and surface ShramSafalErrors.Forbidden for non-members. Like
        // the sync surface, none of these flows invoke EnsureIsFarmMember
        // (the authorizer talks to the repository directly), so the
        // tenant claim never gets set and the interceptor fail-closes.
        //
        // Unblocks: spec 04 (attachment upload state machine →
        // POST /shramsafal/attachments + POST /shramsafal/attachments/{id}/upload).
        "/shramsafal/attachments",
        // Admin console routes intentionally start without a farm tenant:
        // the first DB question is "which admin organizations does this
        // user belong to?" If we require a farm claim before that resolver
        // runs, /shramsafal/admin/me/scope fail-closes and admin-web sends
        // a valid platform owner to the misleading 403 page. AdminScopeHelper
        // still performs the membership/module gates inside each endpoint.
        "/shramsafal/admin",
        // Farmer-health admin routes are mounted at the API root for the
        // admin-web route contract, but they use the same AdminScopeHelper
        // gate and have the same no-farm-at-entry shape.
        "/admin/farmer-health",
        // GET/PUT /shramsafal/consent/me — user-scoped consent state.
        // The ssf.user_consents table is keyed by user_id only; there
        // is no farm_id column, no tenant scoping, and the handler
        // (UpdateConsentHandler) validates userId from the bearer
        // before touching the row. The flow legitimately spans the
        // user globally (consent toggles in Settings happen before
        // farm selection on first launch), so TenantContext stays
        // unset and the interceptor fail-closes on
        // GetUserConsentStateAsync. Phase 06 shipped the endpoint
        // 2026-05-17 but the elevation entry was missed — bug
        // surfaced when Voice Diary E2E consent-gate Playwright test
        // added 2026-05-17 (commit 707ef91f) tried to drive the
        // first-grant modal in headless browser; modal's confirm
        // click triggers PUT /consent/me which 500'd with
        // "TenantConnectionInterceptor: no tenant claim set and not
        // in admin scope". Local Purvesh v2 hides the bug because
        // its bearer carries a stale farmId from prior farm
        // selection. Phase 07 spine-hardening closes the gap.
        //
        // Unblocks: spec 06 (voice diary consent gate → PUT consent
        // → modal closes → checkbox flips checked).
        "/shramsafal/consent",
        // POST /shramsafal/voice-diary/persist (+ /list, /{clipId}) —
        // retained voice diary endpoints. All three are user-scoped
        // (ssf.voice_clips_retained is keyed by user_id; no farm_id
        // column). Persist runs the IConsentEnforcer.RequireGrantAsync
        // gate against ssf.user_consents BEFORE any retained write —
        // when consent is revoked the enforcer returns Denied(reason)
        // and the handler maps to ShramSafalErrors.ConsentRequired
        // (403). For that gate to function, the enforcer's
        // GetUserConsentStateAsync EF query must succeed, which means
        // the request must run under admin elevation (same reason as
        // /shramsafal/consent above). List + GetById endpoints read
        // voice_clips_retained directly filtered by callerUserId.
        // Phase 07 spine-hardening commit covers the elevation gap
        // for the persist + read endpoints alongside the consent
        // surface.
        //
        // Unblocks: spec 06 (voice diary consent gate step 8 → post-
        // revoke persist must return 403 ConsentRequired, not 500
        // TenantConnectionInterceptor).
        "/shramsafal/voice-diary",
    };

    private readonly RequestDelegate _next;
    public TenantTransactionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context,
        ITenantScopedDbContextRegistry registry,
        TenantContext tenantContext)
    {
        var path = context.Request.Path.Value ?? string.Empty;
        foreach (var prefix in SkipPathPrefixes)
        {
            if (path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                // Skip-listed paths don't have a tenant claim by design
                // (health checks, /metrics scrape, anonymous auth, e2e
                // test harness). Elevate to admin so the interceptor's
                // fail-closed guard on any DbCommand in this scope
                // doesn't 500 the request. ElevateToAdminCrossTenant is
                // idempotent when FarmId is unset; handlers that already
                // elevate explicitly (e.g. /health/ready, /__e2e/seed)
                // remain correct because the second call is a no-op.
                tenantContext.ElevateToAdminCrossTenant();
                await _next(context);
                return;
            }
        }

        // Open one transaction PER writing context so each commands
        // chain sees its own `set_config(..., true)` GUC. Postgres
        // scopes those GUCs to the connection's current transaction.
        //
        // EnableRetryOnFailure was removed from the ShramSafalDbContext
        // registration (DependencyInjection.cs spec 03.2/03.6) because
        // user-initiated transactions are incompatible with EF Core's
        // retry strategy — and an arbitrary HTTP pipeline cannot be
        // safely retried anyway. With retry disabled, raw
        // BeginTransactionAsync is the correct call here.
        var contexts = registry.GetWritingContexts(context.RequestServices);
        var transactions = new List<IDbContextTransaction>(contexts.Count);
        try
        {
            foreach (var db in contexts)
            {
                var tx = await db.Database.BeginTransactionAsync(context.RequestAborted);
                transactions.Add(tx);
            }

            await _next(context);

            foreach (var tx in transactions)
            {
                await tx.CommitAsync(context.RequestAborted);
            }
        }
        catch
        {
            // Rollback every opened tx in reverse order; swallow per-tx
            // failures so the original exception surfaces unchanged.
            for (var i = transactions.Count - 1; i >= 0; i--)
            {
                try
                {
                    await transactions[i].RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // Suppress secondary failures — the original
                    // exception is what callers need to see.
                }
            }
            throw;
        }
        finally
        {
            foreach (var tx in transactions)
            {
                await tx.DisposeAsync();
            }
        }
    }
}
