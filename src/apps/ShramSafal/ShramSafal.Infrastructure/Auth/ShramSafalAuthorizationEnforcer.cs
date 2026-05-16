using AgriSync.BuildingBlocks.Auth;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
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
/// </summary>
internal sealed class ShramSafalAuthorizationEnforcer(
    IShramSafalRepository repository,
    TenantContext tenantContext) : IAuthorizationEnforcer
{
    private static readonly HashSet<AppRole> OwnerRoles = [AppRole.PrimaryOwner, AppRole.SecondaryOwner];

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
            tenantContext.SetTenant(farmId.Value, ownerAccountId, userId.Value);
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
            tenantContext.SetTenant(farmId.Value, ownerAccountId, userId.Value);
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

        var membershipRole = await repository.GetUserRoleForFarmAsync(log.FarmId.Value, userId.Value);
        if (membershipRole is null || !OwnerRoles.Contains(membershipRole.Value))
        {
            return Result.Failure(ShramSafalErrors.Forbidden);
        }

        var (_, ownerAccountId) = await repository
            .GetFarmMembershipForTenantAsync(log.FarmId.Value, userId.Value);
        tenantContext.SetTenant(log.FarmId.Value, ownerAccountId, userId.Value);
        return Result.Success();
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
