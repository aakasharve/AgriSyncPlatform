// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56, CTO call D-85)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using User.Application.Ports;
using User.Application.UseCases.Auth.DeviceCheck;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Security;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainRefreshToken = global::User.Domain.Security.RefreshToken;
using DomainUser = global::User.Domain.Identity.User;

namespace UserDomainTests.Auth;

/// <summary>
/// Lane NP-1 — the new-phone question in the sign-in handlers and the answer handler, with hand-rolled fakes. The
/// same rules over real Postgres and HTTP: <c>NewPhoneQuestionRealPostgresTests</c>.
/// </summary>
public sealed class NewPhoneQuestionTests
{
    private const string Phone = "6000002001";
    private static readonly DateTime Now = new(2026, 11, 7, 6, 0, 0, DateTimeKind.Utc);

    // ── the session row ──

    [Fact]
    public void A_held_session_confirms_once_or_declines_once_and_nothing_else()
    {
        var held = Session("phone-1");
        held.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        held.IsHeldForDeviceCheck.Should().BeTrue();

        held.ConfirmDevice(Now);
        held.DeviceCheck.Should().BeNull("a confirmed phone is known: no state left");
        held.DeviceCheckAnsweredAtUtc.Should().Be(Now);
        held.IsActive(Now).Should().BeTrue("होय keeps the session");
        held.Invoking(t => t.ConfirmDevice(Now)).Should().Throw<InvalidOperationException>();
        held.Invoking(t => t.DeclineDevice(Now)).Should().Throw<InvalidOperationException>("a known phone can never carry the mark");

        var declined = Session("phone-2");
        declined.HoldForDeviceCheck(DeviceCheckState.AskedAfterPassword);
        declined.DeclineDevice(Now);
        declined.DeviceCheck.Should().Be(DeviceCheckState.Declined);
        declined.IsRevoked.Should().BeTrue();
        declined.RevocationReason.Should().Be("device_check_declined");
        declined.IsHeldForDeviceCheck.Should().BeFalse();
        declined.Invoking(t => t.ConfirmDevice(Now)).Should().Throw<InvalidOperationException>();

        Session("phone-3").Invoking(t => t.HoldForDeviceCheck(DeviceCheckState.Declined)).Should().Throw<ArgumentOutOfRangeException>();
    }

    [Theory]
    [InlineData("unknown", false)]
    [InlineData("UNKNOWN", false)]
    [InlineData("legacy", false)]
    [InlineData(" ", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("3f0c2a5e-8d1b-4c11-9a2e-6b7f1d2c3a4b", true)]
    public void Only_a_real_install_id_names_a_phone(string? deviceId, bool namesAPhone) =>
        NewPhoneQuestion.NamesAPhone(deviceId).Should().Be(namesAPhone);

    // ── SMS sign-in ──

    [Fact]
    public async Task Sms_sign_in_on_a_new_phone_is_held_names_the_account_and_leaves_the_account_unchanged()
    {
        var user = ExistingUser(verifiedAt: Now.AddDays(-30));
        var sessions = new Sessions(known: []);
        var jwt = new CapturingJwt();

        var result = await Verify(user, sessions, jwt).HandleAsync(new VerifyOtpCommand(Phone, "123456", null, Device("new-phone")));

        result.IsSuccess.Should().BeTrue();
        result.Value!.DeviceCheckRequired.Should().BeTrue();
        result.Value.AccountName.Should().Be("रमेश");
        jwt.LastPending.Should().BeTrue("the token opens nothing");
        sessions.Added.Single().DeviceCheck.Should().Be(DeviceCheckState.AskedAfterSmsCode);
        user.PhoneVerifiedAtUtc.Should().Be(Now.AddDays(-30), "the stamp waits for होय (D-85)");
    }

    [Fact]
    public async Task Sms_sign_in_on_a_known_phone_is_never_held_and_says_no_name()
    {
        var user = ExistingUser(verifiedAt: Now.AddDays(-30));
        var sessions = new Sessions(known: ["own-phone"]);
        var jwt = new CapturingJwt();

        var result = await Verify(user, sessions, jwt).HandleAsync(new VerifyOtpCommand(Phone, "123456", null, Device("own-phone")));

        result.Value!.DeviceCheckRequired.Should().BeFalse();
        result.Value.AccountName.Should().BeNull();
        jwt.LastPending.Should().BeFalse();
        sessions.Added.Single().DeviceCheck.Should().BeNull();
        user.PhoneVerifiedAtUtc.Should().Be(Now);
    }

    [Fact]
    public async Task A_placeholder_id_is_held_even_when_a_row_with_it_exists()
    {
        var sessions = new Sessions(known: ["unknown"]);
        var result = await Verify(ExistingUser(), sessions, new CapturingJwt())
            .HandleAsync(new VerifyOtpCommand(Phone, "123456", null, Device("unknown")));
        result.Value!.DeviceCheckRequired.Should().BeTrue("anyone can send 'unknown'");
    }

    [Fact]
    public async Task The_phone_that_makes_the_account_is_never_held()
    {
        var sessions = new Sessions(known: []);
        var jwt = new CapturingJwt();
        var handler = new VerifyOtpHandler(new SucceedingOtp(Phone), new NoUser(), sessions, new TrueHasher(), jwt,
            new GuidIds(), new FixedClock(Now), NullLogger<VerifyOtpHandler>.Instance, new NoAnalytics());

        var result = await handler.HandleAsync(new VerifyOtpCommand(Phone, "123456", "नवा शेतकरी", Device("first-phone")));

        result.Value!.CreatedNewUser.Should().BeTrue();
        result.Value.DeviceCheckRequired.Should().BeFalse("there is no one else to ask about a brand-new account");
        jwt.LastPending.Should().BeFalse();
        sessions.Added.Single().DeviceCheck.Should().BeNull("so this phone is known from now on");
    }

    // ── password sign-in (test only) ──

    [Fact]
    public async Task Password_sign_in_is_held_on_a_new_phone_but_never_when_no_phone_is_named()
    {
        var user = ExistingUser();
        var newPhone = await Login(user, new Sessions(known: [])).HandleAsync(new LoginCommand(Phone, "pw", Device("new-phone")));
        newPhone.Value.DeviceCheckRequired.Should().BeTrue();
        newPhone.Value.AccountName.Should().Be("रमेश");

        var console = await Login(user, new Sessions(known: [])).HandleAsync(new LoginCommand(Phone, "pw", Device("unknown")));
        console.Value.DeviceCheckRequired.Should().BeFalse("the admin console names no phone; the password is the proof there");
    }

    // ── refresh ──

    [Fact]
    public async Task A_held_sessions_refresh_stays_held_and_a_known_ones_is_not()
    {
        var user = ExistingUser();
        var held = Session("p", "raw-held");
        held.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        var sessions = new Sessions(known: [], byHash: held);
        var jwt = new CapturingJwt();

        var refreshed = await new RefreshTokenHandler(new OneUser(user), sessions, jwt, new GuidIds(), new FixedClock(Now))
            .HandleAsync(new RefreshTokenCommand("raw-held", Device("p")));

        refreshed.Value.DeviceCheckRequired.Should().BeTrue();
        jwt.LastPending.Should().BeTrue();
        sessions.Added.Single().DeviceCheck.Should().Be(DeviceCheckState.AskedAfterSmsCode, "the hold rides the rotation");

        var known = Session("p2", "raw-known");
        var knownSessions = new Sessions(known: [], byHash: known);
        var jwt2 = new CapturingJwt();
        (await new RefreshTokenHandler(new OneUser(user), knownSessions, jwt2, new GuidIds(), new FixedClock(Now))
            .HandleAsync(new RefreshTokenCommand("raw-known", Device("p2")))).Value.DeviceCheckRequired.Should().BeFalse();
        jwt2.LastPending.Should().BeFalse();
    }

    // ── the answer ──

    [Fact]
    public async Task Hoy_after_an_sms_sign_in_confirms_the_phone_stamps_the_number_and_opens_the_account()
    {
        var user = ExistingUser(verifiedAt: Now.AddDays(-30));
        var held = Session("new-phone", "raw");
        held.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        var sessions = new Sessions(known: [], byHash: held);
        var jwt = new CapturingJwt();

        var result = await Answer(user, sessions, jwt).HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: true));

        result.Value.Confirmed.Should().BeTrue();
        result.Value.AccessToken.Should().Be("access");
        jwt.LastPending.Should().BeFalse("the token after होय opens the account");
        held.DeviceCheck.Should().BeNull();
        held.IsActive(Now).Should().BeTrue();
        user.PhoneVerifiedAtUtc.Should().Be(Now);
        sessions.RevokedDevices.Should().BeEmpty();
    }

    [Fact]
    public async Task Hoy_after_a_password_sign_in_never_verifies_the_number()
    {
        var user = ExistingUser(verifiedAt: null);
        var held = Session("new-phone", "raw");
        held.HoldForDeviceCheck(DeviceCheckState.AskedAfterPassword);

        var result = await Answer(user, new Sessions(known: [], byHash: held), new CapturingJwt())
            .HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: true));

        result.Value.Confirmed.Should().BeTrue();
        user.PhoneVerifiedAtUtc.Should().BeNull("I19: only an SMS code verifies a number");
    }

    [Fact]
    public async Task Nahi_ends_only_this_phones_session_and_changes_nothing_in_the_account()
    {
        var user = ExistingUser(verifiedAt: Now.AddDays(-30));
        var held = Session("strangers-phone", "raw");
        held.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        var sessions = new Sessions(known: ["owners-phone"], byHash: held);

        var result = await Answer(user, sessions, new CapturingJwt()).HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: false));

        result.Value.Confirmed.Should().BeFalse();
        result.Value.AccessToken.Should().BeNull();
        held.DeviceCheck.Should().Be(DeviceCheckState.Declined);
        held.IsRevoked.Should().BeTrue();
        sessions.RevokedDevices.Should().Equal("strangers-phone");
        sessions.RevokeAllCalls.Should().Be(0, "a stranger's tap never signs the owner's phones out");
        user.PhoneVerifiedAtUtc.Should().Be(Now.AddDays(-30));
    }

    [Fact]
    public async Task Nahi_from_a_phone_that_is_not_asked_is_refused_and_a_dead_session_answers_nothing()
    {
        var user = ExistingUser();
        var known = Session("own-phone", "raw");
        var notAsked = await Answer(user, new Sessions(known: [], byHash: known), new CapturingJwt())
            .HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: false));
        notAsked.IsSuccess.Should().BeFalse();
        notAsked.Error.Code.Should().Be("auth.device_check_not_asked");
        known.DeviceCheck.Should().BeNull("no mark on a known phone");

        // A retried होय on an already-known phone just opens it again.
        (await Answer(user, new Sessions(known: [], byHash: known), new CapturingJwt())
            .HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: true))).Value.Confirmed.Should().BeTrue();

        var gone = await Answer(user, new Sessions(known: [], byHash: null), new CapturingJwt())
            .HandleAsync(new AnswerDeviceCheckCommand("raw", ItIsMe: true));
        gone.Error.Code.Should().Be("User.InvalidRefreshToken");
    }

    // ── builders and fakes ──

    private static DeviceSessionRequest Device(string id) => new(id, RememberDevice: true, DeviceName: id, Platform: "android");

    private static DomainRefreshToken Session(string deviceId, string raw = "raw") =>
        new(Guid.NewGuid(), new UserId(Guid.NewGuid()), RefreshTokenHasher.Hash(raw), deviceId, deviceId, "android", Now.AddMinutes(-5), Now.AddDays(30));

    private static DomainUser ExistingUser(DateTime? verifiedAt = null)
    {
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create(Phone), "रमेश", "hash", Now.AddDays(-60));
        if (verifiedAt is { } at)
        {
            user.MarkPhoneVerified(at);
        }

        return user;
    }

    private static VerifyOtpHandler Verify(DomainUser user, Sessions sessions, CapturingJwt jwt) =>
        new(new SucceedingOtp(Phone), new OneUser(user), sessions, new TrueHasher(), jwt,
            new GuidIds(), new FixedClock(Now), NullLogger<VerifyOtpHandler>.Instance, new NoAnalytics());

    private static LoginHandler Login(DomainUser user, Sessions sessions) =>
        new(new OneUser(user), sessions, new TrueHasher(), new CapturingJwt(), new GuidIds(), new FixedClock(Now));

    private static AnswerDeviceCheckHandler Answer(DomainUser user, Sessions sessions, CapturingJwt jwt) =>
        new(sessions, new OneUser(user), jwt, new FixedClock(Now), NullLogger<AnswerDeviceCheckHandler>.Instance);

    private sealed class Sessions(string[] known, DomainRefreshToken? byHash = null) : IRefreshTokenRepository
    {
        public List<DomainRefreshToken> Added { get; } = [];
        public List<string> RevokedDevices { get; } = [];
        public int RevokeAllCalls { get; private set; }

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) =>
            Task.FromResult(byHash is not null && byHash.TokenHash == tokenHash ? byHash : null);

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            Added.Add(refreshToken);
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            RevokedDevices.Add(deviceId);
            return Task.CompletedTask;
        }

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
        {
            RevokeAllCalls++;
            return Task.CompletedTask;
        }

        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) =>
            Task.FromResult(known.Contains(deviceId));

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class CapturingJwt : IJwtTokenService
    {
        public bool? LastPending { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending)
        {
            LastPending = deviceCheckPending;
            return new TokenPair("access", Guid.NewGuid().ToString("N"), Now.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
        {
            LastPending = deviceCheckPending;
            return new TokenPair("access", Guid.NewGuid().ToString("N"), Now.AddMinutes(15));
        }
    }

    private sealed class OneUser(DomainUser user) : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(user);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(true);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NoUser : IUserRepository
    {
        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<DomainUser?>(null);
        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult<DomainUser?>(null);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) => Task.FromResult(false);
        public Task AddAsync(DomainUser u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class SucceedingOtp(string phone) : IOtpChallengeRepository
    {
        private readonly OtpChallenge _challenge = OtpChallenge.Issue(Guid.NewGuid(), phone, "hash", Now, TimeSpan.FromMinutes(10), 5);

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string p, CancellationToken ct = default) => Task.FromResult<OtpChallenge?>(_challenge);
        public Task AddAsync(OtpChallenge c, CancellationToken ct = default) => Task.CompletedTask;
        public Task<int> CountIssuedSinceAsync(string p, DateTime since, CancellationToken ct = default) => Task.FromResult(0);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class TrueHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "hash";
        public bool Verify(string plainText, string hash) => true;
    }

    private sealed class FixedClock(DateTime now) : IClock { public DateTime UtcNow => now; }
    private sealed class GuidIds : IIdGenerator { public Guid New() => Guid.NewGuid(); }

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
