using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;

namespace AgriSync.BuildingBlocks.Auth;

public interface IAuthorizationEnforcer
{
    Task EnsureIsFarmMember(UserId userId, FarmId farmId);
    Task EnsureIsOwner(UserId userId, FarmId farmId);
    Task EnsureCanVerify(UserId userId, Guid logId, AppRole role);
    Task EnsureCanEditLog(UserId userId, Guid logId);
}
