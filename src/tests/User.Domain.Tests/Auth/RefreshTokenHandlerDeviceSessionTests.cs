using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Application.Contracts.Dtos;
using User.Application.Ports;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.Session;
using Xunit;
using DomainUser = global::User.Domain.Identity.User;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// Device-session tests for RefreshTokenHandler (Task 2.3):
/// - Active refresh rotates old token with reason "rotated"
/// - Replacement token preserves DeviceId/DeviceName/Platform from old
/// - Unknown hash fails closed
/// - Revoked token reuse revokes active same-device sessions (reuse_detected)
/// - Inactive user fails
/// </summary>
public class RefreshTokenHandlerDeviceSessionTests
{
    private static readonly DeviceSessionRequest DefaultSession =
        new("device-X", RememberDevice: true, DeviceName: "Device X", Platform: "android");

    [Fact]
    public async Task Active_refresh_rotates_old_token_and_returns_new_access_token()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "valid-raw-refresh";
        var userId = new UserId(Guid.NewGuid());
        var user = MakeActiveUser(userId, now);

        var existingToken = MakeActiveToken(userId, rawToken, "device-X", now);
        var repo = new CapturingRepo(existingToken);

        var handler = BuildHandler(user, repo, now);
        var result = await handler.HandleAsync(new RefreshTokenCommand(rawToken, DefaultSession));

        result.IsSuccess.Should().BeTrue();
        existingToken.IsRevoked.Should().BeTrue("old token must be rotated=revoked");
        existingToken.RevocationReason.Should().Be("rotated");
        existingToken.ReplacedByTokenId.Should().NotBeNull();
    }

    [Fact]
    public async Task Rotation_creates_replacement_with_same_device_metadata()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "valid-raw-refresh";
        var userId = new UserId(Guid.NewGuid());
        var user = MakeActiveUser(userId, now);

        var existingToken = MakeActiveToken(userId, rawToken, "device-X", now, deviceName: "My Phone", platform: "ios");
        var repo = new CapturingRepo(existingToken);

        var handler = BuildHandler(user, repo, now);
        await handler.HandleAsync(new RefreshTokenCommand(rawToken, DefaultSession));

        var added = repo.AddedToken;
        added.Should().NotBeNull("a replacement token must be stored");
        added!.DeviceId.Should().Be("device-X");
        added.DeviceName.Should().Be("My Phone");
        added.Platform.Should().Be("ios");
    }

    [Fact]
    public async Task Unknown_token_hash_fails_closed()
    {
        var now = DateTime.UtcNow;
        var user = MakeActiveUser(new UserId(Guid.NewGuid()), now);
        var repo = new CapturingRepo(existingToken: null);

        var handler = BuildHandler(user, repo, now);
        var result = await handler.HandleAsync(new RefreshTokenCommand("unknown-token", DefaultSession));

        result.IsFailure.Should().BeTrue();
        repo.AddedToken.Should().BeNull();
    }

    [Fact]
    public async Task Revoked_token_reuse_revokes_active_same_device_sessions_and_fails()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "already-revoked-token";
        var userId = new UserId(Guid.NewGuid());
        var user = MakeActiveUser(userId, now);

        // Pre-revoke the token to simulate reuse attempt
        var revokedToken = MakeActiveToken(userId, rawToken, "device-X", now);
        revokedToken.Revoke(now.AddHours(-1), "earlier_revocation");

        var repo = new CapturingRepo(revokedToken);

        var handler = BuildHandler(user, repo, now);
        var result = await handler.HandleAsync(new RefreshTokenCommand(rawToken, DefaultSession));

        result.IsFailure.Should().BeTrue("reuse of a revoked token must fail");
        repo.ReuseDetectedDeviceId.Should().Be("device-X", "reuse detection must revoke same-device sessions");
        repo.AddedToken.Should().BeNull("no new token should be stored on reuse attempt");
    }

    [Fact]
    public async Task Expired_but_not_revoked_token_fails_closed()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "expired-token";
        var userId = new UserId(Guid.NewGuid());
        var user = MakeActiveUser(userId, now);

        // Create a token that is already expired
        var expiredToken = MakeActiveToken(userId, rawToken, "device-X",
            createdAt: now.AddDays(-31),
            expiresAt: now.AddDays(-1),
            deviceName: null);

        var repo = new CapturingRepo(expiredToken);

        var handler = BuildHandler(user, repo, now);
        var result = await handler.HandleAsync(new RefreshTokenCommand(rawToken, DefaultSession));

        result.IsFailure.Should().BeTrue("expired token must fail closed");
        repo.AddedToken.Should().BeNull();
    }

    [Fact]
    public async Task Inactive_user_fails_even_with_valid_token()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "valid-token-inactive-user";
        var userId = new UserId(Guid.NewGuid());

        // Create a deactivated user
        var user = MakeActiveUser(userId, now);
        user.Deactivate();

        var existingToken = MakeActiveToken(userId, rawToken, "device-X", now);
        var repo = new CapturingRepo(existingToken);

        var handler = BuildHandler(user, repo, now);
        var result = await handler.HandleAsync(new RefreshTokenCommand(rawToken, DefaultSession));

        result.IsFailure.Should().BeTrue("inactive user must not be refreshed");
    }

    // ---- helpers ----

    private static DomainUser MakeActiveUser(UserId userId, DateTime now)
    {
        var user = DomainUser.Register(userId, DomainPhone.Create("8888888888"), "Test User", "hash", now);
        user.MarkPhoneVerified(now);
        return user;
    }

    private static DomainRefreshToken MakeActiveToken(
        UserId userId,
        string rawToken,
        string deviceId,
        DateTime createdAt,
        DateTime? expiresAt = null,
        string? deviceName = null,
        string platform = "android")
    {
        return new DomainRefreshToken(
            Guid.NewGuid(),
            userId,
            RefreshTokenHasher.Hash(rawToken),
            deviceId,
            deviceName,
            platform,
            createdAt,
            expiresAt ?? createdAt.AddDays(30));
    }

    private static RefreshTokenHandler BuildHandler(DomainUser user, CapturingRepo repo, DateTime now)
    {
        return new RefreshTokenHandler(
            new SingleUserRepository(user),
            repo,
            new FakeJwt(),
            new GuidIdGenerator(),
            new FakeClock(now));
    }

    // ---- fakes ----

    private sealed class FakeClock(DateTime now) : IClock { public DateTime UtcNow => now; }
    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class FakeJwt : IJwtTokenService
    {
        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified)
            => new("access-new", "refresh-new", DateTime.UtcNow.AddMinutes(15));

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified)
            => new("access-new", "refresh-new", DateTime.UtcNow.AddMinutes(15));
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingRepo(DomainRefreshToken? existingToken) : IRefreshTokenRepository
    {
        public DomainRefreshToken? AddedToken { get; private set; }
        public string? ReuseDetectedDeviceId { get; private set; }

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default)
            => Task.FromResult(existingToken);

        public Task<DomainRefreshToken?> GetActiveForUserDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default)
            => Task.FromResult<DomainRefreshToken?>(null);

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            AddedToken = refreshToken;
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            if (reason == "reuse_detected")
            {
                ReuseDetectedDeviceId = deviceId;
            }
            return Task.CompletedTask;
        }

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
            => Task.CompletedTask;

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
