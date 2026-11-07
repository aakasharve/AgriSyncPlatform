using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// spec: voice-tenant-claim-caller-farm-2026-06-08 — establishes a
/// membership-VALIDATED single-farm tenant scope for the current request, using
/// the prod-proven admin-elevate + manual <c>set_config(...,true)</c> technique
/// already live in <c>FirstFarmBootstrapEndpoints</c> (f7fab197) and
/// <c>ShramSafalRepository.GetMyFarmsAsync</c>.
///
/// <para>
/// <b>Why admin-elevate first.</b> <see cref="TenantContext.ElevateToAdminCrossTenant"/>
/// makes <c>TenantConnectionInterceptor</c> a no-op (no per-command
/// <c>SET LOCAL agrisync.* = ...</c> prepend → no EF write-rows-affected
/// desync, per <c>reference_interceptor_setlocal_desyncs_ef_writes</c>). We then
/// set the GUCs ourselves so reads filter to the farm AND the
/// <c>ssf.ai_jobs</c> <c>WITH CHECK (farm_id = agrisync.farm_id)</c> write
/// passes. The GUCs are tx-local (<c>is_local=true</c>) and ride the
/// per-request transaction <c>TenantTransactionMiddleware</c> already opened.
/// </para>
///
/// <para>
/// <b>Isolation gate (load-bearing).</b> Step 4 reads
/// <c>ssf.farms</c> (owner shortcut) + <c>ssf.farm_memberships</c> under the
/// caller's OWN user-scoped PERMISSIVE SELECT policies (keyed on the
/// <c>agrisync.user_id</c> set in step 3 — the validated JWT subject, NOT a
/// caller-supplied claim). A caller can only confirm membership of farms they
/// actually own/belong to; a forged <c>farmId</c> returns no membership and we
/// return Forbidden BEFORE any <c>agrisync.farm_id</c> GUC is set — nothing
/// leaks. This 403 is the SOLE authorization gate for the voice endpoints.
/// </para>
/// </summary>
internal sealed class CallerFarmTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db,
    IShramSafalRepository repository) : ICallerFarmTenantScope
{
    // spec: plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1) — the access gate counts the owner and
    // ACTIVE seats only (GetFarmMembershipForTenantAsync), so a typed-code join request opens no
    // farm scope. Self-exit alone validates the relationship instead (see the port).
    public Task<Result> EstablishForCallerAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => EstablishAsync(farmId, userId, relationshipOnly: false, ct);

    public Task<Result> EstablishRelationshipForCallerAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => EstablishAsync(farmId, userId, relationshipOnly: true, ct);

    private async Task<Result> EstablishAsync(Guid farmId, Guid userId, bool relationshipOnly, CancellationToken ct)
    {
        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        // The single-farm scope is established via Postgres GUCs (set_config) —
        // a relational-only mechanism. Under a NON-relational provider (the EF
        // InMemory provider the AI/farm endpoint integration tests swap in)
        // there is no FORCE-RLS to satisfy and raw SQL is unavailable, so this
        // is a no-op. Authorization is unaffected: every wired handler still
        // runs its own IsUserMemberOfFarmAsync membership check (LINQ, provider-
        // agnostic). Production always uses Npgsql, so the full validated-scope
        // path below runs and the GUC write-path stays exactly as reviewed.
        if (!db.Database.IsRelational())
        {
            return Result.Success();
        }

        // Step 2 — admin-elevate so the interceptor no-ops (no SET LOCAL
        // prelude → no EF write-rows-affected desync). MUST precede any DB
        // command on this context; ElevateToAdminCrossTenant throws if a
        // single-tenant claim was already set in this scope.
        tenantContext.ElevateToAdminCrossTenant();

        // Step 3 — set the caller's user_id GUC so the user-scoped PERMISSIVE
        // SELECT policies (20260606074635 / 20260607120000) surface ONLY the
        // caller's own farms/memberships for the membership read below.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)", ct);

        // Step 3b — neutralise agrisync.farm_id BEFORE the membership read.
        // The read (step 4) touches ssf.farms + ssf.farm_memberships, whose
        // ORIGINAL 03.3 tenant policies (20260516130000_EnableRowLevelSecurity,
        // p_tenant_farms / p_tenant_farm_memberships) cast
        // current_setting('agrisync.farm_id', true)::uuid with a BARE cast and
        // NO NULLIF wrap. If that GUC is an empty string at this point — which
        // it is on the voice-parse request path on prod (and which the original
        // CallerFarmTenantScopeTests did NOT catch because a fresh container
        // leaves the GUC genuinely unset → NULL → no error) — the bare
        // ''::uuid cast throws 22P02 invalid-input-syntax-for-uuid and the whole
        // request 500s before the gate can decide. Setting it to the all-zeros
        // sentinel makes the cast valid: the zero-UUID matches NO real farm, so
        // the tenant policy contributes nothing and the user-scoped policies
        // (keyed on agrisync.user_id, set in step 3) + the explicit WHERE
        // clauses in GetFarmMembershipForTenantAsync remain the SOLE
        // authorization gate. A forged farmId still resolves to no
        // owner/membership row → Forbidden (step 5) with the real farm_id never
        // set. Step 6 overwrites this sentinel with the validated farm_id.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {Guid.Empty.ToString()}, true)", ct);

        // Step 4 — the isolation gate. Reads ssf.farms (owner shortcut) +
        // ssf.farm_memberships under the user-scoped policies set in step 3.
        var (isMember, ownerAccountId) = relationshipOnly
            ? await repository.GetFarmMembershipRelationshipForTenantAsync(farmId, userId, ct)
            : await repository.GetFarmMembershipForTenantAsync(farmId, userId, ct);

        // Step 5 — non-member → Forbidden, with NO farm_id GUC set. Nothing
        // about a foreign farm leaks. This is the sole authorization gate for
        // the wired voice endpoints.
        if (!isMember)
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        // Step 6 — caller is a member: establish the single-farm scope so every
        // subsequent farm-scoped read AND the ai_jobs WITH-CHECK write pass.
        // user_id was already set in step 3.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmId.ToString()}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {ownerAccountId.ToString()}, true)", ct);

        return Result.Success();
    }
}

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves - see <see cref="IJoinClaimTenantScope"/>. Lives in this
/// file deliberately: it uses the same admin-elevate + transaction-local <c>set_config</c>
/// technique as <see cref="CallerFarmTenantScope"/> above, and this file is the single
/// reviewed home of that technique (<c>RlsIdentityScopeRules.GucWriteAllowlist</c>).
/// <c>RlsIdentityScope.RunAsFarmAsync</c> cannot be used here because it demands the farm's
/// owner-account id, which is unknowable before the farm row (RLS-protected by farm id) is read.
/// The policies this claim must satisfy (<c>p_tenant_farms</c>, <c>p_tenant_farm_memberships</c>,
/// <c>p_tenant_audit_events</c>) key on <c>agrisync.farm_id</c> alone.
/// </summary>
internal sealed class JoinClaimTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db) : IJoinClaimTenantScope
{
    public void BeginTokenLookup()
    {
        // No FORCE-RLS and no raw SQL under a non-relational provider (EF InMemory); nothing
        // to elevate away from either, because the interceptor does not exist there.
        if (!db.Database.IsRelational())
        {
            return;
        }

        // Silences the interceptor ONLY. Sets no GUC => no row of any RLS table is visible.
        // Throws if a single-tenant claim was already set (it cannot be on this route).
        tenantContext.ElevateToAdminCrossTenant();
    }

    public async Task PublishTokenFarmScopeAsync(Guid tokenFarmId, Guid claimantUserId, CancellationToken ct = default)
    {
        if (tokenFarmId == Guid.Empty || claimantUserId == Guid.Empty)
        {
            throw new ArgumentException("A token-validated farm id and a claimant user id are both required.");
        }

        if (!db.Database.IsRelational())
        {
            return;
        }

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {tokenFarmId.ToString()}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {claimantUserId.ToString()}, true)", ct);
    }
}

/// <summary>
/// spec: plr-d7-m1-multiuser-2026-10-26 (step 1) - see <see cref="IJoinCodeTenantScope"/>. Lives
/// in this file for the same reason as <see cref="JoinClaimTenantScope"/>: it is the single
/// reviewed home of the admin-elevate + transaction-local <c>set_config</c> technique
/// (<c>RlsIdentityScopeRules.GucWriteAllowlist</c>).
///
/// <para><b>Why a GUC-keyed read policy and not an RLS-exempt lookup table</b> (the two options
/// the plan offered). An exempt <c>ssf.farm_join_codes(code, farm_id)</c> would be readable in
/// full by ANY query the app role runs: one stray <c>SELECT *</c> lists every farm's code, and
/// every code is a valid join request. Hashing does not help - a 6-character code is
/// brute-forced offline in seconds. It would also be a second copy of <c>farms.farm_code</c> that
/// six creation paths plus a backfill must keep in step. The policy instead keeps
/// <c>ssf.farms</c> under FORCE RLS with one more SELECT-only door that opens for exactly one row,
/// and only to a transaction that already KNOWS that row's code; the code stays in one column;
/// and the GUC can only be written from this allowlisted file.</para>
/// </summary>
internal sealed class JoinCodeTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db) : IJoinCodeTenantScope
{
    public async Task BeginCodeLookupAsync(string normalizedFarmCode, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(normalizedFarmCode))
        {
            throw new ArgumentException("A normalized farm code is required.", nameof(normalizedFarmCode));
        }

        // EF InMemory: no FORCE-RLS, no raw SQL, no interceptor to silence.
        if (!db.Database.IsRelational())
        {
            return;
        }

        // Silences the interceptor ONLY (sets no GUC). Throws if a single-tenant claim was
        // already set (it cannot be on this route).
        tenantContext.ElevateToAdminCrossTenant();

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.join_code', {normalizedFarmCode}, true)", ct);
    }

    public async Task PublishCodeFarmScopeAsync(Guid codeFarmId, Guid joinerUserId, CancellationToken ct = default)
    {
        if (codeFarmId == Guid.Empty || joinerUserId == Guid.Empty)
        {
            throw new ArgumentException("A code-validated farm id and a joiner user id are both required.");
        }

        if (!db.Database.IsRelational())
        {
            return;
        }

        // The code has done its one job (finding the farm). Close that door before the farm
        // scope opens, so the rest of the transaction runs under the ordinary farm policies.
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.join_code', '', true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {codeFarmId.ToString()}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {joinerUserId.ToString()}, true)", ct);
    }
}

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane WID. Opens the ONE door to the ShramSafal-wide person tables
/// (<c>ssf.shram_persons</c>, <c>_person_phones</c>, <c>_cards</c>, <c>_phone_challenges</c>): the transaction-local
/// <c>agrisync.identity_scope</c> setting their FORCE-RLS policies key on (migration <c>20261102163914_AddWorkerIdentity</c>).
/// Lives in this file for the same reason as <see cref="JoinCodeTenantScope"/>: the single reviewed home of the
/// transaction-local <c>set_config</c> technique (<c>RlsIdentityScopeRules.GucWriteAllowlist</c>), and its own test pins
/// this file as the only writer of that setting.
///
/// <para><b>Why a setting and not security-definer functions</b> (the orchestrator's two options). The tables need ordinary
/// reads AND writes from a handful of narrow use cases (resolve, link, verify, move, reissue, merge, erase), through the
/// same EF unit of work as the farm record — a set of definer functions would be a second data-access layer with its own
/// grants for every one of them. A policy keyed on a setting keeps EF, keeps the request's one transaction, and fails
/// CLOSED: a session that never set it — every normal farm- or user-scoped request — reads and writes nothing there.</para>
///
/// <para><b>Only after the farm scope.</b> It is opened by <c>ShramIdentityStore</c> alone, inside the request's
/// transaction, after the route opened and checked the caller's farm scope. Outside a transaction it refuses to open
/// (a <c>set_config(..., true)</c> there would last one statement and the next read would silently see nothing).</para>
/// </summary>
internal sealed class IdentityTenantScope(ShramSafalDbContext db)
{
    private bool _open;

    public async Task OpenAsync(CancellationToken ct = default)
    {
        if (_open || !db.Database.IsRelational())
        {
            return;
        }

        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException(
                "The identity scope opens only inside the request's transaction, after its farm scope.");
        }

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.identity_scope', 'on', true)", ct);
        _open = true;
    }

    public async Task CloseAsync(CancellationToken ct = default)
    {
        if (!_open || !db.Database.IsRelational())
        {
            return;
        }

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.identity_scope', '', true)", ct);
        _open = false;
    }
}

/// <summary>
/// spec: plr-d10 lane MU-2 — the invitee's tenant scope (<see cref="IPersonalInvitationTenantScope"/>). Lives in this file
/// for the same reason as <see cref="JoinCodeTenantScope"/>: the single reviewed home of the transaction-local
/// <c>set_config</c> technique (<c>RlsIdentityScopeRules.GucWriteAllowlist</c>). It alone writes the two settings the
/// SELECT-only policies on <c>ssf.farm_personal_invitations</c> key on (migration <c>AddPersonalInvitations</c>):
/// <list type="bullet">
/// <item><c>agrisync.invitee_phone</c> — the person's PROVEN number (<c>IUserDirectory.GetVerifiedPhoneAsync</c>, the
/// server's record of an OTP; never a request value): the rows that named it become visible, nothing else;</item>
/// <item><c>agrisync.invite_code</c> — the eight digits he typed: exactly that one row becomes visible.</item>
/// </list>
/// Stage 2 (<see cref="PublishInvitationFarmScopeAsync"/>) closes both and opens the invitation's farm only, exactly as the
/// typed-code join's stage 2 does.
/// </summary>
internal sealed class PersonalInvitationTenantScope(
    TenantContext tenantContext,
    ShramSafalDbContext db) : IPersonalInvitationTenantScope
{
    private bool _elevated;

    public Task BeginInviteeLookupAsync(CancellationToken ct = default)
    {
        if (db.Database.IsRelational() && !_elevated)
        {
            // Silences the interceptor ONLY (sets no GUC). This route has no farm claim of its own.
            tenantContext.ElevateToAdminCrossTenant();
            _elevated = true;
        }

        return Task.CompletedTask;
    }

    public async Task OpenInviteeDoorAsync(string? inviteePhoneE164, string? code, CancellationToken ct = default)
    {
        if (!db.Database.IsRelational())
        {
            return;
        }

        await BeginInviteeLookupAsync(ct);
        await SetInviteeDoorAsync(db, inviteePhoneE164, code, ct);
    }

    public async Task PublishInvitationFarmScopeAsync(Guid invitationFarmId, Guid claimantUserId, CancellationToken ct = default)
    {
        if (invitationFarmId == Guid.Empty || claimantUserId == Guid.Empty)
        {
            throw new ArgumentException("The invitation's farm id and the claimant's user id are both required.");
        }

        if (!db.Database.IsRelational())
        {
            return;
        }

        // The doors have done their one job (finding the invitation). Close them before the farm scope opens.
        await SetInviteeDoorAsync(db, null, null, ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {invitationFarmId.ToString()}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {claimantUserId.ToString()}, true)", ct);
    }

    /// <summary>
    /// Writes (or, with nulls, closes) the two invitee doors on the CURRENT transaction. Shared with
    /// <c>PersonalInvitationInviteeReader</c>, which runs it inside <c>RlsIdentityScope.RunAsUserAsync</c> for
    /// <c>/me/context</c>. Outside a transaction it refuses (a transaction-local setting would last one statement).
    /// </summary>
    internal static async Task SetInviteeDoorAsync(ShramSafalDbContext db, string? inviteePhoneE164, string? code, CancellationToken ct)
    {
        if (db.Database.CurrentTransaction is null)
        {
            throw new InvalidOperationException("The invitee door opens only inside a transaction.");
        }

        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.invitee_phone', {inviteePhoneE164 ?? string.Empty}, true)", ct);
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.invite_code', {code ?? string.Empty}, true)", ct);
    }
}
