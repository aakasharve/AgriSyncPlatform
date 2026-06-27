using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Security;
using Xunit;
using DomainUser = global::User.Domain.Identity.User;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// Device-session tests for VerifyOtpHandler (Task 2.2):
/// - Same-device OTP revokes only the prior same-device session
/// - Other-device sessions are preserved
/// - Created row stores hash and device metadata
/// </summary>
public class VerifyOtpDeviceSessionTests
{
    private const string Phone = "9999999999";
    private const string OtpCode = "1234";

    private static readonly DeviceSessionRequest DeviceA =
        new("device-A", RememberDevice: true, DeviceName: "Web Browser", Platform: "web");

    [Fact]
    public async Task Verify_otp_revokes_only_same_device_session_not_other_devices()
    {
        var now = DateTime.UtcNow;
        var (handler, repo, _) = BuildHandler(now, Phone);

        await handler.HandleAsync(new VerifyOtpCommand(Phone, OtpCode, null, DeviceA));

        repo.RevokedDeviceIds.Should().ContainSingle().Which.Should().Be("device-A");
        repo.RevokedDeviceIds.Should().NotContain("device-B");
    }

    [Fact]
    public async Task Verify_otp_stores_token_hash_not_raw_token()
    {
        var now = DateTime.UtcNow;
        const string rawToken = "raw-otp-refresh";
        var (handler, repo, _) = BuildHandler(now, Phone, rawRefreshToken: rawToken);

        await handler.HandleAsync(new VerifyOtpCommand(Phone, OtpCode, null, DeviceA));

        var added = repo.AddedToken;
        added.Should().NotBeNull();
        added!.TokenHash.Should().Be(RefreshTokenHasher.Hash(rawToken));
        added.TokenHash.Should().NotBe(rawToken);
    }

    [Fact]
    public async Task Verify_otp_stores_device_metadata_in_added_row()
    {
        var now = DateTime.UtcNow;
        var (handler, repo, _) = BuildHandler(now, Phone);

        await handler.HandleAsync(new VerifyOtpCommand(Phone, OtpCode, null, DeviceA));

        var added = repo.AddedToken;
        added.Should().NotBeNull();
        added!.DeviceId.Should().Be("device-A");
        added.DeviceName.Should().Be("Web Browser");
        added.Platform.Should().Be("web");
    }

    // ---- builder ----

    private static (VerifyOtpHandler Handler, CapturingRefreshTokenRepository Repo, DomainUser User)
        BuildHandler(DateTime now, string phone, string rawRefreshToken = "refresh-token")
    {
        var user = DomainUser.Register(
            new UserId(Guid.NewGuid()),
            DomainPhone.Create(phone),
            "Test User",
            "hash",
            now);

        var otpRepo = new SucceedingOtpRepository(phone, now);
        var userRepo = new SingleUserRepository(user);
        var repo = new CapturingRefreshTokenRepository();
        var hasher = new AlwaysTrueHasher();
        var jwt = new FakeJwt(rawRefreshToken);
        var analytics = new NoopAnalyticsWriter();
        var logger = NullLogger<VerifyOtpHandler>.Instance;

        var handler = new VerifyOtpHandler(otpRepo, userRepo, repo, hasher, jwt,
            new GuidIdGenerator(), new FakeClock(now), logger, analytics);

        return (handler, repo, user);
    }

    // ---- fakes ----

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

    private sealed class SucceedingOtpRepository(string phone, DateTime now) : IOtpChallengeRepository
    {
        private readonly OtpChallenge _challenge = OtpChallenge.Issue(
            Guid.NewGuid(), phone, "hash", now, TimeSpan.FromMinutes(10), 5);

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string p, CancellationToken ct = default)
            => Task.FromResult<OtpChallenge?>(_challenge);

        public Task AddAsync(OtpChallenge c, CancellationToken ct = default) => Task.CompletedTask;
        public Task<int> CountIssuedSinceAsync(string p, DateTime since, CancellationToken ct = default) => Task.FromResult(0);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingRefreshTokenRepository : IRefreshTokenRepository
    {
        public List<string> RevokedDeviceIds { get; } = [];
        public DomainRefreshToken? AddedToken { get; private set; }

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

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
