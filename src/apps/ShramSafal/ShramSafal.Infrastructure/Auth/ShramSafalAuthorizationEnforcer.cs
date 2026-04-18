using AgriSync.BuildingBlocks.Auth;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;

namespace ShramSafal.Infrastructure.Auth;

internal sealed class ShramSafalAuthorizationEnforcer(
    IShramSafalRepository repository) : IAuthorizationEnforcer
{
    private static readonly HashSet<AppRole> OwnerRoles = [AppRole.PrimaryOwner, AppRole.SecondaryOwner];

    public async Task EnsureIsFarmMember(UserId userId, FarmId farmId)
    {
        EnsureValidIds(userId, farmId);

        if (await repository.IsUserMemberOfFarmAsync(farmId.Value, userId.Value))
        {
            return;
        }

        throw new UnauthorizedAccessException(
            $"User '{userId}' is not an active farm member for farm '{farmId}'.");
    }

    public async Task EnsureIsOwner(UserId userId, FarmId farmId)
    {
        EnsureValidIds(userId, farmId);

        if (await repository.IsUserOwnerOfFarmAsync(farmId.Value, userId.Value))
        {
            return;
        }

        throw new UnauthorizedAccessException(
            $"User '{userId}' must be an owner to operate on farm '{farmId}'.");
    }

    public async Task EnsureCanVerify(UserId userId, Guid logId)
    {
        if (userId.IsEmpty)
        {
            throw new UnauthorizedAccessException("Caller user id is required for verification.");
        }

        if (logId == Guid.Empty)
        {
            throw new UnauthorizedAccessException("Log id is required for verification.");
        }

        var log = await repository.GetDailyLogByIdAsync(logId)
            ?? throw new UnauthorizedAccessException($"Log '{logId}' was not found or is not accessible.");

        var membershipRole = await repository.GetUserRoleForFarmAsync(log.FarmId.Value, userId.Value);
        if (membershipRole is null || !OwnerRoles.Contains(membershipRole.Value))
        {
            throw new UnauthorizedAccessException(
                $"User '{userId}' cannot verify log '{logId}'. Verification is owner-only.");
        }
    }

    public async Task EnsureCanEditLog(UserId userId, Guid logId)
    {
        if (userId.IsEmpty)
        {
            throw new UnauthorizedAccessException("Caller user id is required to edit logs.");
        }

        if (logId == Guid.Empty)
        {
            throw new UnauthorizedAccessException("Log id is required to edit logs.");
        }

        var log = await repository.GetDailyLogByIdAsync(logId)
            ?? throw new UnauthorizedAccessException($"Log '{logId}' was not found or is not accessible.");

        await EnsureIsOwner(userId, log.FarmId);
    }

    private static void EnsureValidIds(UserId userId, FarmId farmId)
    {
        if (userId.IsEmpty)
        {
            throw new UnauthorizedAccessException("Caller user id is required.");
        }

        if (farmId.IsEmpty)
        {
            throw new UnauthorizedAccessException("Farm id is required.");
        }
    }
}
