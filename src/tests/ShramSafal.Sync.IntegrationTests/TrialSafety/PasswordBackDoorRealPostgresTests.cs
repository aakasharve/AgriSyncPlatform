// spec: pre-launch repair I19 (D-23) — close the password sign-up back door
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ShramSafal.Sync.IntegrationTests.Labour;
using User.Application.Ports;
using User.Application.UseCases.Auth.DeviceCheck;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Auth.Session;
using User.Application.UseCases.Auth.VerifyOtp;
using User.Domain.Security;
using User.Infrastructure;
using User.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec I19 (pre-launch repair, D-23) — on real Postgres, as the app role, with the real User
/// repositories and the real BCrypt hasher (only the JWT signer is a capturing fake):
/// <list type="bullet">
/// <item>password sign-up is closed by default — nothing is written;</item>
/// <item>with the test-only switch on, a stranger's password account is NOT verified, and a
/// password login never verifies it;</item>
/// <item>an SMS sign-in on that Password-mode account marks the number verified and does nothing
/// else — the password still opens the account and the other sessions stay live (real owners sign
/// in with a password too: the admin console accepts only phone + password) — in the database, not
/// just in memory;</item>
/// <item>the founder's seeded demo login (8888888888) still works and is verified — by its seeder,
/// on purpose — including a demo user seeded before this change.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PasswordBackDoorRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>
{
    private const string Otp = "482913";
    private const string OwnersPassword = "Owner@12345";

    [Fact]
    public async Task Closed_by_default_writes_nothing()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        const string phone = "9812300001";
        await using var provider = BuildProvider();
        await using var scope = Elevated(provider);
        var handler = Register(scope.ServiceProvider, allow: false);

        var result = await handler.HandleAsync(new RegisterUserCommand(phone, OwnersPassword, "Someone", Session: Device("x")));

        result.IsSuccess.Should().BeFalse();
        result.Error.Code.Should().Be("auth.password_registration_closed");
        (await db.CountAsync("SELECT count(*) FROM public.users WHERE phone = @p", ("p", phone))).Should().Be(0);
    }

    [Fact]
    public async Task An_sms_sign_in_on_a_password_account_keeps_the_password_and_the_other_sessions_and_marks_the_number_verified()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        const string phone = "9812300002";
        await using var provider = BuildProvider();
        var jwt = new CapturingJwt();

        // 1. A password account (test switch on) signed in on two devices; the number is not verified.
        Guid userId;
        await using (var scope = Elevated(provider))
        {
            var registered = await Register(scope.ServiceProvider, allow: true, jwt)
                .HandleAsync(new RegisterUserCommand(phone, OwnersPassword, "Owner", Session: Device("owners-laptop")));
            registered.IsSuccess.Should().BeTrue(registered.IsSuccess ? "" : registered.Error.Code);
            userId = registered.Value.UserId;
            jwt.LastPhoneVerified.Should().BeFalse("a password sign-up is not phone-verified");
        }

        await using (var scope = Elevated(provider))
        {
            var login = await Login(scope.ServiceProvider, jwt)
                .HandleAsync(new LoginCommand(phone, OwnersPassword, Device("admin-console")));
            login.IsSuccess.Should().BeTrue();
            jwt.LastPhoneVerified.Should().BeFalse("a password login never verifies the number");
        }

        (await db.CountAsync("SELECT count(*) FROM public.users WHERE \"Id\" = @u AND phone_verified_at_utc IS NULL", ("u", userId)))
            .Should().Be(1, "nothing marked the number verified");
        (await db.CountAsync("SELECT count(*) FROM public.refresh_tokens WHERE user_id = @u AND revoked_at_utc IS NULL", ("u", userId)))
            .Should().Be(2, "arrange: two live sessions");

        // 2. The holder signs in by SMS on his phone.
        await using (var scope = Elevated(provider))
        {
            var sp = scope.ServiceProvider;
            var hasher = sp.GetRequiredService<IPasswordHasher>();
            var otps = sp.GetRequiredService<IOtpChallengeRepository>();
            await otps.AddAsync(OtpChallenge.Issue(Guid.NewGuid(), phone, hasher.Hash(Otp), DateTime.UtcNow, TimeSpan.FromMinutes(10), 5));
            await otps.SaveChangesAsync();

            var verified = await Verify(sp, jwt).HandleAsync(new VerifyOtpCommand(phone, Otp, null, Device("owners-phone")));
            verified.IsSuccess.Should().BeTrue(verified.IsSuccess ? "" : verified.Error.Code);
            verified.Value!.UserId.Should().Be(userId, "the holder lands in the same account (invariant I1)");
            verified.Value.CreatedNewUser.Should().BeFalse();
            jwt.LastPhoneVerified.Should().BeTrue("the SMS code verified the number");

            // spec: plr-d10 lane NP-1 (D-56) — his phone is new for this account, so the sign-in is held and asks
            // "is this your account?"; the account does not change until he answers (D-85). He answers होय.
            verified.Value.DeviceCheckRequired.Should().BeTrue("owners-phone has never been confirmed for this account");
            (await db.CountAsync("SELECT count(*) FROM public.users WHERE \"Id\" = @u AND phone_verified_at_utc IS NULL", ("u", userId)))
                .Should().Be(1, "a held sign-in changes nothing in the account");
            var answered = await new AnswerDeviceCheckHandler(
                    sp.GetRequiredService<IRefreshTokenRepository>(), sp.GetRequiredService<IUserRepository>(), jwt,
                    sp.GetRequiredService<IClock>(), NullLogger<AnswerDeviceCheckHandler>.Instance)
                .HandleAsync(new AnswerDeviceCheckCommand(verified.Value.RefreshToken, ItIsMe: true));
            answered.IsSuccess.Should().BeTrue(answered.IsSuccess ? "" : answered.Error.Code);
            answered.Value.Confirmed.Should().BeTrue();
        }

        // 3. What is STORED.
        var user = await PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn,
            "SELECT auth_mode, phone_verified_at_utc IS NOT NULL, password_hash FROM public.users WHERE \"Id\" = @u", ("u", userId));
        user[0][0].Should().Be(0, "the account is still in Password mode");
        user[0][1].Should().Be(true, "the SMS code verified the number (stamped once he said होय)");
        await using (var scope = Elevated(provider))
        {
            scope.ServiceProvider.GetRequiredService<IPasswordHasher>().Verify(OwnersPassword, (string)user[0][2]!)
                .Should().BeTrue("the password is untouched");
        }

        var sessions = await PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn,
            "SELECT device_id, revoked_at_utc IS NOT NULL, revocation_reason FROM public.refresh_tokens WHERE user_id = @u ORDER BY created_at_utc", ("u", userId));
        output.WriteLine("[EVIDENCE] sessions after SMS sign-in: " + string.Join(" | ", sessions.ConvertAll(r => $"{r[0]} revoked={r[1]} reason={r[2]}")));
        sessions.Should().HaveCount(3);
        foreach (var device in new[] { "owners-laptop", "admin-console", "owners-phone" })
        {
            sessions.Find(r => (string)r[0]! == device)![1].Should().Be(false, $"{device} is still signed in");
        }

        // 4. The password still opens the account — and now reports the verified number.
        await using (var scope = Elevated(provider))
        {
            var again = await Login(scope.ServiceProvider, jwt)
                .HandleAsync(new LoginCommand(phone, OwnersPassword, Device("admin-console")));
            again.IsSuccess.Should().BeTrue(again.IsSuccess ? "" : again.Error.Code);
            jwt.LastPhoneVerified.Should().BeTrue("the stored state is verified now");
        }
    }

    [Fact]
    public async Task The_seeded_demo_login_still_works_and_is_verified_by_its_seeder()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        await PurveshDemoReseedHarness.SeedV2DemoAsync(db.SuperuserConn);
        await AssertDemoLoginIsVerifiedAsync("seeded fresh");

        // A demo user seeded BEFORE this change relied on the removed login stamp: re-running the
        // seeder marks it verified. (On the PC stack the demo seed runs from migrate.cmd /
        // reseed.cmd with the owner login — not on a normal start.)
        await PurveshDemoReseedHarness.ExecAsync(db.SuperuserConn, "UPDATE public.users SET phone_verified_at_utc = NULL WHERE phone = '8888888888'");
        await PurveshDemoReseedHarness.SeedV2DemoAsync(db.SuperuserConn);
        await AssertDemoLoginIsVerifiedAsync("seeded before the change, then re-seeded");
    }

    [Fact]
    public async Task The_blank_test_user_seeder_marks_its_user_verified()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        // The seeder runs at startup as the database owner (as PurveshDemoSeeder does in the reseed
        // harness: its membership row sits under FORCE RLS on public.memberships). What is under
        // test is that it marks its user verified — read back below.
        await using var provider = BuildProvider(db.SuperuserConn);
        await using (var scope = Elevated(provider))
        {
            var seeder = new BlankTestUserSeeder(
                scope.ServiceProvider.GetRequiredService<UserDbContext>(),
                scope.ServiceProvider.GetRequiredService<IPasswordHasher>(),
                new DevelopmentEnvironment(),
                NullLogger<BlankTestUserSeeder>.Instance);
            await seeder.SeedAsync();
        }

        (await db.CountAsync("SELECT count(*) FROM public.users WHERE phone = '0000000000' AND phone_verified_at_utc IS NOT NULL"))
            .Should().Be(1);
    }

    private async Task AssertDemoLoginIsVerifiedAsync(string because)
    {
        await using var provider = BuildProvider();
        await using var scope = Elevated(provider);
        var jwt = new CapturingJwt();
        var result = await Login(scope.ServiceProvider, jwt)
            .HandleAsync(new LoginCommand("8888888888", "Testuser@123", Device("founders-pc")));
        result.IsSuccess.Should().BeTrue($"the founder's demo login works ({because})");
        jwt.LastPhoneVerified.Should().BeTrue($"the demo user is verified by its seeder ({because})");
    }

    // ── composition: the real User infrastructure as the app role, admin-elevated like /user/auth ──

    private ServiceProvider BuildProvider(string? conn = null)
    {
        conn ??= db.AppConn;
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = conn,
            ["ConnectionStrings:ShramSafalDb"] = conn,
        }).Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddBuildingBlocks();
        services.AddUserInfrastructure(config);
        return services.BuildServiceProvider();
    }

    private static AsyncServiceScope Elevated(ServiceProvider provider)
    {
        var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    private static RegisterUserHandler Register(IServiceProvider sp, bool allow, CapturingJwt? jwt = null) => new(
        sp.GetRequiredService<IUserRepository>(), sp.GetRequiredService<IRefreshTokenRepository>(), sp.GetRequiredService<IPasswordHasher>(),
        jwt ?? new CapturingJwt(), sp.GetRequiredService<IIdGenerator>(), sp.GetRequiredService<IClock>(),
        Options.Create(new PasswordRegistrationOptions { AllowPasswordRegistration = allow }));

    private static LoginHandler Login(IServiceProvider sp, CapturingJwt jwt) => new(
        sp.GetRequiredService<IUserRepository>(), sp.GetRequiredService<IRefreshTokenRepository>(), sp.GetRequiredService<IPasswordHasher>(),
        jwt, sp.GetRequiredService<IIdGenerator>(), sp.GetRequiredService<IClock>());

    private static VerifyOtpHandler Verify(IServiceProvider sp, CapturingJwt jwt) => new(
        sp.GetRequiredService<IOtpChallengeRepository>(), sp.GetRequiredService<IUserRepository>(), sp.GetRequiredService<IRefreshTokenRepository>(),
        sp.GetRequiredService<IPasswordHasher>(), jwt, sp.GetRequiredService<IIdGenerator>(), sp.GetRequiredService<IClock>(),
        NullLogger<VerifyOtpHandler>.Instance, new NoopAnalytics());

    private static DeviceSessionRequest Device(string id) => new(id, RememberDevice: true, DeviceName: id, Platform: "android");

    private sealed class CapturingJwt : IJwtTokenService
    {
        public bool? LastPhoneVerified { get; private set; }

        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships, bool phoneVerified, bool deviceCheckPending)
        {
            LastPhoneVerified = phoneVerified;
            return new TokenPair("access", Guid.NewGuid().ToString("N"), DateTime.UtcNow.AddMinutes(15));
        }

        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified, bool deviceCheckPending)
        {
            LastPhoneVerified = phoneVerified;
            return new TokenPair("access", Guid.NewGuid().ToString("N"), DateTime.UtcNow.AddMinutes(15));
        }
    }

    private sealed class NoopAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, System.Threading.CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, System.Threading.CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private sealed class DevelopmentEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "AgriSync.Tests";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
