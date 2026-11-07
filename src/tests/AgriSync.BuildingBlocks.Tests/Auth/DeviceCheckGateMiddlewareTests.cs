// spec: plr-d10-redesign-real-integration-2026-10-25 — lane NP-1 (founder D-56)
using System.Security.Claims;
using System.Text.Json;
using AgriSync.BuildingBlocks.Auth.DeviceCheck;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Auth;

/// <summary>
/// The gate in isolation: a held token (<c>device_check = pending</c>) is refused on every route that is not anonymous
/// with 403 <c>auth.device_unconfirmed</c>; on an anonymous route it runs as nobody; any other caller passes untouched.
/// The same gate over the real pipeline and Postgres: <c>NewPhoneQuestionRealPostgresTests</c>.
/// </summary>
public sealed class DeviceCheckGateMiddlewareTests
{
    [Fact]
    public async Task A_held_token_is_refused_on_a_signed_in_route_with_the_clear_code()
    {
        var reached = false;
        var ctx = Context(Held(), anonymous: false);

        await Gate(_ => { reached = true; return Task.CompletedTask; }).InvokeAsync(ctx);

        Assert.False(reached, "the route must not run for a phone that has not answered");
        Assert.Equal(StatusCodes.Status403Forbidden, ctx.Response.StatusCode);
        Assert.Equal(DeviceCheckClaims.UnconfirmedErrorCode, ErrorCode(ctx));
    }

    [Fact]
    public async Task A_held_token_is_refused_where_no_route_matched_either()
    {
        var reached = false;
        var ctx = new DefaultHttpContext { User = Held(), Response = { Body = new MemoryStream() } };

        await Gate(_ => { reached = true; return Task.CompletedTask; }).InvokeAsync(ctx);

        Assert.False(reached);
        Assert.Equal(StatusCodes.Status403Forbidden, ctx.Response.StatusCode);
    }

    [Fact]
    public async Task On_an_anonymous_route_a_held_token_runs_as_nobody()
    {
        ClaimsPrincipal? seen = null;
        var ctx = Context(Held(), anonymous: true);

        await Gate(c => { seen = c.User; return Task.CompletedTask; }).InvokeAsync(ctx);

        Assert.NotNull(seen);
        Assert.False(seen!.Identity?.IsAuthenticated ?? false, "an open route never sees the held identity");
        Assert.Null(seen.FindFirst("sub"));
    }

    [Fact]
    public async Task A_known_phones_token_and_a_signed_out_caller_pass_untouched()
    {
        foreach (var user in new[] { Known(), new ClaimsPrincipal(new ClaimsIdentity()) })
        {
            ClaimsPrincipal? seen = null;
            var ctx = Context(user, anonymous: false);

            await Gate(c => { seen = c.User; return Task.CompletedTask; }).InvokeAsync(ctx);

            Assert.Same(user, seen);
            Assert.Equal(StatusCodes.Status200OK, ctx.Response.StatusCode);
        }
    }

    [Fact]
    public void Only_an_authenticated_principal_with_the_pending_claim_is_held()
    {
        Assert.True(DeviceCheckGateMiddleware.IsHeld(Held()));
        Assert.False(DeviceCheckGateMiddleware.IsHeld(Known()));
        // The claim alone, on an identity that did not authenticate, is not a sign-in at all.
        Assert.False(DeviceCheckGateMiddleware.IsHeld(new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(DeviceCheckClaims.Type, DeviceCheckClaims.Pending)]))));
        Assert.False(DeviceCheckGateMiddleware.IsHeld(null));
    }

    private static DeviceCheckGateMiddleware Gate(RequestDelegate next) =>
        new(next, NullLogger<DeviceCheckGateMiddleware>.Instance);

    private static ClaimsPrincipal Held() => new(new ClaimsIdentity(
        [new Claim("sub", Guid.NewGuid().ToString()), new Claim(DeviceCheckClaims.Type, DeviceCheckClaims.Pending)],
        authenticationType: "Bearer"));

    private static ClaimsPrincipal Known() => new(new ClaimsIdentity(
        [new Claim("sub", Guid.NewGuid().ToString())], authenticationType: "Bearer"));

    private static DefaultHttpContext Context(ClaimsPrincipal user, bool anonymous)
    {
        var ctx = new DefaultHttpContext { User = user };
        ctx.Response.Body = new MemoryStream();
        var metadata = anonymous
            ? new EndpointMetadataCollection(new AllowAnonymousAttribute())
            : new EndpointMetadataCollection(new AuthorizeAttribute());
        ctx.SetEndpoint(new Endpoint(_ => Task.CompletedTask, metadata, "test"));
        return ctx;
    }

    private static string? ErrorCode(HttpContext ctx)
    {
        ctx.Response.Body.Position = 0;
        using var doc = JsonDocument.Parse(ctx.Response.Body);
        return doc.RootElement.GetProperty("error").GetString();
    }
}
