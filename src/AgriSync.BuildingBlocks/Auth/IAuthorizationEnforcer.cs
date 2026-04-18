using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.BuildingBlocks.Auth;

public interface IAuthorizationEnforcer
{
    Task EnsureIsFarmMember(UserId userId, FarmId farmId);
    Task EnsureIsOwner(UserId userId, FarmId farmId);
    Task EnsureCanVerify(UserId userId, Guid logId);
    Task EnsureCanEditLog(UserId userId, Guid logId);
}
