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

namespace UserAuthLoginTests;

/// <summary>
/// Covers the fix for spec bootstrap-phone-verified-password-login-2026-06-04:
/// the password sign-in path (internal test user only) must issue a token that
/// carries phone_verified=true, so /bootstrap/first-farm stops 403-ing with
/// "Verify your phone first." The seeded password user starts with a null
/// PhoneVerifiedAtUtc, so LoginHandler stamps it on a successful login.
/// </summary>
public class LoginHandlerPhoneVerifiedTests
{
    private static readonly DeviceSessionRequest DefaultSession =
        new("test-device", RememberDevice: false, DeviceName: null, Platform: "unknown");

    [Fact]
    public async Task Password_login_of_unverified_user_stamps_verified_and_token_carries_phone_verified()
    {
        var now = DateTime.UtcNow;
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create("8888888888"), "Test User", "stored-hash", now);
        user.PhoneVerifiedAtUtc.Should().BeNull("a password-seeded user starts unverified — this is the bug condition");

        var jwt = new CapturingJwtTokenService();
        var userRepo = new SingleUserRepository(user);
        var handler = new LoginHandler(userRepo, new NoopRefreshTokenRepository(), new AlwaysTrueHasher(), jwt, new GuidIdGenerator(), new FakeClock(now));

        var result = await handler.HandleAsync(new LoginCommand("8888888888", "Testuser@123", DefaultSession));

        result.IsSuccess.Should().BeTrue();
        user.PhoneVerifiedAtUtc.Should().NotBeNull("a successful password login stamps the internal test user phone-verified");
        userRepo.SaveChangesCalls.Should().BeGreaterThan(0, "the stamp must be persisted");
        jwt.LastPhoneVerified.Should().BeTrue("the password token must carry phone_verified=true so /bootstrap/first-farm passes");
    }

    [Fact]
    public async Task Already_verified_user_is_not_restamped_and_token_stays_verified()
    {
        var now = DateTime.UtcNow;
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create("8888888888"), "Test User", "stored-hash", now);
        user.MarkPhoneVerified(now.AddDays(-1));
        var stampedAt = user.PhoneVerifiedAtUtc;

        var jwt = new CapturingJwtTokenService();
        var handler = new LoginHandler(new SingleUserRepository(user), new NoopRefreshTokenRepository(), new AlwaysTrueHasher(), jwt, new GuidIdGenerator(), new FakeClock(now));

        var result = await handler.HandleAsync(new LoginCommand("8888888888", "Testuser@123", DefaultSession));

        result.IsSuccess.Should().BeTrue();
        user.PhoneVerifiedAtUtc.Should().Be(stampedAt, "an already-verified user must not be re-stamped");
        jwt.LastPhoneVerified.Should().BeTrue();
    }

    // ---- hand-rolled fakes (this project has no mocking library) ----

    private sealed class FakeClock(DateTime now) : IClock { public DateTime UtcNow => now; }

    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class AlwaysTrueHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "hash";
        public bool Verify(string plainText, string hash) => true;
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public int SaveChangesCalls { get; private set; }
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) { SaveChangesCalls++; return Task.CompletedTask; }
    }

    private sealed class NoopRefreshTokenRepository : IRefreshTokenRepository
    {
        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);
        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingJwtTokenService : IJwtTokenService
    {
        public bool? LastPhoneVerified { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified)
        {
            LastPhoneVerified = phoneVerified;
            return new TokenPair("access", "refresh", DateTime.UtcNow.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified)
            => new("access", "refresh", DateTime.UtcNow.AddMinutes(15));
    }
}
