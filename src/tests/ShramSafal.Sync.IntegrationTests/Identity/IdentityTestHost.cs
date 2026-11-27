// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane IDENT) - the real sign-in and ShramSafal routes over a real Postgres, for the
// identity card, the people rows of the pull and the picture door.
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth.DeviceCheck;
using AgriSync.BuildingBlocks.Persistence;
using Accounts.Infrastructure;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using ShramSafal.Api;
using ShramSafal.Sync.IntegrationTests.TrialSafety;
using User.Api;
using User.Application.Ports;
using User.Domain.Security;

namespace ShramSafal.Sync.IntegrationTests.Identity;

/// <summary>
/// The sign-in routes (<c>MapUserApi</c>), the ShramSafal routes, the real JwtBearer scheme and token issuer, the held-phone gate, the tenant
/// middleware, in Program.cs's order, on the class's own scratch database as <c>agrisync_app</c>. A person is made by his first SMS sign-in (the
/// code is put in the challenge table, as the sender would), so his phone is his first known phone and his token opens everything he may see.
/// </summary>
internal sealed class IdentityTestHost : IAsyncDisposable
{
    public const string Otp = "482913";
    private static readonly string JwtSigningKey = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(48)); // per-run test key

    private readonly TrialSafetyDatabase _db;
    private readonly WebApplication _app;

    private IdentityTestHost(TrialSafetyDatabase db, WebApplication app)
    {
        _db = db;
        _app = app;
        Client = app.GetTestClient();
    }

    public HttpClient Client { get; }

    public IServiceProvider Services => _app.Services;

    public static async Task<IdentityTestHost> StartAsync(TrialSafetyDatabase db)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = db.AppConn,
            ["ConnectionStrings:UserDb"] = db.AppConn,
            ["ConnectionStrings:AccountsDb"] = db.AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = db.SuperuserConn,
            ["ShramSafal:Storage:DataDirectory"] = Path.Combine(Path.GetTempPath(), "agrisync-ident", Guid.NewGuid().ToString("N")),
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            ["Jwt:SigningKey"] = JwtSigningKey,
            ["Jwt:AccessTokenMinutes"] = "15",
            ["Msg91:UseDevStub"] = "true",
        });

        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"ident-analytics-{Guid.NewGuid()}"));
        builder.Services.AddUserApi(builder.Configuration);
        builder.Services.AddAccountsInfrastructure(builder.Configuration);
        builder.Services.AddShramSafalApi(builder.Configuration);
        AddCompositionAdapters(builder.Services);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseDeviceCheckGate();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapUserApi();
        app.MapShramSafalApi();
        await app.StartAsync();
        return new IdentityTestHost(db, app);
    }

    /// <summary>The composition-root readers Program.cs registers for the User routes.</summary>
    private static void AddCompositionAdapters(IServiceCollection services)
    {
        services.AddScoped<IAccountsSnapshotReader, AgriSync.Bootstrapper.Adapters.AccountsSnapshotReader>();
        services.AddScoped<IFarmMembershipSnapshotReader, AgriSync.Bootstrapper.Adapters.FarmMembershipSnapshotReader>();
        services.AddScoped<IAffiliationSnapshotReader, AgriSync.Bootstrapper.Adapters.AffiliationSnapshotReader>();
        services.AddScoped<IMeInvitationSnapshotReader, AgriSync.Bootstrapper.Adapters.MeInvitationSnapshotReader>();
        services.AddScoped<IMePictureSnapshotReader, AgriSync.Bootstrapper.Adapters.MePictureSnapshotReader>();
    }

    public async ValueTask DisposeAsync()
    {
        Client.Dispose();
        await _app.StopAsync();
        await _app.DisposeAsync();
    }

    /// <summary>A new person: his first SMS sign-in on <paramref name="device"/>. Returns his id and his access token.</summary>
    public async Task<(Guid UserId, string Token)> SignUpAsync(string phone, string displayName, string? device = null)
    {
        var reply = await VerifyAsync(phone, device ?? "ident-phone-" + phone, displayName);
        reply.Status.Should().Be(HttpStatusCode.OK, reply.Raw);
        reply.Body.GetProperty("createdNewUser").GetBoolean().Should().BeTrue("arrange: a brand-new account");
        reply.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeFalse("the phone that makes an account is its first known phone");
        return (reply.Body.GetProperty("userId").GetGuid(), reply.Body.GetProperty("accessToken").GetString()!);
    }

    /// <summary>An SMS sign-in to an EXISTING account on a phone it never confirmed: the token is held.</summary>
    public async Task<string> HeldTokenAsync(string phone, string device)
    {
        var reply = await VerifyAsync(phone, device, null);
        reply.Body.GetProperty("deviceCheckRequired").GetBoolean().Should().BeTrue("arrange: a phone the account never confirmed");
        return reply.Body.GetProperty("accessToken").GetString()!;
    }

    public Task<Reply> GetAsync(string url, string? token) => SendAsync(HttpMethod.Get, url, token, null);

    public Task<Reply> PutJsonAsync(string url, string? token, object body, string? appVersion = null) =>
        SendAsync(HttpMethod.Put, url, token, JsonContent.Create(body), appVersion);

    public Task<Reply> PutRawAsync(string url, string? token, string raw, string? appVersion = null) =>
        SendAsync(HttpMethod.Put, url, token, new StringContent(raw, Encoding.UTF8, "application/json"), appVersion);

    public Task<Reply> PutBytesAsync(string url, string? token, byte[] bytes, string contentType)
    {
        var content = new ByteArrayContent(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        return SendAsync(HttpMethod.Put, url, token, content);
    }

    public async Task<Reply> SendAsync(HttpMethod method, string url, string? token, HttpContent? content, string? appVersion = null)
    {
        using var request = new HttpRequestMessage(method, url) { Content = content };
        if (token is not null)
        {
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }

        if (appVersion is not null)
        {
            request.Headers.Add("X-App-Version", appVersion);
        }

        return await ReadAsync(await Client.SendAsync(request));
    }

    public async Task<byte[]> GetBytesAsync(string url, string token, HttpStatusCode expected)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await Client.SendAsync(request);
        response.StatusCode.Should().Be(expected, url);
        return await response.Content.ReadAsByteArrayAsync();
    }

    private async Task<Reply> VerifyAsync(string phone, string device, string? displayName)
    {
        await using (var scope = _app.Services.CreateAsyncScope())
        {
            var sp = scope.ServiceProvider;
            sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            var otps = sp.GetRequiredService<IOtpChallengeRepository>();
            await otps.AddAsync(OtpChallenge.Issue(Guid.NewGuid(), phone, sp.GetRequiredService<IPasswordHasher>().Hash(Otp), DateTime.UtcNow, TimeSpan.FromMinutes(10), 5));
            await otps.SaveChangesAsync();
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, "/user/auth/verify-otp")
        {
            Content = JsonContent.Create(new { phone, otp = Otp, displayName, rememberDevice = true, deviceId = device, deviceName = device, platform = "android" }),
        };
        request.Headers.Add("X-Client-Platform", "android");
        return await ReadAsync(await Client.SendAsync(request));
    }

    private static async Task<Reply> ReadAsync(HttpResponseMessage response)
    {
        var raw = await response.Content.ReadAsStringAsync();
        JsonElement body;
        try
        {
            body = string.IsNullOrWhiteSpace(raw) ? default : JsonDocument.Parse(raw).RootElement.Clone();
        }
        catch (JsonException)
        {
            body = default;
        }

        return new Reply(response.StatusCode, body, raw);
    }

    public sealed record Reply(HttpStatusCode Status, JsonElement Body, string Raw);
}
