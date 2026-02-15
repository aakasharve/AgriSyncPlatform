using System.Security.Claims;
using User.Application.UseCases.Auth.Login;
using User.Application.UseCases.Auth.RefreshToken;
using User.Application.UseCases.Auth.RegisterUser;
using User.Application.UseCases.Users.GetCurrentUser;

namespace User.Api.Endpoints;

public static class AuthEndpoints
{
    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder endpoints)
    {
        var group = endpoints.MapGroup("/user/auth").WithTags("Auth");

        group.MapPost("/register", async (
            RegisterRequest request,
            RegisterUserHandler handler,
            CancellationToken ct) =>
        {
            var command = new RegisterUserCommand(
                request.Phone,
                request.Password,
                request.DisplayName,
                request.AppId,
                request.Role);

            var result = await handler.HandleAsync(command, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.BadRequest(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("RegisterUser")
        .AllowAnonymous();

        group.MapPost("/login", async (
            LoginRequest request,
            LoginHandler handler,
            CancellationToken ct) =>
        {
            var command = new LoginCommand(request.Phone, request.Password);
            var result = await handler.HandleAsync(command, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.Unauthorized();
        })
        .WithName("LoginUser")
        .AllowAnonymous();

        group.MapPost("/refresh", async (
            RefreshRequest request,
            RefreshTokenHandler handler,
            CancellationToken ct) =>
        {
            var command = new RefreshTokenCommand(request.RefreshToken);
            var result = await handler.HandleAsync(command, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.Unauthorized();
        })
        .WithName("RefreshToken")
        .AllowAnonymous();

        group.MapGet("/me", async (
            ClaimsPrincipal user,
            GetCurrentUserHandler handler,
            CancellationToken ct) =>
        {
            var sub = user.FindFirstValue("sub");
            if (sub is null || !Guid.TryParse(sub, out var userId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(userId, ct);

            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.NotFound(new { error = result.Error.Code, message = result.Error.Description });
        })
        .WithName("GetCurrentUser")
        .RequireAuthorization();

        return endpoints;
    }
}

public sealed record RegisterRequest(
    string Phone,
    string Password,
    string DisplayName,
    string? AppId = "shramsafal",
    string? Role = "PrimaryOwner");

public sealed record LoginRequest(string Phone, string Password);

public sealed record RefreshRequest(string RefreshToken);
