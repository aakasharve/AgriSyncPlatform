// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3, H10)
using System.Security.Claims;
using AgriSync.BuildingBlocks.Auth;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Auth;

/// <summary>A session began at the control room's door only when an authenticated principal carries exactly the door claim.</summary>
public sealed class HttpContextControlRoomSessionTests
{
    private static HttpContextControlRoomSession Session(HttpContext? ctx) => new(new HttpContextAccessor { HttpContext = ctx });

    private static DefaultHttpContext With(string? claimValue, bool authenticated = true)
    {
        var claims = new List<Claim> { new("sub", "11111111-1111-4111-8111-111111111111") };
        if (claimValue is not null) claims.Add(new Claim(ControlRoomSessionClaims.Type, claimValue));
        return new DefaultHttpContext
        {
            User = new ClaimsPrincipal(authenticated ? new ClaimsIdentity(claims, "Test") : new ClaimsIdentity(claims))
        };
    }

    [Fact]
    public void Only_an_authenticated_principal_with_the_exact_claim_began_at_the_door()
    {
        Assert.True(Session(With("1")).BeganAtTheDoor, "control_room_door=1 on an authenticated principal");
        Assert.False(Session(With("0")).BeganAtTheDoor, "a different value is not the mark");
        Assert.False(Session(With(null)).BeganAtTheDoor, "a phone token carries no mark");
        Assert.False(Session(With("1", authenticated: false)).BeganAtTheDoor, "an anonymous principal never passes");
        Assert.False(Session(null).BeganAtTheDoor, "no HttpContext (a background job) never passes");
    }

    [Fact]
    public void The_names_are_the_ones_the_issuer_and_the_resolver_share()
    {
        Assert.Equal("control_room_door", ControlRoomSessionClaims.Type);
        Assert.Equal("1", ControlRoomSessionClaims.Value);
        Assert.Equal("control-room-door", ControlRoomSessionClaims.SessionPlatform);
        Assert.Equal("control_room.door_session_required", ControlRoomSessionClaims.RequiredErrorCode);
    }
}
