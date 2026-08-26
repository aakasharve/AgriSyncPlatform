using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Common;

namespace ShramSafal.Infrastructure.Auth;

/// <summary>
/// Sub-plan 03 Task 8 follow-up (T-IGH-03-AUTHZ-RESULT): every Ensure*
/// method returns <see cref="Result"/> instead of throwing. Failures
/// are tagged via <see cref="ShramSafalErrors"/> so endpoint adapters
/// + pipeline behaviors can map them to the canonical HTTP status
/// (Forbidden -> 403, NotFound -> 404, Validation -> 400).
///
/// <para>
/// DATA_PRINCIPLE_SPINE Phase 03 sub-phase 03.2: each successful Ensure*
/// call also publishes the (farmId, ownerAccountId) tenant claim into
/// the per-request <see cref="TenantContext"/>. The
/// <c>TenantConnectionInterceptor</c> then stamps every subsequent
/// ShramSafalDbContext command with the matching Postgres GUCs so the
/// Phase 03.3 RLS policies can key on them. The new repo method
/// <see cref="IShramSafalRepository.GetFarmMembershipForTenantAsync"/>
/// returns both halves in a single round-trip (membership decision +
/// owner_account_id projection added by migration
/// <c>20260516120000_AddOwnerAccountIdToFarmMemberships</c>).
/// </para>
///
/// <para>
/// Phase 1 tenant-scope fix (2026-07-19 labour deploy hardening) —
/// cross-verification discovered a SECOND landmine behind the verify_log
/// RLS gap: once <c>PushSyncBatchHandler.HandleVerifyLogAsync</c> actually
/// establishes farm scope and reaches the pipeline-wrapped
/// <c>VerifyLogHandler</c>, <see cref="AgriSync.BuildingBlocks.Application.PipelineBehaviors.AuthorizationBehavior{TCommand,TResult}"/>
/// invokes <see cref="EnsureCanVerify"/> — and <c>/sync/push</c> runs with
/// <see cref="TenantContext"/> already <see cref="TenantContext.IsAdminCrossTenant"/>
/// (the skip-list posture Fix 1 established). <see cref="TenantContext.SetTenant"/>
/// throws on ANY attempt to set a single-tenant claim once admin-elevated
/// (by design — it catches "elevate then re-narrow" cross-tenant leaks on
/// the ONLINE HTTP surface, where admin-elevation is otherwise never
/// combined with a per-command authorization check). That guard was never
/// exercised on <c>/sync/push</c>'s verify_log path before this fix because
/// the dispatcher's own (broken) pre-check always failed FIRST with
/// <c>DailyLogNotFound</c>, so this pipeline stage was never reached in
/// production. Skip the (now-redundant) <c>SetTenant</c> call when already
/// admin-elevated: the interceptor already no-ops in that mode regardless
/// of what <c>TenantContext.FarmId</c> holds, and the real Postgres GUCs
/// were already established directly by
/// <c>PushSyncBatchHandler.EstablishFarmScopeForOwnedEntityAsync</c> BEFORE
/// this authorizer runs — nothing about the actual authorization DECISION
/// (owner-tier role / membership check, still evaluated unconditionally
/// above) changes. Zero behavior change for the online HTTP path, where
/// <c>IsAdminCrossTenant</c> is always false.
/// </para>
///
/// <para>
/// LABOUR_PHASE2 Phase 5 (2026-08-13, founder decision O-4) —
/// <see cref="EnsureCanVerify"/> no longer keeps its own private owner-tier
/// role list. It asks <see cref="LabourManagementGate"/>, the single predicate
/// shared with the four labour handlers, which <b>restores the Mukadam's
/// ability to approve and verify</b> — previously the Mukadam could correct the
/// labour on a log but not verify that same log.
/// <see cref="EnsureIsOwner"/> and <see cref="EnsureCanEditLog"/> are
/// deliberately UNCHANGED: owning a farm and editing a log are not
/// labour-record management, and widening them would be scope this decision did
/// not authorise.
/// </para>
/// </summary>
internal sealed class ShramSafalAuthorizationEnforcer(
    IShramSafalRepository repository,
    TenantContext tenantContext) : IAuthorizationEnforcer
{
    public async Task<Result> EnsureIsFarmMember(UserId userId, FarmId farmId)
    {
        var validation = ValidateIds(userId, farmId);
        if (!validation.IsSuccess)
        {
            return validation;
        }

        var (isMember, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(farmId.Value, userId.Value);
        if (isMember)
        {
            SetTenantUnlessAdminElevated(farmId.Value, ownerAccountId, userId.Value);
            return Result.Success();
        }

        return Result.Failure(ShramSafalErrors.Forbidden);
    }

    public async Task<Result> EnsureIsOwner(UserId userId, FarmId farmId)
    {
        var validation = ValidateIds(userId, farmId);
        if (!validation.IsSuccess)
        {
            return validation;
        }

        if (await repository.IsUserOwnerOfFarmAsync(farmId.Value, userId.Value))
        {
            // Tenant claim must be set BEFORE the next DbContext command
            // leaves this scope. Owner check went through IsUserOwnerOfFarmAsync
            // which does not project owner_account_id, so we make a second
            // call to GetFarmMembershipForTenantAsync to obtain it. The
            // farm-owner shortcut inside the new method makes this cheap —
            // a single row by primary key.
            var (_, ownerAccountId) = await repository
                .GetFarmMembershipForTenantAsync(farmId.Value, userId.Value);
            SetTenantUnlessAdminElevated(farmId.Value, ownerAccountId, userId.Value);
            return Result.Success();
        }

        return Result.Failure(ShramSafalErrors.Forbidden);
    }

    public async Task<Result> EnsureCanVerify(UserId userId, Guid logId)
    {
        if (userId.IsEmpty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        if (logId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        var log = await repository.GetDailyLogByIdAsync(logId);
        if (log is null)
        {
            return Result.Failure(ShramSafalErrors.DailyLogNotFound);
        }

        // ── LABOUR_PHASE2 Phase 5 — THE BEHAVIOUR CHANGE, founder-approved ──
        // This was `OwnerRoles.Contains(role)` with
        // OwnerRoles = [PrimaryOwner, SecondaryOwner] — which EXCLUDED the
        // Mukadam from approving and verifying the very logs they are the
        // person in the field to check, while the same Mukadam was already
        // permitted to CORRECT the labour on those logs. Founder decision O-4
        // (2026-08-12) makes all five governed labour actions obey ONE
        // predicate, and doing so restores the Mukadam's ability to verify.
        // The identical gate now also admits any other role the owner has
        // explicitly granted.
        //
        // Nothing else about this method moved: a missing log is still
        // DailyLogNotFound, a non-member is still Forbidden, and the tenant
        // claim is still published only after the decision is Success.
        if (!await LabourManagementGate.IsAllowedAsync(repository, log.FarmId.Value, userId.Value))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        var (_, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(log.FarmId.Value, userId.Value);
        SetTenantUnlessAdminElevated(log.FarmId.Value, ownerAccountId, userId.Value);
        return Result.Success();
    }

    /// <summary>
    /// See the class-level Phase 1 remark. When <see cref="TenantContext"/>
    /// is already admin-elevated (the <c>/sync/push</c> skip-list posture),
    /// <see cref="TenantContext.SetTenant"/> would throw
    /// "cannot downgrade to single-tenant scope" — a guard designed to catch
    /// online-HTTP-path "elevate then re-narrow" bugs, not this legitimate
    /// admin-elevated + already-GUC-scoped combination. Skipping it here is
    /// a pure no-op on the actual Postgres tenant scope (the interceptor
    /// ignores TenantContext.FarmId while admin-elevated either way).
    /// </summary>
    private void SetTenantUnlessAdminElevated(Guid farmId, Guid ownerAccountId, Guid? userId)
    {
        if (tenantContext.IsAdminCrossTenant)
        {
            return;
        }

        tenantContext.SetTenant(farmId, ownerAccountId, userId);
    }

    public async Task<Result> EnsureCanEditLog(UserId userId, Guid logId)
    {
        if (userId.IsEmpty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        if (logId == Guid.Empty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }

        var log = await repository.GetDailyLogByIdAsync(logId);
        if (log is null)
        {
            return Result.Failure(ShramSafalErrors.DailyLogNotFound);
        }

        return await EnsureIsOwner(userId, log.FarmId);
    }

    private static Result ValidateIds(UserId userId, FarmId farmId)
    {
        if (userId.IsEmpty || farmId.IsEmpty)
        {
            return Result.Failure(ShramSafalErrors.InvalidCommand);
        }
        return Result.Success();
    }
}
