using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using User.Application.Ports;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Identity;
using User.Domain.Security;
using Xunit;
using DomainUser = global::User.Domain.Identity.User;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// spec I19 (pre-launch repair, D-23) — an SMS sign-in on an existing account only marks the number
/// verified. It never clears a password, never changes the sign-in mode and never ends other
/// sessions: real owners sign in with a password too (the admin console accepts only phone +
/// password), and nothing in the data tells their password from a stranger's. Only a correct SMS
/// code verifies a number. (The same behaviour over real Postgres: PasswordBackDoorRealPostgresTests.)
/// </summary>
public sealed class SmsSignInOnPasswordAccountTests
{
    private const string Phone = "9876543210";
    private const string Otp = "123456";
    private const string OwnersPassword = "owners-password";
    private static readonly DeviceSessionRequest OwnersPhone = new("owners-phone", RememberDevice: true, DeviceName: "Owner", Platform: "android");

    [Fact]
    public async Task Sms_sign_in_on_a_password_account_keeps_the_password_usable_keeps_the_other_sessions_and_marks_the_number_verified()
    {
        var now = DateTime.UtcNow;
        var hasher = new FakeHasher();
        var owner = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create(Phone), "Owner", hasher.Hash(OwnersPassword), now.AddDays(-3));
        var passwordHashBefore = owner.Credential.PasswordHash;
        var tokens = new CapturingRefreshTokens();

        var result = await BuildVerify(owner, tokens, hasher, now).HandleAsync(new VerifyOtpCommand(Phone, Otp, null, OwnersPhone));

        result.IsSuccess.Should().BeTrue();
        owner.PhoneVerifiedAtUtc.Should().Be(now, "a correct SMS code verifies the number");
        owner.Credential.PasswordHash.Should().Be(passwordHashBefore, "the password is untouched");
        hasher.Verify(OwnersPassword, owner.Credential.PasswordHash).Should().BeTrue("the password still opens the account");
        owner.AuthMode.Should().Be(AuthMode.Password, "the sign-in mode is unchanged");
        tokens.RevokeAllReasons.Should().BeEmpty("no other session on the account is ended");
        tokens.RevokedDevices.Should().Equal("owners-phone");
        tokens.Added.Should().ContainSingle(t => t.DeviceId == "owners-phone");
    }

    [Fact]
    public async Task After_an_sms_sign_in_the_password_login_still_works_and_reports_the_verified_number()
    {
        var now = DateTime.UtcNow;
        var hasher = new FakeHasher();
        var owner = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create(Phone), "Owner", hasher.Hash(OwnersPassword), now.AddDays(-3));
        await BuildVerify(owner, new CapturingRefreshTokens(), hasher, now).HandleAsync(new VerifyOtpCommand(Phone, Otp, null, OwnersPhone));

        var jwt = new FakeJwt();
        var login = new LoginHandler(new SingleUserRepository(owner), new CapturingRefreshTokens(), hasher, jwt, new GuidIdGenerator(), new FakeClock(now.AddMinutes(5)));
        var result = await login.HandleAsync(new LoginCommand(Phone, OwnersPassword, new DeviceSessionRequest("admin-console", false, null, "web")));

        result.IsSuccess.Should().BeTrue("e.g. the admin console, which signs in only with phone + password");
        jwt.LastPhoneVerified.Should().BeTrue("the SMS sign-in verified the number");
    }

    [Fact]
    public async Task A_wrong_sms_code_changes_nothing()
    {
        var now = DateTime.UtcNow;
        var hasher = new FakeHasher();
        var owner = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create(Phone), "Owner", hasher.Hash(OwnersPassword), now.AddDays(-3));
        var tokens = new CapturingRefreshTokens();

        var result = await BuildVerify(owner, tokens, hasher, now).HandleAsync(new VerifyOtpCommand(Phone, "999999", null, OwnersPhone));

        result.IsSuccess.Should().BeFalse();
        owner.PhoneVerifiedAtUtc.Should().BeNull();
        hasher.Verify(OwnersPassword, owner.Credential.PasswordHash).Should().BeTrue();
        tokens.RevokeAllReasons.Should().BeEmpty();
        tokens.Added.Should().BeEmpty();
    }

    // ---- builder + hand-rolled fakes ----

    private static VerifyOtpHandler BuildVerify(DomainUser user, CapturingRefreshTokens tokens, FakeHasher hasher, DateTime now)
    {
        var challenge = OtpChallenge.Issue(Guid.NewGuid(), Phone, hasher.Hash(Otp), now.AddMinutes(-1), TimeSpan.FromMinutes(10), 5);
        return new VerifyOtpHandler(
            new OneChallengeRepository(challenge),
            new SingleUserRepository(user),
            tokens,
            hasher,
            new FakeJwt(),
            new GuidIdGenerator(),
            new FakeClock(now),
            NullLogger<VerifyOtpHandler>.Instance,
            new NoopAnalyticsWriter());
    }

    private sealed class FakeClock(DateTime now) : IClock { public DateTime UtcNow => now; }
    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class FakeHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "h:" + plainText;
        public bool Verify(string plainText, string hash) => hash == "h:" + plainText;
    }

    private sealed class FakeJwt : IJwtTokenService
    {
        public bool? LastPhoneVerified { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending)
        {
            LastPhoneVerified = phoneVerified;
            return new("access", Guid.NewGuid().ToString("N"), DateTime.UtcNow.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
        {
            LastPhoneVerified = phoneVerified;
            return new("access", Guid.NewGuid().ToString("N"), DateTime.UtcNow.AddMinutes(15));
        }
    }

    private sealed class SingleUserRepository(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class OneChallengeRepository(OtpChallenge challenge) : IOtpChallengeRepository
    {
        public Task<OtpChallenge?> GetPendingByPhoneAsync(string p, CancellationToken ct = default) => Task.FromResult<OtpChallenge?>(challenge);
        public Task AddAsync(OtpChallenge c, CancellationToken ct = default) => Task.CompletedTask;
        public Task<int> CountIssuedSinceAsync(string p, DateTime since, CancellationToken ct = default) => Task.FromResult(0);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingRefreshTokens : IRefreshTokenRepository
    {
        public List<DomainRefreshToken> Added { get; } = [];
        public List<string> RevokeAllReasons { get; } = [];
        public List<string> RevokedDevices { get; } = [];
        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);
        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default) { Added.Add(refreshToken); return Task.CompletedTask; }
        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            RevokedDevices.Add(deviceId);
            return Task.CompletedTask;
        }
        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
            => Task.CompletedTask; // lane FIX-1: never reached here (every phone counts as known)
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
        {
            RevokeAllReasons.Add(reason);
            return Task.CompletedTask;
        }
        // lane NP-1: every phone counts as known here (these tests are about sessions, not the new-phone question).
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult(true);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
