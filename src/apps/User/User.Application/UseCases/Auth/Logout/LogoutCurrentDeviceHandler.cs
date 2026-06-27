using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.Logout;

public sealed record LogoutCurrentDeviceCommand(Guid UserId, string? RefreshToken);

public sealed class LogoutCurrentDeviceHandler(
    IRefreshTokenRepository refreshTokenRepository,
    IClock clock)
{
    public async Task<Result> HandleAsync(LogoutCurrentDeviceCommand command, CancellationToken ct = default)
    {
        // Null or empty token means there is nothing to revoke — safe no-op.
        if (string.IsNullOrEmpty(command.RefreshToken))
        {
            return Result.Success();
        }

        var tokenHash = RefreshTokenHasher.Hash(command.RefreshToken);
        var row = await refreshTokenRepository.GetByTokenHashAsync(tokenHash, ct);

        // Unknown token or belongs to a different user — safe no-op (idempotent).
        if (row is null || row.UserId.Value != command.UserId)
        {
            return Result.Success();
        }

        var utcNow = clock.UtcNow;
        row.Revoke(utcNow, "logout_current_device");
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
