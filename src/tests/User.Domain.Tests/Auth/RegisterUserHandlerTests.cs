using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.Extensions.Options;
using User.Application.Ports;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.Session;
using User.Domain.Common;
using Xunit;
using DomainUser = global::User.Domain.Identity.User;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;

namespace UserDomainTests.Auth;

/// <summary>
/// spec I19 (pre-launch repair, D-23; founder 26 Oct: "the password login was made for trial and
/// test purpose only") — the password sign-up back door. Negative tests for every way in: closed by
/// default, a chosen role is refused (and never applied — no membership is written), and an account
/// that does get in when the test-only switch is on is NOT phone-verified.
/// </summary>
public sealed class RegisterUserHandlerTests
{
    private static readonly DeviceSessionRequest Session = new("device-A", RememberDevice: false, DeviceName: null, Platform: "web");

    [Fact]
    public async Task Password_sign_up_is_closed_by_default_and_refused_with_a_typed_error()
    {
        var options = new PasswordRegistrationOptions();
        options.AllowPasswordRegistration.Should().BeFalse("closed is the default everywhere");
        var (handler, users, tokens, jwt) = Build(options);

        var result = await handler.HandleAsync(new RegisterUserCommand("9876543210", "pw-123456", "Stranger", Session: Session));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("auth.password_registration_closed");
        result.Error.Kind.Should().Be(ErrorKind.Forbidden, "the endpoint answers 403");
        users.Added.Should().BeEmpty("no account is created");
        tokens.Added.Should().BeEmpty("no session is created");
        jwt.Calls.Should().Be(0, "no token is issued");
    }

    [Theory]
    [InlineData("PrimaryOwner")]
    [InlineData("LabOperator")]
    [InlineData("Worker")]
    public async Task A_chosen_role_is_refused_even_when_the_test_switch_is_on(string role)
    {
        var (handler, users, tokens, jwt) = Build(new PasswordRegistrationOptions { AllowPasswordRegistration = true });

        var result = await handler.HandleAsync(new RegisterUserCommand("9876543210", "pw-123456", "Stranger", role, Session));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("auth.register_role_not_allowed");
        users.Added.Should().BeEmpty();
        tokens.Added.Should().BeEmpty();
        jwt.Calls.Should().Be(0);
    }

    [Fact]
    public async Task Closed_wins_over_a_role_field()
    {
        var (handler, _, _, _) = Build(new PasswordRegistrationOptions());

        var result = await handler.HandleAsync(new RegisterUserCommand("9876543210", "pw-123456", "Stranger", "PrimaryOwner", Session));

        result.Error.Code.Should().Be("auth.password_registration_closed");
    }

    [Fact]
    public async Task With_the_test_switch_on_the_account_gets_no_role_and_is_not_phone_verified()
    {
        var (handler, users, tokens, jwt) = Build(new PasswordRegistrationOptions { AllowPasswordRegistration = true });

        var result = await handler.HandleAsync(new RegisterUserCommand("9876543210", "pw-123456", "Test Person", Session: Session));

        result.IsSuccess.Should().BeTrue();
        var user = users.Added.Should().ContainSingle().Subject;
        user.Memberships.Should().BeEmpty("no app membership → the role is the plain default, exactly like an SMS account");
        user.PhoneVerifiedAtUtc.Should().BeNull("only an SMS code verifies a number");
        jwt.LastPhoneVerified.Should().BeFalse("the token must not claim phone_verified=true");
        jwt.LastMemberships.Should().BeEmpty("the token carries no role claim");
        tokens.Added.Should().ContainSingle();
    }

    // ---- builder + hand-rolled fakes (this project has no mocking library) ----

    private static (RegisterUserHandler Handler, CapturingUserRepository Users, CapturingRefreshTokens Tokens, CapturingJwt Jwt)
        Build(PasswordRegistrationOptions options)
    {
        var users = new CapturingUserRepository();
        var tokens = new CapturingRefreshTokens();
        var jwt = new CapturingJwt();
        var handler = new RegisterUserHandler(users, tokens, new FakeHasher(), jwt, new GuidIdGenerator(), new FakeClock(DateTime.UtcNow), Options.Create(options));
        return (handler, users, tokens, jwt);
    }

    private sealed class FakeClock(DateTime now) : IClock { public DateTime UtcNow => now; }
    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class FakeHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "h:" + plainText;
        public bool Verify(string plainText, string hash) => hash == "h:" + plainText;
    }

    private sealed class CapturingUserRepository : IUserRepository
    {
        public List<DomainUser> Added { get; } = [];
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(null);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(null);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(false);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) { Added.Add(u); return Task.CompletedTask; }
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingRefreshTokens : IRefreshTokenRepository
    {
        public List<DomainRefreshToken> Added { get; } = [];
        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) => Task.FromResult<DomainRefreshToken?>(null);
        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default) { Added.Add(refreshToken); return Task.CompletedTask; }
        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;
        // lane NP-1: every phone counts as known here (these tests are about sessions, not the new-phone question).
        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) => Task.FromResult(true);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingJwt : IJwtTokenService
    {
        public int Calls { get; private set; }
        public bool? LastPhoneVerified { get; private set; }
        public IReadOnlyCollection<MembershipClaim>? LastMemberships { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending)
        {
            Calls++;
            LastPhoneVerified = phoneVerified;
            LastMemberships = memberships;
            return new TokenPair("access", "refresh", DateTime.UtcNow.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
        {
            Calls++;
            LastPhoneVerified = phoneVerified;
            return new TokenPair("access", "refresh", DateTime.UtcNow.AddMinutes(15));
        }
    }
}
