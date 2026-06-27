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
/// Device-session tests for LoginHandler (Task 2.2):
/// - Device A login does NOT revoke Device B sessions
/// - Same-device login revokes only the prior same-device session
/// - Created row stores hash (not raw token) and device metadata
/// </summary>
public class LoginHandlerDeviceSessionTests
{
    private static readonly DeviceSessionRequest DeviceA =
        new("device-A", RememberDevice: true, DeviceName: "Phone A", Platform: "android");

    private static readonly DeviceSessionRequest DeviceB =
        new("device-B", RememberDevice: true, DeviceName: "Phone B", Platform: "web");

    [Fact]
    public async Task Login_on_device_A_revokes_only_device_A_sessions_not_device_B()
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

        repo.RevokedDeviceIds.Should().ContainSingle().Which.Should().Be("device-A",
            "only device A should have its session revoked");
        repo.RevokedDeviceIds.Should().NotContain("device-B");
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

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);

        public Task<DomainRefreshToken?> GetActiveForUserDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);

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

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
