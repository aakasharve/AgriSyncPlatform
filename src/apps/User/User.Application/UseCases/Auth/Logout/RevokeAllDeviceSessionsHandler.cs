using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Ports;

namespace User.Application.UseCases.Auth.Logout;

public sealed record RevokeAllDeviceSessionsCommand(Guid UserId);

public sealed class RevokeAllDeviceSessionsHandler(
    IRefreshTokenRepository refreshTokenRepository,
    IClock clock)
{
    public async Task<Result> HandleAsync(RevokeAllDeviceSessionsCommand command, CancellationToken ct = default)
    {
        var utcNow = clock.UtcNow;
        await refreshTokenRepository.RevokeAllForUserAsync(command.UserId, utcNow, "revoke_all_sessions", ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
