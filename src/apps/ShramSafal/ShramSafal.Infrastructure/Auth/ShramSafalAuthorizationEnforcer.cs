using AgriSync.BuildingBlocks.Auth;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Auth;

internal sealed class ShramSafalAuthorizationEnforcer(
    IShramSafalRepository repository,
    ShramSafalDbContext dbContext) : IAuthorizationEnforcer
{
    private const string ShramSafalAppId = "shramsafal";
    private static readonly HashSet<AppRole> OwnerRoles = [AppRole.PrimaryOwner, AppRole.SecondaryOwner];

    public async Task EnsureIsFarmMember(UserId userId, FarmId farmId)
    {
        EnsureValidIds(userId, farmId);

        var farm = await GetFarmOrThrowAsync(farmId);
        if (farm.OwnerUserId == userId)
        {
            return;
        }

        var membershipRole = await GetMembershipRoleAsync(userId);
        if (membershipRole is null)
        {
            throw new UnauthorizedAccessException(
                $"User '{userId}' is not an active ShramSafal member for farm '{farmId}'.");
        }
    }

    public async Task EnsureIsOwner(UserId userId, FarmId farmId)
    {
        EnsureValidIds(userId, farmId);

        var farm = await GetFarmOrThrowAsync(farmId);
        if (farm.OwnerUserId == userId)
        {
            return;
        }

        var membershipRole = await GetMembershipRoleAsync(userId);
        if (membershipRole is not null && OwnerRoles.Contains(membershipRole.Value))
        {
            return;
        }

        throw new UnauthorizedAccessException(
            $"User '{userId}' must be an owner to operate on farm '{farmId}'.");
    }

    public async Task EnsureCanVerify(UserId userId, Guid logId, AppRole role)
    {
        if (userId.IsEmpty)
        {
            throw new UnauthorizedAccessException("Caller user id is required for verification.");
        }

        if (logId == Guid.Empty)
        {
            throw new UnauthorizedAccessException("Log id is required for verification.");
        }

        if (!OwnerRoles.Contains(role))
        {
            throw new UnauthorizedAccessException(
                $"Role '{role}' cannot verify log '{logId}'. Verification is owner-only.");
        }

        var log = await repository.GetDailyLogByIdAsync(logId)
            ?? throw new UnauthorizedAccessException($"Log '{logId}' was not found or is not accessible.");

        var farm = await GetFarmOrThrowAsync(log.FarmId);
        if (farm.OwnerUserId == userId)
        {
            return;
        }

        var membershipRole = await GetMembershipRoleAsync(userId);
        if (membershipRole is null)
        {
            throw new UnauthorizedAccessException(
                $"User '{userId}' is not an active ShramSafal member for farm '{log.FarmId}'.");
        }

        if (membershipRole.Value != role)
        {
            throw new UnauthorizedAccessException(
                $"Caller role mismatch for user '{userId}'. Token role '{role}' does not match active role '{membershipRole.Value}'.");
        }

        if (!OwnerRoles.Contains(membershipRole.Value))
        {
            throw new UnauthorizedAccessException(
                $"Role '{membershipRole.Value}' cannot verify log '{logId}'. Verification is owner-only.");
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

    private async Task<ShramSafal.Domain.Farms.Farm> GetFarmOrThrowAsync(FarmId farmId)
    {
        return await repository.GetFarmByIdAsync(farmId.Value)
            ?? throw new UnauthorizedAccessException($"Farm '{farmId}' was not found or is not accessible.");
    }

    private async Task<AppRole?> GetMembershipRoleAsync(UserId userId)
    {
        if (userId.IsEmpty || !dbContext.Database.IsRelational())
        {
            return null;
        }

        var roleValue = await dbContext.Database
            .SqlQueryRaw<string>(
                @"select role as ""Value""
                  from public.memberships
                  where user_id = {0}
                    and app_id = {1}
                    and is_revoked = false
                  limit 1",
                userId.Value,
                ShramSafalAppId)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(roleValue))
        {
            return null;
        }

        return Enum.TryParse<AppRole>(roleValue, ignoreCase: true, out var role)
            ? role
            : null;
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
