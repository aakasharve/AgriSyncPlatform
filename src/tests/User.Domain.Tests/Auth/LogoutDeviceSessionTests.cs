using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Application.Ports;
using User.Application.UseCases.Auth.Logout;
using User.Application.UseCases.Auth.Session;
using Xunit;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// Tests for LogoutCurrentDeviceHandler and RevokeAllDeviceSessionsHandler.
///
/// LogoutCurrentDeviceCommand now carries ONLY the refresh token — no UserId.
/// The token IS the capability: hash it, look up the row, revoke it.
/// This makes logout work regardless of whether the bearer access token is
/// expired (which was the CRITICAL bug: /logout returned 401 after 15 min idle).
///
/// Handler-behaviour contract (no EF, no real DB):
/// - Matching-token row is revoked.
/// - Unknown or empty token → safe no-op (idempotent, no SaveChanges).
/// - EXPIRED-but-present session token → still revoked (the bug scenario:
///   logout works without a valid bearer because auth is by token hash, not JWT).
/// - All-device revocation calls RevokeAllForUserAsync with the correct reason.
///
/// DEFERRED: EF integration test verifying the t.DeviceId == deviceId predicate
/// in RefreshTokenRepository.RevokeActiveForUserDeviceAsync against a live User DB.
/// Requires a Testcontainers/PostgreSQL harness.  Tracked as a follow-up.
/// </summary>
public class LogoutDeviceSessionTests
{
    private static DomainRefreshToken MakeActiveToken(
        UserId userId,
        string rawToken,
        string deviceId = "device-A",
        string? deviceName = "Test Phone",
        string platform = "android",
        DateTime? createdAt = null)
    {
        var at = createdAt ?? DateTime.UtcNow;
        return new DomainRefreshToken(
            Guid.NewGuid(),
            userId,
            RefreshTokenHasher.Hash(rawToken),
            deviceId,
            deviceName,
            platform,
            at,
            at.AddDays(30));
    }

    // ── LogoutCurrentDeviceHandler ─────────────────────────────────────────

    [Fact]
    public async Task CurrentDevice_logout_revokes_matching_token()
    {
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        const string logoutToken = "token-for-device-A";
        var tokenA = MakeActiveToken(userId, logoutToken, deviceId: "device-A");

        var repo = new CapturingRepo(returnedToken: tokenA);
        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));

        // Token-only command — no UserId required.
        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(logoutToken));

        result.IsSuccess.Should().BeTrue();
        tokenA.IsRevoked.Should().BeTrue("the matching token must be revoked");
        tokenA.RevocationReason.Should().Be("logout_current_device");
        repo.SaveChangesCalls.Should().Be(1, "SaveChangesAsync must be called once after revoking");
    }

    [Fact]
    public async Task CurrentDevice_logout_revokes_EXPIRED_session_token_the_bug_scenario()
    {
        // Before the fix, /logout required RequireAuthorization(); a user idle for >15 min
        // would get a 401 before the handler ran → device session never revoked, cookie
        // never cleared → next boot silently re-authenticated.
        //
        // After the fix: logout is AllowAnonymous and authorises by the SESSION TOKEN, not
        // the bearer.  An expired-but-present refresh token row must still be revoked.
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        const string rawToken = "expired-session-token";
        // Token that EXPIRED 5 minutes ago — handler must still revoke it.
        var expiredAt = now.AddMinutes(-5);
        var expiredToken = new DomainRefreshToken(
            Guid.NewGuid(),
            userId,
            RefreshTokenHasher.Hash(rawToken),
            deviceId: "device-A",
            deviceName: "Test Phone",
            platform: "android",
            createdAtUtc: expiredAt.AddDays(-30),
            expiresAtUtc: expiredAt);

        expiredToken.IsExpired(now).Should().BeTrue("precondition: token is indeed expired");

        var repo = new CapturingRepo(returnedToken: expiredToken);
        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));

        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(rawToken));

        result.IsSuccess.Should().BeTrue("logout of an expired session must still succeed");
        expiredToken.IsRevoked.Should().BeTrue(
            "an expired session token must be revocable so logout always clears the server row");
        repo.SaveChangesCalls.Should().Be(1);
    }

    [Fact]
    public async Task CurrentDevice_logout_with_unknown_token_is_safe_noop()
    {
        var now = DateTime.UtcNow;

        // Repo returns null — token hash not found (already revoked or never issued).
        var repo = new CapturingRepo(returnedToken: null);
        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));

        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand("completely-unknown-token"));

        result.IsSuccess.Should().BeTrue("unknown token must be a safe no-op, not an error");
        repo.SaveChangesCalls.Should().Be(0, "SaveChangesAsync must not be called when nothing was revoked");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task CurrentDevice_logout_with_null_or_empty_token_is_safe_noop(string? rawToken)
    {
        var now = DateTime.UtcNow;

        var repo = new CapturingRepo(returnedToken: null);
        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));

        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(rawToken));

        result.IsSuccess.Should().BeTrue("null/empty refresh token must be a safe no-op, not an error");
        repo.SaveChangesCalls.Should().Be(0, "SaveChangesAsync must not be called when there is nothing to revoke");
    }

    // ── RevokeAllDeviceSessionsHandler ─────────────────────────────────────

    [Fact]
    public async Task RevokeAll_calls_RevokeAllForUser_with_correct_reason_and_saves()
    {
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        var repo = new CapturingRepo(returnedToken: null);

        var handler = new RevokeAllDeviceSessionsHandler(repo, new FakeClock(now));
        var result = await handler.HandleAsync(new RevokeAllDeviceSessionsCommand(userId.Value));

        result.IsSuccess.Should().BeTrue();
        repo.RevokeAllCalledForUserId.Should().Be(userId.Value, "must revoke all sessions for the commanding user");
        repo.RevokeAllReason.Should().Be("revoke_all_sessions");
        repo.SaveChangesCalls.Should().Be(1, "SaveChangesAsync must be called once after bulk revocation");
    }

    // ── fakes ──────────────────────────────────────────────────────────────

    private sealed class FakeClock(DateTime now) : IClock
    {
        public DateTime UtcNow => now;
    }

    private sealed class CapturingRepo(DomainRefreshToken? returnedToken) : IRefreshTokenRepository
    {
        public int SaveChangesCalls { get; private set; }
        public Guid? RevokeAllCalledForUserId { get; private set; }
        public string? RevokeAllReason { get; private set; }

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default)
            => Task.FromResult(returnedToken);

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
            => Task.CompletedTask;

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
        {
            RevokeAllCalledForUserId = userId;
            RevokeAllReason = reason;
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default)
        {
            SaveChangesCalls++;
            return Task.CompletedTask;
        }
    }
}
