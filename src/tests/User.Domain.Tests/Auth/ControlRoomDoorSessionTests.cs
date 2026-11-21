// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A6, H10)
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth;
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
/// H10, the session mark. A session that began at the control room's own sign-in page (the door) is stored under the
/// reserved platform <see cref="ControlRoomSessionClaims.SessionPlatform"/>, and only such a session's tokens are issued
/// with the mark. The farmer routes can never ask for it: <see cref="DeviceSessionPlatform.FromClient"/> turns the reserved
/// name into <c>unknown</c>. Hand-rolled fakes in the style of <c>NewPhoneQuestionTests</c>.
/// </summary>
public sealed class ControlRoomDoorSessionTests
{
    private const string Phone = "9000000301";
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task A_code_checked_at_the_door_gives_a_marked_token()
    {
        var sessions = new Sessions(known: ["console-1"]);
        var jwt = new CapturingJwt();

        var result = await Verify(ExistingUser(), sessions, jwt)
            .HandleAsync(new VerifyOtpCommand(Phone, "123456", null, Door("console-1")));

        result.IsSuccess.Should().BeTrue();
        jwt.LastDoor.Should().BeTrue("a session born at the door is issued with the mark");
        sessions.Added.Single().Platform.Should().Be(ControlRoomSessionClaims.SessionPlatform);

        // The control: the same handler, a farmer's platform.
        var farmerSessions = new Sessions(known: ["phone-1"]);
        var farmerJwt = new CapturingJwt();
        await Verify(ExistingUser(), farmerSessions, farmerJwt)
            .HandleAsync(new VerifyOtpCommand(Phone, "123456", null, Farmer("phone-1", "android")));
        farmerJwt.LastDoor.Should().BeFalse("a farmer's code sign-in is never marked");
        farmerSessions.Added.Single().Platform.Should().Be("android");
    }

    [Fact]
    public async Task Refreshing_a_door_session_keeps_the_mark()
    {
        var door = Session("console-1", "raw-door", ControlRoomSessionClaims.SessionPlatform);
        var sessions = new Sessions(known: [], byHash: door);
        var jwt = new CapturingJwt();

        // The refresh request names a farmer's platform: the stored row decides, never the request.
        var refreshed = await new RefreshTokenHandler(new OneUser(ExistingUser()), sessions, jwt, new GuidIds(), new FixedClock(Now))
            .HandleAsync(new RefreshTokenCommand("raw-door", Farmer("console-1", "web")));

        refreshed.IsSuccess.Should().BeTrue();
        jwt.LastDoor.Should().BeTrue("the mark rides every refresh of a door session");
        sessions.Added.Single().Platform.Should().Be(ControlRoomSessionClaims.SessionPlatform, "the new row copies the old row's platform");
    }

    [Theory]
    [InlineData("android")]
    [InlineData("web")]
    [InlineData("unknown")]
    public async Task Refreshing_a_farmer_session_never_marks_it(string platform)
    {
        var farmer = Session("phone-1", "raw-farmer", platform);
        var sessions = new Sessions(known: [], byHash: farmer);
        var jwt = new CapturingJwt();

        var refreshed = await new RefreshTokenHandler(new OneUser(ExistingUser()), sessions, jwt, new GuidIds(), new FixedClock(Now))
            .HandleAsync(new RefreshTokenCommand("raw-farmer", Door("phone-1")));

        refreshed.IsSuccess.Should().BeTrue();
        jwt.LastDoor.Should().BeFalse($"a {platform} session is never marked, whatever the refresh request says");
        sessions.Added.Single().Platform.Should().Be(platform);
    }

    [Fact]
    public async Task A_password_sign_in_is_never_marked()
    {
        var sessions = new Sessions(known: ["console-1"]);
        var jwt = new CapturingJwt();

        // Even a session request that names the reserved platform (no farmer route can build one, but the handler
        // itself never issues the mark either).
        var result = await new LoginHandler(new OneUser(ExistingUser()), sessions, new TrueHasher(), jwt, new GuidIds(), new FixedClock(Now))
            .HandleAsync(new LoginCommand(Phone, "password", Door("console-1")));

        result.IsSuccess.Should().BeTrue();
        jwt.Calls.Should().Be(1);
        jwt.LastDoor.Should().BeFalse("the password way never mints a marked session");
    }

    [Fact]
    public async Task Answering_the_new_phone_question_keeps_the_mark_of_a_door_session()
    {
        var user = ExistingUser(verifiedAt: Now.AddDays(-30));

        var heldDoor = Session("console-2", "raw-held", ControlRoomSessionClaims.SessionPlatform);
        heldDoor.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        var jwt = new CapturingJwt();
        var yes = await Answer(user, new Sessions(known: [], byHash: heldDoor), jwt)
            .HandleAsync(new AnswerDeviceCheckCommand("raw-held", ItIsMe: true));
        yes.Value!.Confirmed.Should().BeTrue();
        jwt.LastDoor.Should().BeTrue("'yes' on a door session opens a marked token");

        // A retried 'yes' on the now-known door session answers the same, still marked.
        var retriedJwt = new CapturingJwt();
        var retried = await Answer(user, new Sessions(known: [], byHash: heldDoor), retriedJwt)
            .HandleAsync(new AnswerDeviceCheckCommand("raw-held", ItIsMe: true));
        retried.Value!.Confirmed.Should().BeTrue();
        retriedJwt.LastDoor.Should().BeTrue();

        // The control: the same answer on a farmer's phone session is never marked.
        var heldPhone = Session("phone-2", "raw-phone", "android");
        heldPhone.HoldForDeviceCheck(DeviceCheckState.AskedAfterSmsCode);
        var phoneJwt = new CapturingJwt();
        await Answer(user, new Sessions(known: [], byHash: heldPhone), phoneJwt)
            .HandleAsync(new AnswerDeviceCheckCommand("raw-phone", ItIsMe: true));
        phoneJwt.LastDoor.Should().BeFalse();
    }

    [Theory]
    [InlineData(" Control-Room-Door ", "unknown")]
    [InlineData("control-room-door", "unknown")]
    [InlineData("CONTROL-ROOM-DOOR", "unknown")]
    [InlineData("android", "android")]
    [InlineData(" web ", "web")]
    [InlineData(null, "unknown")]
    [InlineData("", "unknown")]
    [InlineData("   ", "unknown")]
    public void A_client_cannot_ask_for_the_reserved_platform(string? sent, string stored)
    {
        DeviceSessionPlatform.FromClient(sent).Should().Be(stored);
    }

    // ── builders and fakes ──

    private static DeviceSessionRequest Door(string deviceId) =>
        new(deviceId, RememberDevice: false, DeviceName: "Example: console", Platform: ControlRoomSessionClaims.SessionPlatform);

    private static DeviceSessionRequest Farmer(string deviceId, string platform) =>
        new(deviceId, RememberDevice: true, DeviceName: deviceId, Platform: platform);

    private static DomainRefreshToken Session(string deviceId, string raw, string platform) =>
        new(Guid.NewGuid(), new UserId(Guid.NewGuid()), RefreshTokenHasher.Hash(raw), deviceId, deviceId, platform, Now.AddMinutes(-5), Now.AddDays(30));

    private static DomainUser ExistingUser(DateTime? verifiedAt = null)
    {
        var user = DomainUser.Register(new UserId(Guid.NewGuid()), DomainPhone.Create(Phone), "Example: Asha", "hash", Now.AddDays(-60));
        if (verifiedAt is { } at)
        {
            user.MarkPhoneVerified(at);
        }

        return user;
    }

    private static VerifyOtpHandler Verify(DomainUser user, Sessions sessions, CapturingJwt jwt) =>
        new(new SucceedingOtp(Phone), new OneUser(user), sessions, new TrueHasher(), jwt,
            new GuidIds(), new FixedClock(Now), NullLogger<VerifyOtpHandler>.Instance, new NoAnalytics());

    private static AnswerDeviceCheckHandler Answer(DomainUser user, Sessions sessions, CapturingJwt jwt) =>
        new(sessions, new OneUser(user), jwt, new FixedClock(Now), NullLogger<AnswerDeviceCheckHandler>.Instance);

    private sealed class Sessions(string[] known, DomainRefreshToken? byHash = null) : IRefreshTokenRepository
    {
        public List<DomainRefreshToken> Added { get; } = [];

        public Task<DomainRefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default) =>
            Task.FromResult(byHash is not null && byHash.TokenHash == tokenHash ? byHash : null);

        public Task AddAsync(DomainRefreshToken refreshToken, CancellationToken ct = default)
        {
            Added.Add(refreshToken);
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;

        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default) => Task.CompletedTask;

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default) => Task.CompletedTask;

        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default) =>
            Task.FromResult(known.Contains(deviceId));

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    /// <summary>Remembers what the handler asked for; the mark is <see cref="LastDoor"/>.</summary>
    private sealed class CapturingJwt : IJwtTokenService
    {
        public bool? LastDoor { get; private set; }
        public int Calls { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false)
        {
            Calls++;
            LastDoor = controlRoomDoor;
            return new TokenPair("access", Guid.NewGuid().ToString("N"), Now.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending, bool controlRoomDoor = false)
        {
            Calls++;
            LastDoor = controlRoomDoor;
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

    private sealed class SucceedingOtp(string phone) : IOtpChallengeRepository
    {
        private readonly OtpChallenge _challenge = OtpChallenge.Issue(Guid.NewGuid(), phone, "hash", Now, TimeSpan.FromMinutes(10), 5);

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string p, OtpPurpose purpose, CancellationToken ct = default) => Task.FromResult<OtpChallenge?>(_challenge);
        public Task AddAsync(OtpChallenge c, CancellationToken ct = default) => Task.CompletedTask;
        public Task<int> CountIssuedSinceAsync(string p, OtpPurpose purpose, DateTime since, CancellationToken ct = default) => Task.FromResult(0);
        public Task<bool> TryCountAttemptAsync(OtpChallenge challenge, DateTime utcNow, CancellationToken ct = default) =>
            Task.FromResult(challenge.TryCountAttempt(utcNow));
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
