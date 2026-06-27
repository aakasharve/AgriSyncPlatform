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
/// Tests for LogoutCurrentDeviceHandler and RevokeAllDeviceSessionsHandler (Task 2.4).
/// - Current-device logout revokes ONLY the row whose hash matches the supplied refresh token.
/// - Current-device logout with a token belonging to a DIFFERENT user is a no-op.
/// - Current-device logout with an unknown token is a safe no-op.
/// - All-device revocation calls RevokeAllForUserAsync with reason revoke_all_sessions.
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

    // ---- LogoutCurrentDeviceHandler ----

    [Fact]
    public async Task CurrentDevice_logout_revokes_only_matching_token_and_leaves_other_device_active()
    {
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        const string logoutToken = "token-for-device-A";
        const string otherToken = "token-for-device-B";

        var tokenA = MakeActiveToken(userId, logoutToken, deviceId: "device-A");
        var tokenB = MakeActiveToken(userId, otherToken, deviceId: "device-B");

        // Repo only returns tokenA when the logout token hash is looked up.
        var repo = new CapturingRepo(returnedToken: tokenA);

        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));
        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(userId.Value, logoutToken));

        result.IsSuccess.Should().BeTrue();
        tokenA.IsRevoked.Should().BeTrue("the matching token must be revoked");
        tokenA.RevocationReason.Should().Be("logout_current_device");
        tokenB.IsRevoked.Should().BeFalse("a different device's token must remain active");
        repo.SaveChangesCalls.Should().Be(1, "SaveChangesAsync must be called once after revoking");
    }

    [Fact]
    public async Task CurrentDevice_logout_is_noop_when_token_belongs_to_different_user()
    {
        var now = DateTime.UtcNow;
        var ownerUserId = new UserId(Guid.NewGuid());
        var callerUserId = new UserId(Guid.NewGuid()); // different user

        const string rawToken = "token-owned-by-owner";
        var ownersToken = MakeActiveToken(ownerUserId, rawToken);

        var repo = new CapturingRepo(returnedToken: ownersToken);

        // Caller logs out with a token that exists but belongs to ownerUserId, not callerUserId.
        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));
        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(callerUserId.Value, rawToken));

        result.IsSuccess.Should().BeTrue("must be idempotent — no exception");
        ownersToken.IsRevoked.Should().BeFalse("another user's token must not be revoked");
        repo.SaveChangesCalls.Should().Be(0, "SaveChangesAsync must not be called on a no-op");
    }

    [Fact]
    public async Task CurrentDevice_logout_with_unknown_token_is_safe_noop()
    {
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        // Repo returns null — token hash not found.
        var repo = new CapturingRepo(returnedToken: null);

        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));
        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(userId.Value, "completely-unknown-token"));

        result.IsSuccess.Should().BeTrue("unknown token must be a safe no-op, not an error");
        repo.SaveChangesCalls.Should().Be(0, "SaveChangesAsync must not be called when nothing was revoked");
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public async Task CurrentDevice_logout_with_null_or_empty_token_is_safe_noop(string? rawToken)
    {
        var now = DateTime.UtcNow;
        var userId = new UserId(Guid.NewGuid());

        var repo = new CapturingRepo(returnedToken: null);

        var handler = new LogoutCurrentDeviceHandler(repo, new FakeClock(now));
        var result = await handler.HandleAsync(new LogoutCurrentDeviceCommand(userId.Value, rawToken));

        result.IsSuccess.Should().BeTrue("null/empty refresh token must be a safe no-op, not an error");
        repo.SaveChangesCalls.Should().Be(0, "SaveChangesAsync must not be called when there is nothing to revoke");
    }

    // ---- RevokeAllDeviceSessionsHandler ----

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

    // ---- fakes ----

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
