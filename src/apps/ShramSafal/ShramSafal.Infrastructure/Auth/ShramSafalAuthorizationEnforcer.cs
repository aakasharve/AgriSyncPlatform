using AgriSync.BuildingBlocks.Auth;
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
/// </summary>
internal sealed class ShramSafalAuthorizationEnforcer(
    IShramSafalRepository repository) : IAuthorizationEnforcer
{
    private static readonly HashSet<AppRole> OwnerRoles = [AppRole.PrimaryOwner, AppRole.SecondaryOwner];

    public async Task<Result> EnsureIsFarmMember(UserId userId, FarmId farmId)
    {
        var validation = ValidateIds(userId, farmId);
        if (!validation.IsSuccess)
        {
            return validation;
        }

        if (await repository.IsUserMemberOfFarmAsync(farmId.Value, userId.Value))
        {
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
