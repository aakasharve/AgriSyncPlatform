using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using User.Api;
using User.Api.Endpoints;
using User.Application.Ports;
using User.Application.UseCases.Auth.Session;
using User.Domain.Security;
using Xunit;
using DomainPhone = global::User.Domain.Identity.PhoneNumber;
using DomainUser = global::User.Domain.Identity.User;

namespace User.Api.Tests.Auth;

/// <summary>
/// The real <c>MapUserApi</c> sign-in routes and the real handlers on a TestServer, with the three
/// persistence ports replaced by in-memory fakes (nothing opens a database connection) and a plain
/// password hasher. Used to prove, per route, which response shape a request gets for each
/// combination of the <c>X-Client-Platform</c> header and the <c>Origin</c> header.
/// </summary>
public sealed class AuthRouteHost : IAsyncLifetime
{
    public const string Otp = "482913";
    public const string Password = "pw-for-tests";

    /// <summary>The origins the production configuration lists (appsettings.Production.json).</summary>
    public static readonly string[] ProductionOrigins =
    [
        "https://app.shramsafal.in",
        "https://shramsafal.in",
        "https://admin.shramsafal.in",
        "capacitor://localhost",
        "https://localhost",
    ];

    private static int _phoneCounter;

    private readonly string[] _allowedOrigins;
    private WebApplication? _app;

    public AuthRouteHost() : this(ProductionOrigins) { }

    // Internal on purpose: xunit allows a fixture only one public constructor.
    internal AuthRouteHost(string[] allowedOrigins) => _allowedOrigins = allowedOrigins;

    public HttpClient Client { get; private set; } = default!;
    public InMemoryUsers Users { get; } = new();
    public InMemorySessions Sessions { get; } = new();
    public InMemoryOtps Otps { get; } = new();

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var settings = new Dictionary<string, string?>
        {
            // Never opened: every port that would use it is replaced below.
            ["ConnectionStrings:UserDb"] = "Host=127.0.0.1;Port=1;Database=unused;Username=unused;Password=unused",
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            // Per-run key, never a literal.
            ["Jwt:SigningKey"] = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)),
            ["Jwt:AccessTokenMinutes"] = "15",
            ["Msg91:UseDevStub"] = "true",
            ["Auth:AllowPasswordRegistration"] = "true",
        };
        for (var i = 0; i < _allowedOrigins.Length; i++)
        {
            settings[$"Cors:AllowedOrigins:{i}"] = _allowedOrigins[i];
        }

        builder.Configuration.AddInMemoryCollection(settings);

        builder.Services.AddBuildingBlocks();
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddSingleton<IUserRepository>(Users);
        builder.Services.AddSingleton<IRefreshTokenRepository>(Sessions);
        builder.Services.AddSingleton<IOtpChallengeRepository>(Otps);
        builder.Services.AddSingleton<IPasswordHasher, PlainPasswordHasher>();
        builder.Services.AddSingleton<IAnalyticsWriter, NullAnalyticsWriter>();

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapUserApi();
        await _app.StartAsync();
        Client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            Client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }
    }

    // ── seeding ──────────────────────────────────────────────────────────────────────────────

    public static string NewPhone() => "90" + (10_000_000 + Interlocked.Increment(ref _phoneCounter)).ToString();

    public (string Phone, Guid UserId) SeedUser()
    {
        var phone = NewPhone();
        var id = new UserId(Guid.NewGuid());
        Users.Add(DomainUser.Register(id, DomainPhone.Create(phone), "Test User", new PlainPasswordHasher().Hash(Password), DateTime.UtcNow));
        return (phone, id.Value);
    }

    /// <summary>A live session for a fresh account; returns the raw refresh credential.</summary>
    public (string Raw, Guid UserId) SeedSession(DeviceCheckState? hold = null)
    {
        var (_, userId) = SeedUser();
        var raw = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        var now = DateTime.UtcNow;
        var row = new RefreshToken(
            Guid.NewGuid(), new UserId(userId), RefreshTokenHasher.Hash(raw), "unknown", null, "android", now, now.Add(RefreshTokenPolicy.Lifetime));
        if (hold is { } asked)
        {
            row.HoldForDeviceCheck(asked);
        }

        Sessions.Add(row);
        return (raw, userId);
    }

    public string SeedOtpFor(string phone)
    {
        Otps.Add(OtpChallenge.Issue(
            Guid.NewGuid(), DomainPhone.Create(phone).Value, new PlainPasswordHasher().Hash(Otp), DateTime.UtcNow, TimeSpan.FromMinutes(10), 5));
        return phone;
    }

    // ── requests ─────────────────────────────────────────────────────────────────────────────

    /// <param name="platformHeader">Value of <c>X-Client-Platform</c>, or null to omit the header.</param>
    /// <param name="origin">Value of <c>Origin</c>, or null to omit the header.</param>
    /// <param name="cookieToken">Sent as the refresh cookie when not null.</param>
    public async Task<Reply> PostAsync(string url, object body, string? platformHeader, string? origin, string? cookieToken = null)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, url) { Content = JsonContent.Create(body) };
        if (platformHeader is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Client-Platform", platformHeader);
        }

        if (origin is not null)
        {
            request.Headers.TryAddWithoutValidation("Origin", origin);
        }

        if (cookieToken is not null)
        {
            request.Headers.TryAddWithoutValidation("Cookie", $"{AuthCookieOptions.RefreshCookieName}={Uri.EscapeDataString(cookieToken)}");
        }

        using var response = await Client.SendAsync(request);
        var raw = await response.Content.ReadAsStringAsync();
        JsonElement json = default;
        if (!string.IsNullOrWhiteSpace(raw))
        {
            try
            {
                json = JsonDocument.Parse(raw).RootElement.Clone();
            }
            catch (JsonException)
            {
                // not JSON (a bare 401): leave default
            }
        }

        var cookies = response.Headers.TryGetValues("Set-Cookie", out var values) ? values.ToList() : [];
        return new Reply((int)response.StatusCode, json, raw, cookies);
    }

    public sealed record Reply(int Status, JsonElement Body, string Raw, IReadOnlyList<string> SetCookies)
    {
        /// <summary>True when the body carries the refresh token (the native shape).</summary>
        public bool BodyHasRefreshToken =>
            Body.ValueKind == JsonValueKind.Object && Body.TryGetProperty("refreshToken", out _);

        public bool SetsRefreshCookie =>
            SetCookies.Any(c => c.StartsWith(AuthCookieOptions.RefreshCookieName + "=", StringComparison.Ordinal) && !c.Contains("expires=Thu, 01 Jan 1970", StringComparison.OrdinalIgnoreCase));
    }

    // ── fakes ────────────────────────────────────────────────────────────────────────────────

    public sealed class InMemoryUsers : IUserRepository
    {
        private readonly List<DomainUser> _users = [];
        public void Add(DomainUser user) { lock (_users) _users.Add(user); }

        public Task<DomainUser?> GetByIdAsync(Guid id, CancellationToken ct = default)
        {
            lock (_users) return Task.FromResult(_users.FirstOrDefault(u => u.Id.Value == id));
        }

        public Task<DomainUser?> GetByPhoneAsync(string phone, CancellationToken ct = default)
        {
            lock (_users) return Task.FromResult(_users.FirstOrDefault(u => u.Phone.Value == phone));
        }

        public Task<bool> ExistsByPhoneAsync(string phone, CancellationToken ct = default)
        {
            lock (_users) return Task.FromResult(_users.Any(u => u.Phone.Value == phone));
        }

        public Task AddAsync(DomainUser user, CancellationToken ct = default)
        {
            Add(user);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    public sealed class InMemorySessions : IRefreshTokenRepository
    {
        private readonly List<RefreshToken> _rows = [];
        public void Add(RefreshToken row) { lock (_rows) _rows.Add(row); }

        /// <summary>The stored row for a raw credential (the store keeps only its hash).</summary>
        public RefreshToken? Find(string raw)
        {
            var hash = RefreshTokenHasher.Hash(raw);
            lock (_rows) return _rows.FirstOrDefault(r => r.TokenHash == hash);
        }

        public Task<RefreshToken?> GetByTokenHashAsync(string tokenHash, CancellationToken ct = default)
        {
            lock (_rows) return Task.FromResult(_rows.FirstOrDefault(r => r.TokenHash == tokenHash));
        }

        public Task AddAsync(RefreshToken refreshToken, CancellationToken ct = default)
        {
            Add(refreshToken);
            return Task.CompletedTask;
        }

        public Task RevokeActiveForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            lock (_rows)
            {
                foreach (var r in _rows.Where(r => r.UserId.Value == userId && r.DeviceId == deviceId && !r.IsRevoked))
                {
                    r.Revoke(utcNow, reason);
                }
            }

            return Task.CompletedTask;
        }

        public Task RevokeAllForUserAsync(Guid userId, DateTime utcNow, string reason = "revoked_all", CancellationToken ct = default)
        {
            lock (_rows)
            {
                foreach (var r in _rows.Where(r => r.UserId.Value == userId && !r.IsRevoked))
                {
                    r.Revoke(utcNow, reason);
                }
            }

            return Task.CompletedTask;
        }

        public Task RevokeHeldForUserDeviceAsync(Guid userId, string deviceId, DateTime utcNow, string reason, CancellationToken ct = default)
        {
            lock (_rows)
            {
                foreach (var r in _rows.Where(r => r.UserId.Value == userId && r.DeviceId == deviceId && !r.IsRevoked && r.IsHeldForDeviceCheck))
                {
                    r.Revoke(utcNow, reason);
                }
            }

            return Task.CompletedTask;
        }

        public Task<bool> HasUnheldSessionOnDeviceAsync(Guid userId, string deviceId, CancellationToken ct = default)
        {
            lock (_rows) return Task.FromResult(_rows.Any(r => r.UserId.Value == userId && r.DeviceId == deviceId && r.DeviceCheck == null));
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    public sealed class InMemoryOtps : IOtpChallengeRepository
    {
        private readonly List<OtpChallenge> _rows = [];
        public void Add(OtpChallenge row) { lock (_rows) _rows.Add(row); }

        public Task AddAsync(OtpChallenge challenge, CancellationToken ct = default)
        {
            Add(challenge);
            return Task.CompletedTask;
        }

        public Task<OtpChallenge?> GetPendingByPhoneAsync(string phoneNumberNormalized, CancellationToken ct = default)
        {
            lock (_rows) return Task.FromResult(_rows.FirstOrDefault(r => r.PhoneNumberNormalized == phoneNumberNormalized && r.IsPending));
        }

        public Task<int> CountIssuedSinceAsync(string phoneNumberNormalized, DateTime sinceUtc, CancellationToken ct = default) =>
            Task.FromResult(0);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class PlainPasswordHasher : IPasswordHasher
    {
        public string Hash(string plainText) => "plain:" + plainText;
        public bool Verify(string plainText, string hash) => hash == "plain:" + plainText;
    }

    private sealed class NullAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }
}
