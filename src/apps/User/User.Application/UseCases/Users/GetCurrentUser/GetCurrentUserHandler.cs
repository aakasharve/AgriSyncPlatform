using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Domain.Common;

namespace User.Application.UseCases.Users.GetCurrentUser;

public sealed class GetCurrentUserHandler(IUserRepository userRepository)
{
    public async Task<Result<UserDto>> HandleAsync(Guid userId, CancellationToken ct = default)
    {
        var user = await userRepository.GetByIdAsync(userId, ct);

        if (user is null)
        {
            return Result.Failure<UserDto>(UserErrors.UserNotFound);
        }

        var dto = new UserDto(
            user.Id,
            user.Phone.Value,
            user.DisplayName,
            user.IsActive,
            user.CreatedAtUtc,
            user.Memberships
                .Where(m => !m.IsRevoked)
                .Select(m => new MembershipDto(m.Id, m.AppId, m.Role.ToString(), m.GrantedAtUtc))
                .ToList());

        return Result.Success(dto);
    }
}
