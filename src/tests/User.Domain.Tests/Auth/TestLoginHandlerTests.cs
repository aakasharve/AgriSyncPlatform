using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using User.Application.Ports;
using User.Application.UseCases.Auth.TestLogin;
using User.Domain.Identity;
using User.Domain.Security;
using Xunit;

namespace User.Domain.Tests.Auth;

/// <summary>
/// SARVAM_DEPLOY_READINESS gate B6 enabler — TestLoginHandler tests.
///
/// Locks the four founder rules from the workstream brief 2026-05-28:
///   1. Allowlisted user passes ONLY when flag is enabled.
///   2. Same user CANNOT pass when flag is disabled.
///   3. Non-allowlisted user CANNOT pass even when flag is enabled.
///   4. Default config does NOT enable bypass.
///
/// Plus two defensive cases:
///   5. Invalid phone format → validation error.
///   6. Allowlisted phone with no User row → does NOT auto-create
///      (deliberate departure from VerifyOtpHandler).
/// </summary>
public sealed class TestLoginHandlerTests
{
    private const string FounderTestPhone = "8888888888"; // PurveshDemoSeeder v2 (memory).
    private const string OutsiderPhone = "9999999999";

    // ── Rule 4: default config does not enable bypass ───────────────

    [Fact]
    public void Default_TestLoginOptions_disables_bypass()
    {
        var options = new TestLoginOptions();

        options.Enabled.Should().BeFalse(
            "default posture per SARVAM_DEPLOY_READINESS gate B6 — opt-in via explicit config only");
        options.AllowedPhoneNumbersE164.Should().BeEmpty(
            "no user should be in the allowlist by default; empty list with flag on still means zero users can pass");
    }

    // ── Rule 2: same user cannot pass when flag is disabled ─────────

    [Fact]
    public async Task Disabled_flag_rejects_even_allowlisted_user()
    {
        var options = new TestLoginOptions
        {
            Enabled = false,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var handler = BuildHandler(options, userInDb: SeedUser(FounderTestPhone));

        var result = await handler.HandleAsync(new TestLoginCommand(FounderTestPhone));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("test_login.disabled");
    }

    // ── Rule 3: non-allowlisted user cannot pass even with flag on ──

    [Fact]
    public async Task Enabled_flag_rejects_non_allowlisted_phone()
    {
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var handler = BuildHandler(options, userInDb: SeedUser(OutsiderPhone));

        var result = await handler.HandleAsync(new TestLoginCommand(OutsiderPhone));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("test_login.phone_not_allowlisted");
    }

    [Fact]
    public async Task Enabled_flag_with_empty_allowlist_rejects_every_phone()
    {
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string>(),
        };
        var handler = BuildHandler(options, userInDb: SeedUser(FounderTestPhone));

        var result = await handler.HandleAsync(new TestLoginCommand(FounderTestPhone));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("test_login.phone_not_allowlisted",
            "empty allowlist with flag on still allows nobody — both sides of the gate must align");
    }

    // ── Rule 1: allowlisted user passes only when flag is enabled ───

    [Fact]
    public async Task Enabled_flag_with_allowlisted_existing_user_returns_tokens()
    {
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var seededUser = SeedUser(FounderTestPhone);
        var handler = BuildHandler(options, userInDb: seededUser);

        var result = await handler.HandleAsync(new TestLoginCommand(FounderTestPhone));

        result.IsSuccess.Should().BeTrue("flag on + phone allowlisted + user exists → must succeed");
        result.Value!.UserId.Should().Be(seededUser.Id);
        result.Value.AccessToken.Should().NotBeNullOrWhiteSpace();
        result.Value.RefreshToken.Should().NotBeNullOrWhiteSpace();
        result.Value.ExpiresAtUtc.Should().BeAfter(DateTime.UtcNow);
    }

    [Fact]
    public async Task Enabled_flag_with_country_code_prefixed_phone_normalizes_before_allowlist_check()
    {
        // Allowlist stores the 10-digit normalized form; a request that
        // arrives with "+91" prefix must normalize FIRST before being
        // checked against the allowlist. Matches PhoneNumber.Create's
        // contract.
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var seededUser = SeedUser(FounderTestPhone);
        var handler = BuildHandler(options, userInDb: seededUser);

        var result = await handler.HandleAsync(new TestLoginCommand("+91" + FounderTestPhone));

        result.IsSuccess.Should().BeTrue("normalized form matches allowlist; +91 prefix is stripped");
    }

    // ── Defensive: never auto-create users ──────────────────────────

    [Fact]
    public async Task Enabled_flag_with_allowlisted_phone_but_no_user_row_returns_not_found()
    {
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var handler = BuildHandler(options, userInDb: null);

        var result = await handler.HandleAsync(new TestLoginCommand(FounderTestPhone));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("test_login.user_not_found",
            "test-login NEVER auto-creates users — that would be a real-data side effect");
    }

    // ── Defensive: invalid phone format ─────────────────────────────

    [Fact]
    public async Task Invalid_phone_format_returns_validation_error()
    {
        var options = new TestLoginOptions
        {
            Enabled = true,
            AllowedPhoneNumbersE164 = new List<string> { FounderTestPhone },
        };
        var handler = BuildHandler(options, userInDb: null);

        var result = await handler.HandleAsync(new TestLoginCommand("not-a-phone"));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Be("test_login.invalid_phone");
    }

    // ── Helpers ─────────────────────────────────────────────────────

    private static TestLoginHandler BuildHandler(TestLoginOptions options, Domain.Identity.User? userInDb)
    {
        return new TestLoginHandler(
            optionsAccessor: Options.Create(options),
            userRepository: new StubUserRepository(userInDb),
            refreshTokenRepository: new StubRefreshTokenRepository(),
            jwtTokenService: new StubJwtTokenService(),
            idGenerator: new StubIdGenerator(),
            clock: new FixedClock(),
            logger: NullLogger<TestLoginHandler>.Instance);
    }

    private static Domain.Identity.User SeedUser(string phone)
    {
        return Domain.Identity.User.RegisterViaOtp(
            id: new UserId(Guid.NewGuid()),
            phone: PhoneNumber.Create(phone),
            displayName: $"Test User {phone[^4..]}",
            unusablePasswordHash: "stub-hash",
            utcNow: DateTime.UtcNow);
    }

    private sealed class StubUserRepository(Domain.Identity.User? user) : IUserRepository
    {
        public Task<Domain.Identity.User?> GetByIdAsync(Guid id, CancellationToken ct = default) =>
            Task.FromResult(user?.Id == id ? user : null);
        public Task<Domain.Identity.User?> GetByPhoneAsync(string phone, CancellationToken ct = default) =>
            Task.FromResult(user?.Phone.Value == phone ? user : null);
        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default) =>
            Task.FromResult(user?.Phone.Value == phone);
        public Task AddAsync(Domain.Identity.User u, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class StubRefreshTokenRepository : IRefreshTokenRepository
    {
        public Task<RefreshToken?> GetByTokenAsync(string token, CancellationToken ct = default) =>
            Task.FromResult<RefreshToken?>(null);
        public Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default) => Task.CompletedTask;
        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class StubJwtTokenService : IJwtTokenService
    {
        public TokenPair GenerateTokens(Guid userId, string phone, string displayName, IReadOnlyCollection<MembershipClaim> memberships) =>
            new("stub-access-token", "stub-refresh-token", DateTime.UtcNow.AddMinutes(15));
        public TokenPair GenerateIdentityTokens(Guid userId, bool phoneVerified) =>
            new($"stub-access-{userId:N}", $"stub-refresh-{userId:N}", DateTime.UtcNow.AddMinutes(15));
    }

    private sealed class StubIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock : IClock
    {
        public DateTime UtcNow => new(2026, 5, 28, 9, 0, 0, DateTimeKind.Utc);
    }
}
