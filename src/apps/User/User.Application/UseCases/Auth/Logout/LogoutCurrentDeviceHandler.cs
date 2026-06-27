using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;

namespace User.Application.UseCases.Auth.Logout;

/// <summary>
/// The refresh token IS the capability: no UserId required.
/// Hash the token → look up the row → revoke it. Works regardless of
/// whether the access token is expired (logout is AllowAnonymous).
/// </summary>
public sealed record LogoutCurrentDeviceCommand(string? RefreshToken);

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

        // Unknown token (already revoked or never issued) — safe no-op (idempotent).
        if (row is null)
        {
            return Result.Success();
        }

        var utcNow = clock.UtcNow;
        row.Revoke(utcNow, "logout_current_device");
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success();
    }
}
