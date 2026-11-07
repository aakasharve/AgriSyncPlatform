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
/// spec I19 (pre-launch repair, D-23) — supersedes bootstrap-phone-verified-password-login-2026-06-04.
/// A password login NEVER marks a number verified: only a correct SMS code does. The founder's test
/// users stay verified because their seeders mark them verified on purpose (covered for the real
/// seeders by the real-Postgres SeededDemoLoginRealPostgresTests).
/// </summary>
public class LoginHandlerPhoneVerifiedTests
{
    private static readonly DeviceSessionRequest DefaultSession =
        new("test-device", RememberDevice: false, DeviceName: null, Platform: "unknown");

    [Fact]
    public async Task Password_login_never_marks_the_number_verified()
    {
        var now = DateTime.UtcNow;
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create("9876543210"), "Stranger", "stored-hash", now);
        user.PhoneVerifiedAtUtc.Should().BeNull("a password-registered number starts unverified");

        var jwt = new CapturingJwtTokenService();
        var userRepo = new SingleUserRepository(user);
        var handler = new LoginHandler(userRepo, new NoopRefreshTokenRepository(), new AlwaysTrueHasher(), jwt, new GuidIdGenerator(), new FakeClock(now));

        var result = await handler.HandleAsync(new LoginCommand("9876543210", "any-password", DefaultSession));

        result.IsSuccess.Should().BeTrue("the password still opens the account it belongs to");
        user.PhoneVerifiedAtUtc.Should().BeNull("a password proves nothing about who holds the phone");
        userRepo.SaveChangesCalls.Should().Be(0, "nothing about the user is written by a password login");
        jwt.LastPhoneVerified.Should().BeFalse("the token must not claim phone_verified=true");
    }

    [Fact]
    public async Task A_number_verified_on_purpose_stays_verified_after_a_password_login()
    {
        var now = DateTime.UtcNow;
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create("8888888888"), "Test User", "stored-hash", now);
        user.MarkPhoneVerified(now.AddDays(-1)); // what the demo seeders now do
        var stampedAt = user.PhoneVerifiedAtUtc;

        var jwt = new CapturingJwtTokenService();
        var handler = new LoginHandler(new SingleUserRepository(user), new NoopRefreshTokenRepository(), new AlwaysTrueHasher(), jwt, new GuidIdGenerator(), new FakeClock(now));

        var result = await handler.HandleAsync(new LoginCommand("8888888888", "Testuser@123", DefaultSession));

        result.IsSuccess.Should().BeTrue();
        user.PhoneVerifiedAtUtc.Should().Be(stampedAt, "a login does not re-stamp");
        jwt.LastPhoneVerified.Should().BeTrue("the seeded demo user keeps working on the PC test stack");
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
        // lane NP-1: every phone counts as known here (these tests are about sessions, not the new-phone question).
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult(true);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingJwtTokenService : IJwtTokenService
    {
        public bool? LastPhoneVerified { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending)
        {
            LastPhoneVerified = phoneVerified;
            return new TokenPair("access", "refresh", DateTime.UtcNow.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
            => new("access", "refresh", DateTime.UtcNow.AddMinutes(15));
    }
}
