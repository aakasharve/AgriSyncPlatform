using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using User.Application.Ports;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.Session;
using Xunit;
using DomainUser = global::User.Domain.Identity.User;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// Handler-behaviour tests for LoginHandler device-session management.
///
/// These tests verify what the HANDLER calls on the repository fake — they do
/// NOT test the EF predicate or real database isolation (that requires a live
/// User DB; deferred as an integration-test follow-up).
///
/// Verified handler contracts:
/// - Login calls RevokeActiveForUserDeviceAsync for the LOGIN device (device-A).
/// - Login does NOT call RevokeAllForUserAsync (only per-device revoke, never bulk).
/// - Created row stores token hash (not raw token) and device metadata.
///
/// DEFERRED: EF integration test verifying t.DeviceId == deviceId predicate
/// in RefreshTokenRepository.RevokeActiveForUserDeviceAsync against a live DB.
/// </summary>
public class LoginHandlerDeviceSessionTests
{
    private static readonly DeviceSessionRequest DeviceA =
        new("device-A", RememberDevice: true, DeviceName: "Phone A", Platform: "android");

    private static readonly DeviceSessionRequest DeviceB =
        new("device-B", RememberDevice: true, DeviceName: "Phone B", Platform: "web");

    [Fact]
    public async Task Login_calls_per_device_revoke_for_current_device_and_never_revoke_all()
    {
        // Verifies handler behaviour: LoginHandler calls RevokeActiveForUserDeviceAsync(deviceId)
        // and does NOT call RevokeAllForUserAsync. The EF predicate that enforces row-level
        // per-device scoping is verified separately in an integration test (deferred — needs live DB).
        var now = DateTime.UtcNow;
        var user = MakeVerifiedUser(now);
        var repo = new CapturingRefreshTokenRepository();

        var handler = new LoginHandler(
            new SingleUserRepository(user),
            repo,
            new AlwaysTrueHasher(),
            new FakeJwt(),
            new GuidIdGenerator(),
            new FakeClock(now));

        await handler.HandleAsync(new LoginCommand("8888888888", "password", DeviceA));

        // Handler MUST call per-device revoke with the current device id.
        repo.RevokedDeviceIds.Should().ContainSingle().Which.Should().Be("device-A",
            "handler must revoke sessions for device-A only (per-device, not bulk)");

        // Handler must NOT call RevokeAllForUserAsync — that would log out every device.
        repo.RevokeAllCalled.Should().BeFalse(
            "login must only revoke the current device; RevokeAllForUserAsync must not be called");
    }

    [Fact]
    public async Task Login_stores_token_hash_not_raw_token_in_added_row()
    {
        var now = DateTime.UtcNow;
        var user = MakeVerifiedUser(now);
        var repo = new CapturingRefreshTokenRepository();

        var handler = new LoginHandler(
            new SingleUserRepository(user),
            repo,
            new AlwaysTrueHasher(),
            new FakeJwt(rawRefreshToken: "raw-token-xyz"),
            new GuidIdGenerator(),
            new FakeClock(now));

        await handler.HandleAsync(new LoginCommand("8888888888", "password", DeviceA));

        var added = repo.AddedToken;
        added.Should().NotBeNull();
        added!.TokenHash.Should().NotBe("raw-token-xyz", "raw token must NOT be stored");
        added.TokenHash.Should().Be(RefreshTokenHasher.Hash("raw-token-xyz"), "token_hash must be SHA-256 hex of raw token");
    }

    [Fact]
    public async Task Login_stores_device_metadata_in_added_row()
    {
        var now = DateTime.UtcNow;
        var user = MakeVerifiedUser(now);
        var repo = new CapturingRefreshTokenRepository();

        var handler = new LoginHandler(
            new SingleUserRepository(user),
            repo,
            new AlwaysTrueHasher(),
            new FakeJwt(),
            new GuidIdGenerator(),
            new FakeClock(now));

        await handler.HandleAsync(new LoginCommand("8888888888", "password", DeviceA));

        var added = repo.AddedToken;
        added.Should().NotBeNull();
        added!.DeviceId.Should().Be("device-A");
        added.DeviceName.Should().Be("Phone A");
        added.Platform.Should().Be("android");
    }

    // ---- fakes ----

    private static DomainUser MakeVerifiedUser(DateTime now)
    {
        var user = DomainUser.Register(
            new UserId(Guid.NewGuid()),
            DomainPhone.Create("8888888888"),
            "Test User",
            "stored-hash",
            now);
        user.MarkPhoneVerified(now);
        return user;
    }

    private sealed class FakeClock(DateTime now) : IClock { public DateTime UtcNow => now; }

    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class AlwaysTrueHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "hash";
        public bool Verify(string plainText, string hash) => true;
    }

    private sealed class FakeJwt(string rawRefreshToken = "refresh") : IJwtTokenService
    {
        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified)
            => new("access", rawRefreshToken, DateTime.UtcNow.AddMinutes(15));

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified)
            => new("access", rawRefreshToken, DateTime.UtcNow.AddMinutes(15));
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingRefreshTokenRepository : IRefreshTokenRepository
    {
        public List<string> RevokedDeviceIds { get; } = [];
        public DomainRefreshToken? AddedToken { get; private set; }
        /// <summary>
        /// Set to true if RevokeAllForUserAsync is called. A login must never trigger this.
        /// </summary>
        public bool RevokeAllCalled { get; private set; }

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            AddedToken = refreshToken;
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            RevokedDeviceIds.Add(deviceId);
            return Task.CompletedTask;
        }

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
        {
            RevokeAllCalled = true;
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
