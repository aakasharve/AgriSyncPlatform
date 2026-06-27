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
/// Handler-behaviour tests for VerifyOtpHandler device-session management.
///
/// These tests verify what the HANDLER calls on the repository fake — they do
/// NOT test the EF predicate or real database isolation (that requires a live
/// User DB; deferred as an integration-test follow-up).
///
/// Verified handler contracts:
/// - OTP verify calls RevokeActiveForUserDeviceAsync for the current device.
/// - OTP verify does NOT call RevokeAllForUserAsync (only per-device revoke, never bulk).
/// - Created row stores token hash (not raw token) and device metadata.
///
/// DEFERRED: EF integration test verifying t.DeviceId == deviceId predicate
/// in RefreshTokenRepository.RevokeActiveForUserDeviceAsync against a live DB.
/// </summary>
public class VerifyOtpDeviceSessionTests
{
    private const string Phone = "9999999999";
    private const string OtpCode = "1234";

    private static readonly DeviceSessionRequest DeviceA =
        new("device-A", RememberDevice: true, DeviceName: "Web Browser", Platform: "web");

    [Fact]
    public async Task Verify_otp_calls_per_device_revoke_for_current_device_and_never_revoke_all()
    {
        // Verifies handler behaviour: VerifyOtpHandler calls RevokeActiveForUserDeviceAsync(deviceId)
        // and does NOT call RevokeAllForUserAsync. The EF predicate that enforces row-level
        // per-device scoping is verified separately in an integration test (deferred — needs live DB).
        var now = DateTime.UtcNow;
        var (handler, repo, _) = BuildHandler(now, Phone);

        await handler.HandleAsync(new VerifyOtpCommand(Phone, OtpCode, null, DeviceA));

        // Handler MUST call per-device revoke with the current device id.
        repo.RevokedDeviceIds.Should().ContainSingle().Which.Should().Be("device-A",
            "handler must revoke sessions for device-A only (per-device, not bulk)");

        // Handler must NOT call RevokeAllForUserAsync — that would log out every device.
        repo.RevokeAllCalled.Should().BeFalse(
            "OTP verify must only revoke the current device; RevokeAllForUserAsync must not be called");
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
        /// <summary>
        /// Set to true if RevokeAllForUserAsync is called. OTP verify must never trigger this.
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

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
