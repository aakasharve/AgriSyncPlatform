// spec: data-principle-spine-2026-05-05/03.2
// spec: data-principle-spine-2026-05-05/03.6 — middleware now opens a
// transaction on EVERY writing DbContext registered in
// ITenantScopedDbContextRegistry so the third GUC `agrisync.user_id`
// (added to TenantConnectionInterceptor in 03.6) propagates across
// UserDbContext commands too. Single-context behaviour (just
// ShramSafalDbContext) silently failed-closed under UserDb RLS because
// auto-commit transactions expire the `set_config(..., true)` GUC
// before the policy sees it.
using System.Security.Claims;
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
    // ADR 0019 — user-scoped (multi-farm, NON-admin) READ surfaces.
    //
    // Each entry is an endpoint that legitimately spans EVERY farm the caller belongs
    // to, so no single farmId can be in scope, yet it still reads farm-scoped tables
    // under FORCE-RLS. Requests matching one of these prefixes enter
    // TenantContext.SetUserScoped from the validated JWT claim and run inside the
    // per-context transaction(s), so the interceptor prepends
    // `SET LOCAL agrisync.user_id` to every command and the p_user_select_* policies
    // filter the read to the caller's own farms.
    //
    // This is deliberately NOT the admin skip-list: admin elevation sets NO GUC, so a
    // farm-scoped read under it returns zero rows (and for a repository method with no
    // WHERE farm_id of its own it would be an outright cross-tenant leak if the
    // policies ever loosened). READ surfaces only — user-scoped mode has no write path.
    /// <summary>
    /// One user-scoped read surface. <paramref name="Method"/> is null when EVERY
    /// verb on the prefix is a user-scoped read, and an explicit verb when the
    /// same prefix also carries writes that must stay on the admin skip-list
    /// (attachments is the case that forced this: GET list/metadata/download are
    /// user-scoped reads, POST create/upload are farm-scoped writes).
    /// </summary>
    private readonly record struct UserScopedReadRoute(string? Method, string Prefix);

    private static readonly UserScopedReadRoute[] UserScopedReadPathPrefixes =
    {
        // GET /sync/pull — the original ADR 0019 surface. PullSyncChangesHandler
        // projects every farm the caller can see; see the "/sync/" note in the skip
        // list below for why /sync/push stays admin-elevated.
        new(null, "/sync/pull"),
        // GET /shramsafal/finance/summary — GetFinanceSummaryHandler is user-scoped by
        // construction: it resolves the caller's farms via
        // ShramSafalRepository.GetFarmIdsForUserAsync(actorUserId) and then reads
        // ssf.cost_entries + ssf.finance_corrections ACROSS all of them.
        // ShramSafalRepository.GetCostEntriesAsync carries no farm_id predicate at all —
        // it leans entirely on RLS for scoping — so this endpoint must run with the
        // user_id GUC set, not admin-elevated.
        //
        // Before this entry the route was neither skip-listed nor farm-claimed:
        // ShramSafalAuthorizationEnforcer.EnsureIsFarmMember never runs (there is no
        // farmId to enforce against), TenantContext stayed empty, and the very first
        // DbCommand fail-closed in TenantConnectionInterceptor with "no tenant claim set
        // and not in admin scope" → HTTP 500 at GetFarmIdsForUserAsync.
        //
        // The policies this relies on already shipped:
        // p_user_select_farms / p_user_select_memberships (20260606074635) and
        // p_user_select_cost_entries / p_user_select_finance_corrections
        // (20260607120000_AddUserScopedDataReadPolicies). No new DB object is needed.
        //
        // NOTE: deliberately NOT the whole "/shramsafal/finance" group. The finance
        // WRITE endpoints (cost-entry, cost-entry/{id}/correct, allocate-global,
        // price-config) and /finance/plot-summary each carry a FarmId/PlotId and MUST
        // keep running under the single-tenant farm_id claim so the write-side RLS
        // policies enforce farm isolation. Adding a peer "summary across my farms"
        // endpoint here should follow the same per-route audit: confirm the handler is
        // read-only and genuinely spans the caller's tenancies.
        new(null, "/shramsafal/finance/summary"),
        // GET /shramsafal/attachments (+ /{id}, /{id}/download) — user-scoped
        // multi-farm READS. The whole "/shramsafal/attachments" prefix is on the
        // admin skip-list below for the sake of its WRITES (create + upload), and
        // admin elevation sets NO GUC. ssf.attachments has RLS ENABLED and FORCED,
        // so under FORCE-RLS every one of these reads returned nothing: the list
        // answered `[]` and metadata/download answered 404 AttachmentNotFound for
        // rows that demonstrably exist on the caller's own farm (verified
        // 2026-08-10 — 4 seeded attachments on farm d7b187c8, all invisible).
        // Silently: photos attached to a daily log simply never appeared.
        //
        // These three are read-only (no AuditEvent, no SaveChanges), which is the
        // precondition ADR 0019 puts on user-scoped mode, and each handler keeps
        // its OWN authorization check on top of RLS — ListAttachmentsForEntity
        // intersects with GetFarmIdsForUserAsync, GetAttachmentMetadata and
        // GetAttachmentFile both call IsUserMemberOfFarmAsync — so this only
        // restores visibility, it never widens it.
        //
        // METHOD-SCOPED on purpose: POST /shramsafal/attachments and
        // POST /shramsafal/attachments/{id}/upload WRITE ssf.attachments under a
        // WITH CHECK on farm_id and must keep falling through to the skip-list
        // entry below. User-scoped mode is a read mode and sets no farm_id.
        new("GET", "/shramsafal/attachments"),
    };

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
        // spec: dfes-companion-2026-07-11 (wave-4.2) — POST /shramsafal/consent-gate/accept.
        // The first-open Terms + DPDP gate runs BEFORE login, so there is no farm claim and
        // no user claim to open a tenant transaction against; the interceptor would
        // fail-closed on the first DbCommand. The endpoint elevates and owns its own commit.
        // Narrow by design: it accepts no farm id, takes its user id only from the JWT
        // subject (null when anonymous), and can write nothing but its own two ledger rows.
        //
        // B1 (2026-08-27): /shramsafal/consent-gate/LINK is served by THIS entry too, and
        // it took a measurement to get there. Its rows NAME a user, so the ledgers' RLS
        // WITH CHECK cannot pass one unless agrisync.user_id is set — and elevation never
        // sets it. The obvious inference was that the route needed the user-scoped mode
        // above; it was wired that way, and the endpoint could not write a single row:
        //
        //   DbUpdateConcurrencyException: expected to affect 1 row(s), but actually
        //   affected 0 row(s)   (LinkConsentGateToUserHandler → SaveChangesAsync)
        //
        // User-scoped mode is a READ posture. TenantConnectionInterceptor implements it by
        // prepending `SET LOCAL agrisync.user_id = '…'; ` onto the SAME CommandText as the
        // caller's statement, which is harmless for a SELECT and fatal for an EF INSERT
        // batch (see reference_interceptor_setlocal_desyncs_ef_writes; the identical
        // failure was measured independently on POST /shramsafal/corrections and reverted).
        //
        // So /link is elevated here like its sibling /accept — elevation being the thing
        // that SILENCES the prepend, not an identity — and the identity it does need is
        // established inside the endpoint by ICallerUserTenantScope.RunForCallerAsync,
        // which issues set_config as its own command inside its own transaction. Do not
        // move this route to the user-scoped branch: it has been tried and measured.
        "/shramsafal/consent-gate",
        // POST /sync/push — user-scoped multi-farm WRITE surface.
        // PushSyncBatchHandler takes only actorUserId and dispatches per-
        // mutation handlers that each run their own IsUserMemberOfFarmAsync
        // pre-check (see CreateAttachmentAuthorizer docstring), so the write
        // path stays admin-elevated here. Unblocks spec 02 / spec 03.
        //
        // ADR 0019 NOTE: GET /sync/pull is NO LONGER served by this skip
        // entry — it is intercepted by the user-scoped branch at the TOP of
        // InvokeAsync (enters TenantContext.SetUserScoped from the JWT claim +
        // opens a tx so the user-scoped RLS policies filter the read). The old
        // claim that "PullSyncChanges filters by actorUserId so isolation is
        // preserved without per-request RLS" was FALSE under FORCE-RLS: admin
        // elevation sets no GUC, so every farm-scoped read returned 0 rows and
        // the pull came back empty. The "/sync/" prefix still matches the
        // /sync/push WRITE path (unchanged); /sync/pull is handled earlier.
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
        // spec: voice-stream-tenant-and-lenient-metadata-2026-06-10 —
        // POST /shramsafal/ai/transcribe-stream is the live-caption SSE
        // endpoint. It is farm-AGNOSTIC: it reads ONLY the global
        // AiProviderConfig (AiJobRepository.GetProviderConfigAsync) to pick
        // the active transcriber, transcodes the uploaded audio, and streams
        // the transcript back. It performs NO farm-scoped read and NO write
        // (no ssf.ai_jobs INSERT, no farm tables). Without elevation the very
        // first DbCommand (the provider-config read) fail-closes in
        // TenantConnectionInterceptor with "no tenant claim set and not in
        // admin scope" → 500. Admin-elevating here (no per-request tx, no GUC
        // prelude) is the correct posture for a global-config-only read and
        // keeps the SSE flush path free of a long-held transaction. The
        // global config is platform-shared, not tenant data, so no isolation
        // is lost. Confirmed root on prod 2026-06-10.
        "/shramsafal/ai/transcribe-stream",
        // POST /api/ai/eval-parse — non-Prod, ALLOW_EVAL_PARSE-gated
        // prompt-ops eval harness (AiEvalEndpoints). Structurally identical
        // to /shramsafal/ai/transcribe-stream above: it reads ONLY the global
        // AiProviderConfig (AiJobRepository.GetProviderConfigAsync) to resolve
        // the voice structurer, then calls the provider directly. It performs
        // NO farm-scoped read and NO write. Without admin elevation the very
        // first DbCommand (the provider-config read at
        // AiOrchestrator.ParseVoiceWithOverrideAsync) fail-closes in
        // TenantConnectionInterceptor with "no tenant claim set and not in
        // admin scope" → 500 before the model is ever called. The global
        // config is platform-shared, not tenant data, so no isolation is lost.
        // The route is double-gated (non-Prod ∧ ALLOW_EVAL_PARSE) so this
        // elevation can never apply in Production.
        "/api/ai/eval-parse",
    };

    private readonly RequestDelegate _next;
    public TenantTransactionMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(
        HttpContext context,
        ITenantScopedDbContextRegistry registry,
        TenantContext tenantContext)
    {
        var path = context.Request.Path.Value ?? string.Empty;

        // ADR 0019 — user-scoped (multi-farm, NON-admin) read surfaces. Enter
        // user-scoped mode from the validated JWT claim (Caveat B) and run the whole
        // request inside the per-context transaction(s) so the tx-scoped
        // SET LOCAL agrisync.user_id reaches every read, including sub-handlers that
        // share the request-scoped ShramSafalDbContext. This block is checked BEFORE
        // the admin skip-list so a user-scoped read is never silently admin-elevated
        // (which would set no GUC and return an empty result set).
        foreach (var userScopedRoute in UserScopedReadPathPrefixes)
        {
            if (!path.StartsWith(userScopedRoute.Prefix, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            // A verb-qualified entry only claims that verb; every other verb on
            // the same prefix falls through to the skip-list below (this is what
            // keeps the attachment WRITES admin-elevated).
            if (userScopedRoute.Method is { } requiredMethod &&
                !string.Equals(context.Request.Method, requiredMethod, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (!TryGetAuthenticatedUserId(context, out var scopedUserId))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            tenantContext.SetUserScoped(scopedUserId);
            await RunPipelineInTransactionsAsync(context, registry);
            return;
        }

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

        await RunPipelineInTransactionsAsync(context, registry);
    }

    // Open one transaction PER writing context so each command chain sees its
    // own `set_config(..., true)` GUC. Postgres scopes those GUCs to the
    // connection's current transaction. Used by BOTH the normal
    // single-tenant/admin path and the ADR 0019 user-scoped /sync/pull branch.
    //
    // EnableRetryOnFailure was removed from the ShramSafalDbContext
    // registration (DependencyInjection.cs spec 03.2/03.6) because
    // user-initiated transactions are incompatible with EF Core's retry
    // strategy — and an arbitrary HTTP pipeline cannot be safely retried
    // anyway. With retry disabled, raw BeginTransactionAsync is correct here.
    private async Task RunPipelineInTransactionsAsync(
        HttpContext context,
        ITenantScopedDbContextRegistry registry)
    {
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

    // ADR 0019 Caveat B — user-scoped mode is entered from the validated JWT
    // claim ONLY (sub / NameIdentifier), never a request header/body, never
    // Guid.Empty. Returns false for anonymous/unparseable principals so the
    // caller falls through to the fail-closed path instead of user-scoping.
    private static bool TryGetAuthenticatedUserId(HttpContext context, out Guid userId)
    {
        userId = Guid.Empty;
        var principal = context.User;
        if (principal?.Identity?.IsAuthenticated != true)
        {
            return false;
        }

        var subject =
            principal.FindFirst("sub")?.Value ??
            principal.FindFirst(ClaimTypes.NameIdentifier)?.Value;

        return Guid.TryParse(subject, out userId) && userId != Guid.Empty;
    }
}
