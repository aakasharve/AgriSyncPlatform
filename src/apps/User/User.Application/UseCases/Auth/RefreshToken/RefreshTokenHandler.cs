using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Common;

namespace User.Application.UseCases.Auth.RefreshToken;

public sealed class RefreshTokenHandler(
    IUserRepository userRepository,
    IRefreshTokenRepository refreshTokenRepository,
    IJwtTokenService jwtTokenService,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<AuthResponse>> HandleAsync(RefreshTokenCommand command, CancellationToken ct = default)
    {
        var utcNow = clock.UtcNow;
        var tokenHash = RefreshTokenHasher.Hash(command.RefreshToken);

        var existingToken = await refreshTokenRepository.GetByTokenHashAsync(tokenHash, ct);

        if (existingToken is null)
        {
            // Unknown token — fail closed.
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        if (existingToken.IsRevoked)
        {
            // Reuse detected: revoke all active sessions for this user/device.
            // lane FIX-1 (register F131; NP-1 review M1): a credential that was ever HELD for the new-phone question (asked, or
            // answered "नाही") belongs to a phone the account may not know - possibly a stranger's. Its reuse ends only the
            // HELD rows of that id, never the account's normal sessions (on `unknown` / `legacy` those are the real owner's).
            if (existingToken.DeviceCheck is not null)
            {
                await refreshTokenRepository.RevokeHeldForUserDeviceAsync(
                    existingToken.UserId, existingToken.DeviceId, utcNow, "reuse_detected", ct);
            }
            else
            {
                await refreshTokenRepository.RevokeActiveForUserDeviceAsync(
                    existingToken.UserId, existingToken.DeviceId, utcNow, "reuse_detected", ct);
            }
            await refreshTokenRepository.SaveChangesAsync(ct);
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        if (!existingToken.IsActive(utcNow))
        {
            // Expired but not revoked — fail closed.
            return Result.Failure<AuthResponse>(UserErrors.InvalidRefreshToken);
        }

        var user = await userRepository.GetByIdAsync(existingToken.UserId, ct);

        if (user is null || !user.IsActive)
        {
            return Result.Failure<AuthResponse>(UserErrors.UserDeactivated);
        }

        // Generate new token pair
        var memberships = user.Memberships
            .Where(m => !m.IsRevoked)
            .Select(m => new MembershipClaim(m.AppId, m.Role.ToString()))
            .ToList();

        // spec: plr-d10 lane NP-1 — the new-phone hold rides the session: a held session's refresh stays held (its
        // token still opens nothing) until the phone answers; a known phone's refresh is never held.
        var held = existingToken.IsHeldForDeviceCheck;
        var tokens = jwtTokenService.GenerateTokens(user.Id, user.Phone.Value, user.DisplayName, memberships, phoneVerified: user.PhoneVerifiedAtUtc.HasValue, deviceCheckPending: held);

        // Store new refresh token — preserve device metadata from the old token
        var newRefreshTokenId = idGenerator.New();
        var newRefreshToken = new Domain.Security.RefreshToken(
            newRefreshTokenId,
            user.Id,
            RefreshTokenHasher.Hash(tokens.RefreshToken),
            existingToken.DeviceId,
            existingToken.DeviceName,
            existingToken.Platform,
            utcNow,
            utcNow.Add(RefreshTokenPolicy.Lifetime));
        if (held)
        {
            newRefreshToken.HoldForDeviceCheck(existingToken.DeviceCheck!.Value);
        }

        // Stamp last_used_at_utc before rotating so the column reflects the final use.
        existingToken.MarkUsed(utcNow);

        // Rotate the old token — marks it revoked with reason "rotated" and links to replacement
        existingToken.MarkRotated(utcNow, newRefreshTokenId);

        await refreshTokenRepository.AddAsync(newRefreshToken, ct);
        await refreshTokenRepository.SaveChangesAsync(ct);

        return Result.Success(new AuthResponse(
            user.Id, tokens.AccessToken, tokens.RefreshToken, tokens.ExpiresAtUtc, newRefreshToken.ExpiresAtUtc,
            DeviceCheckRequired: held,
            AccountName: held ? user.DisplayName : null));
    }
}
