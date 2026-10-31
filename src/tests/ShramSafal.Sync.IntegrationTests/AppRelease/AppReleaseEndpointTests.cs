using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Threading.Tasks;
using System.Text.Encodings.Web;
using System.Text.Json;
using AgriSync.Bootstrapper;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.AppRelease;

/// <summary>
/// Lane UPD-1 (D-53, P4, P11) — <c>GET /version/app</c>, the newest phone-app version.
/// Configured → the values; not configured → <c>latestVersion: null</c> (never an invented version);
/// answered to an anonymous caller; no database (the harness has none at all).
/// </summary>
public sealed class AppReleaseEndpointTests
{
    [Fact]
    public async Task Configured_release_is_returned_with_a_short_cache()
    {
        await using var harness = await Harness.CreateAsync(new Dictionary<string, string?>
        {
            ["AppRelease:LatestVersion"] = "1.0.19",
            ["AppRelease:MinimumVersion"] = "1.0.17",
            ["AppRelease:PlayStoreUrl"] = "https://play.google.com/store/apps/details?id=com.agrisync.shramsafal",
            ["AppRelease:ApkUrl"] = "https://shramsafal.in/apk",
        });

        var response = await harness.Client.GetAsync(AppReleaseEndpoints.Route);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        response.Headers.CacheControl.Should().NotBeNull();
        response.Headers.CacheControl!.MaxAge.Should().Be(TimeSpan.FromMinutes(5), "a new release must reach phones within minutes");
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("latestVersion").GetString().Should().Be("1.0.19");
        body.RootElement.GetProperty("minimumVersion").GetString().Should().Be("1.0.17");
        body.RootElement.GetProperty("playStoreUrl").GetString().Should().Be("https://play.google.com/store/apps/details?id=com.agrisync.shramsafal");
        body.RootElement.GetProperty("apkUrl").GetString().Should().Be("https://shramsafal.in/apk");
    }

    [Fact]
    public async Task Not_configured_answers_a_null_latest_version()
    {
        await using var harness = await Harness.CreateAsync(new Dictionary<string, string?>());

        var response = await harness.Client.GetAsync(AppReleaseEndpoints.Route);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("latestVersion").ValueKind.Should().Be(JsonValueKind.Null, "P4: no version is invented");
        body.RootElement.GetProperty("minimumVersion").ValueKind.Should().Be(JsonValueKind.Null);
    }

    [Fact]
    public async Task Anonymous_caller_is_answered_while_the_fallback_policy_refuses_anonymous_elsewhere()
    {
        await using var harness = await Harness.CreateAsync(new Dictionary<string, string?>
        {
            ["AppRelease:LatestVersion"] = "1.0.18",
        });

        // Control: the harness really does refuse an anonymous caller on an ordinary route.
        (await harness.Client.GetAsync(Harness.ControlRoute)).StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        var response = await harness.Client.GetAsync(AppReleaseEndpoints.Route);
        response.StatusCode.Should().Be(HttpStatusCode.OK, "a phone asks before (and without) signing in");
    }

    [Fact]
    public void Route_sits_under_a_tenant_skip_listed_prefix()
    {
        // Under a skip-listed prefix the request never opens a per-request database transaction.
        var field = typeof(TenantTransactionMiddleware).GetField("SkipPathPrefixes", BindingFlags.NonPublic | BindingFlags.Static);
        field.Should().NotBeNull("the middleware's skip list was renamed — re-check where /version/app runs");
        var prefixes = (string[])field!.GetValue(null)!;
        prefixes.Should().Contain(p => AppReleaseEndpoints.Route.StartsWith(p, StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData("1.0.x")]
    [InlineData("v1.0.18")]
    [InlineData("1..0")]
    [InlineData("1.0.18-beta")]
    public void A_malformed_latest_version_is_refused_not_echoed(string configured)
    {
        var answer = AppReleaseAnswer.From(new AppReleaseOptions { LatestVersion = configured, MinimumVersion = "1.0.0" }, NullLogger.Instance);

        answer.LatestVersion.Should().BeNull();
        answer.MinimumVersion.Should().BeNull();
    }

    [Fact]
    public void A_minimum_above_the_latest_or_without_a_latest_is_ignored()
    {
        AppReleaseAnswer.From(new AppReleaseOptions { LatestVersion = "1.0.18", MinimumVersion = "1.0.19" }, NullLogger.Instance)
            .Should().Be(new AppReleaseResponse("1.0.18", null, null, null));
        AppReleaseAnswer.From(new AppReleaseOptions { MinimumVersion = "1.0.17" }, NullLogger.Instance)
            .Should().Be(new AppReleaseResponse(null, null, null, null));
    }

    [Fact]
    public void Whitespace_is_trimmed_and_a_relative_url_is_refused()
    {
        var answer = AppReleaseAnswer.From(
            new AppReleaseOptions { LatestVersion = " 1.0.18 ", PlayStoreUrl = "/store", ApkUrl = " https://shramsafal.in/apk " },
            NullLogger.Instance);

        answer.Should().Be(new AppReleaseResponse("1.0.18", null, null, "https://shramsafal.in/apk"));
    }

    [Theory]
    [InlineData("1.0.10", "1.0.9", 1)]
    [InlineData("1.0.9", "1.0.10", -1)]
    [InlineData("1.0.18", "1.0.18", 0)]
    [InlineData("1.0", "1.0.0", 0)]
    [InlineData("2", "1.99.99", 1)]
    public void Versions_compare_numerically(string left, string right, int expected)
    {
        Math.Sign(AppReleaseAnswer.Compare(left, right)).Should().Be(expected);
    }

    private sealed class Harness(WebApplication app, HttpClient client) : IAsyncDisposable
    {
        public const string ControlRoute = "/control/needs-sign-in";

        public HttpClient Client { get; } = client;

        public static async Task<Harness> CreateAsync(IDictionary<string, string?> settings)
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
            builder.WebHost.UseTestServer();

            // Only what the test states: no appsettings.json, no environment variables.
            builder.Configuration.Sources.Clear();
            builder.Configuration.AddInMemoryCollection(settings);

            builder.Services.AddLogging();
            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, NobodyHandler>("Test", _ => { });
            // As strict as it gets: every endpoint needs a signed-in user unless it says otherwise.
            builder.Services.AddAuthorization(o =>
                o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());
            builder.Services.AddAppReleaseOptions(builder.Configuration);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapGet(ControlRoute, () => Results.Ok());
            app.MapAppRelease();

            await app.StartAsync();
            return new Harness(app, app.GetTestClient());
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
        }

        /// <summary>Nobody is ever signed in.</summary>
        private sealed class NobodyHandler(
            IOptionsMonitor<AuthenticationSchemeOptions> options,
            ILoggerFactory logger,
            UrlEncoder encoder)
            : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
        {
            protected override Task<AuthenticateResult> HandleAuthenticateAsync() =>
                Task.FromResult(AuthenticateResult.NoResult());
        }
    }
}
